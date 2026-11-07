using System.Text;
using System.Text.Json;

namespace LockBridge.Core;

/// <summary>One line of the journal. T: order | intent | result | sent.</summary>
public sealed record JournalEntry(string T, string Nonce, int? CardNo = null, string? Status = null, string? Error = null, string? Payload = null, DateTimeOffset At = default);

/// <summary>
/// Append-only, written through to disk before anything is done. A crash, power
/// cut or restart therefore never loses an order or a result: a write that was
/// started and has no result is reported as "unknown" when the bridge comes back.
/// </summary>
public sealed class Journal : IDisposable
{
    private readonly FileStream _file;
    private readonly List<JournalEntry> _entries = [];
    private readonly Lock _gate = new();

    public Journal(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        if (File.Exists(path))
            foreach (var line in File.ReadLines(path))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try { if (JsonSerializer.Deserialize<JournalEntry>(line, CardFormat.Json) is { } e) _entries.Add(e); }
                catch (JsonException) { /* a line torn by a power cut: skip it */ }
            }
        _file = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough);
        // A torn last line has no newline: start afresh so the next entry is not glued onto it.
        if (_file.Length > 0)
        {
            using var read = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            read.Seek(-1, SeekOrigin.End);
            if (read.ReadByte() != '\n') { _file.WriteByte((byte)'\n'); _file.Flush(flushToDisk: true); }
        }
    }

    public IReadOnlyList<JournalEntry> Entries { get { lock (_gate) return [.. _entries]; } }

    public void Append(JournalEntry entry)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(entry, CardFormat.Json) + "\n");
        lock (_gate)
        {
            _file.Write(bytes);
            _file.Flush(flushToDisk: true);
            _entries.Add(entry);
        }
    }

    public void Dispose() => _file.Dispose();
}

public sealed record CardState(string Status, string? Error, bool Sent);

public sealed record IssueOutcome(int HttpStatus, string? Error, string? Nonce = null, int? CardNo = null, string? Status = null);

/// <summary>
/// Writes the cards of signed orders, one card at a time, recording each step
/// in the journal. The browser asks for one card per call (staff swap cards in
/// between). A card that was written is never written twice for the same
/// order; one whose writing was cut off is left for staff to check.
/// </summary>
public sealed class CardWriter
{
    private readonly ILockDriver _driver;
    private readonly Journal _journal;
    private readonly OrderVerifier _verifier;
    private readonly TimeProvider _time;
    private readonly TimeSpan _orderLifetime;
    private readonly TimeSpan _writeTimeout;
    private readonly SemaphoreSlim _one = new(1, 1);
    private readonly Lock _gate = new();
    private readonly Dictionary<string, (GuestCardOrder Order, string Payload, DateTimeOffset AcceptedAt)> _orders = [];
    private readonly Dictionary<(string Nonce, int CardNo), CardState> _cards = [];

    public event Action? ResultsChanged;

    public CardWriter(ILockDriver driver, Journal journal, OrderVerifier verifier, TimeProvider time, TimeSpan orderLifetime, TimeSpan writeTimeout)
    {
        (_driver, _journal, _verifier, _time, _orderLifetime, _writeTimeout) = (driver, journal, verifier, time, orderLifetime, writeTimeout);
        Recover();
    }

    public bool Busy => _one.CurrentCount == 0;

    private void Recover()
    {
        foreach (var e in _journal.Entries)
        {
            switch (e.T)
            {
                case "order" when e.Payload is not null:
                    try
                    {
                        if (JsonSerializer.Deserialize<GuestCardOrder>(e.Payload, CardFormat.Json) is { } order) _orders[e.Nonce] = (order, e.Payload, e.At);
                    }
                    catch (JsonException) { /* verified when accepted, so only a damaged journal gets here */ }
                    break;
                case "intent" when e.CardNo is int no:
                    _cards[(e.Nonce, no)] = new CardState("writing", null, false);
                    break;
                case "result" when e.CardNo is int no:
                    _cards[(e.Nonce, no)] = new CardState(e.Status ?? "unknown", e.Error, false);
                    break;
                case "sent" when e.CardNo is int no && _cards.TryGetValue((e.Nonce, no), out var s):
                    _cards[(e.Nonce, no)] = s with { Sent = true };
                    break;
            }
        }
        // Started but never finished: the bridge stopped mid-write.
        foreach (var (key, state) in _cards.Where(kv => kv.Value.Status == "writing").ToList())
            Record(key.Nonce, key.CardNo, CardWriteStatus.Unknown, "The bridge stopped while this card was being written.");
    }

    public async Task<IssueOutcome> IssueAsync(string payload, string signature, int cardNo)
    {
        var nonce = ReadNonce(payload);
        if (nonce is null) return new(400, "The order could not be read.");

        GuestCardOrder order;
        (GuestCardOrder Order, string Payload, DateTimeOffset AcceptedAt) known;
        bool isKnown;
        lock (_gate) isKnown = _orders.TryGetValue(nonce, out known);
        if (isKnown)
        {
            if (known.Payload != payload || !_verifier.SignatureValid(payload, signature)) return new(400, "This order does not match the one already accepted.");
            if (_time.GetUtcNow() - known.AcceptedAt > _orderLifetime) return new(410, "This order has expired. Start again from the booking.");
            order = known.Order;
        }
        else
        {
            var verified = _verifier.Verify(payload, signature);
            if (verified.Order is null) return new(400, verified.Error);
            order = verified.Order;
            var at = _time.GetUtcNow();
            _journal.Append(new JournalEntry("order", nonce, Payload: payload, At: at));
            lock (_gate) _orders[nonce] = (order, payload, at);
        }

        var card = order.Cards.FirstOrDefault(c => c.CardNo == cardNo);
        if (card is null) return new(400, "That card is not part of this order.", nonce, cardNo);

        if (AlreadyHandled(nonce, cardNo) is { } done) return done;
        if (!await _one.WaitAsync(0)) return new(409, "The encoder is busy with another card. Wait a moment.", nonce, cardNo, "busy");
        try
        {
            // Again under the lock: a retry that raced the first attempt must not write the card twice.
            if (AlreadyHandled(nonce, cardNo) is { } raced) return raced;
            _journal.Append(new JournalEntry("intent", nonce, cardNo, At: _time.GetUtcNow()));
            lock (_gate) _cards[(nonce, cardNo)] = new CardState("writing", null, false);

            CardWriteResult result;
            using var timeout = new CancellationTokenSource(_writeTimeout);
            try
            {
                // Not tied to the browser request: closing the tab must not cut a write short.
                result = await _driver.WriteGuestCardAsync(new GuestCardRequest(card.CardNo, card.LockNos, order.Begin, order.End, order.Dai), timeout.Token);
            }
            catch (OperationCanceledException) { result = new(CardWriteStatus.Unknown, "The encoder did not answer in time."); }
            catch (Exception ex) { result = new(CardWriteStatus.Unknown, $"The encoder failed mid-write: {ex.Message}"); }

            Record(nonce, cardNo, result.Status, result.Error);
            return new(200, result.Error, nonce, cardNo, StatusName(result.Status));
        }
        finally
        {
            _one.Release();
        }
    }

    /// <summary>A card already written, being written, or cut off is not written again. A failed one may be retried.</summary>
    private IssueOutcome? AlreadyHandled(string nonce, int cardNo)
    {
        CardState? state;
        lock (_gate) state = _cards.GetValueOrDefault((nonce, cardNo));
        return state?.Status switch
        {
            "issued" => new(200, null, nonce, cardNo, "issued"),
            "writing" => new(409, "This card is being written now.", nonce, cardNo, "writing"),
            "unknown" => new(409, "Writing this card was cut off. Try it at the door; if it does not open, make another card.", nonce, cardNo, "unknown"),
            _ => null,
        };
    }

    private void Record(string nonce, int cardNo, CardWriteStatus status, string? error)
    {
        _journal.Append(new JournalEntry("result", nonce, cardNo, StatusName(status), error, At: _time.GetUtcNow()));
        lock (_gate) _cards[(nonce, cardNo)] = new CardState(StatusName(status), error, false);
        ResultsChanged?.Invoke();
    }

    public static string StatusName(CardWriteStatus s) => s switch
    {
        CardWriteStatus.Issued => "issued",
        CardWriteStatus.Failed => "failed",
        _ => "unknown",
    };

    public IReadOnlyDictionary<int, CardState> OrderState(string nonce)
    {
        lock (_gate) return _cards.Where(kv => kv.Key.Nonce == nonce).ToDictionary(kv => kv.Key.CardNo, kv => kv.Value);
    }

    /// <summary>Results the server has not acknowledged yet, grouped by order.</summary>
    public IReadOnlyList<(string Nonce, IReadOnlyList<(int CardNo, CardState State)> Cards)> PendingReceipts()
    {
        lock (_gate)
            return _cards
                .Where(kv => !kv.Value.Sent && kv.Value.Status is "issued" or "failed" or "unknown")
                .GroupBy(kv => kv.Key.Nonce)
                .Select(g => (g.Key, (IReadOnlyList<(int, CardState)>)g.Select(kv => (kv.Key.CardNo, kv.Value)).OrderBy(x => x.Item1).ToList()))
                .ToList();
    }

    public void MarkSent(string nonce, IEnumerable<int> cardNos, string? error = null)
    {
        foreach (var no in cardNos)
        {
            _journal.Append(new JournalEntry("sent", nonce, no, Error: error, At: _time.GetUtcNow()));
            lock (_gate)
                if (_cards.TryGetValue((nonce, no), out var s)) _cards[(nonce, no)] = s with { Sent = true };
        }
    }

    private static string? ReadNonce(string payload)
    {
        try
        {
            using var doc = JsonDocument.Parse(payload);
            return doc.RootElement.TryGetProperty("nonce", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
        }
        catch (JsonException) { return null; }
    }
}
