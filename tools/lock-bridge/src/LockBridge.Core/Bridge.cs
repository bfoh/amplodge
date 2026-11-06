using System.Net;
using System.Threading.Channels;

namespace LockBridge.Core;

public sealed class BridgeOptions
{
    public int Port { get; init; } = 47123;
    /// <summary>The only Host header accepted, so a web page cannot reach the bridge by DNS rebinding.</summary>
    public string ExpectedHost { get; init; } = "127.0.0.1:47123";
    public IReadOnlyList<string> AllowedOrigins { get; init; } = ["https://amplodge.org", "https://www.amplodge.org"];
    public Uri ServerUrl { get; init; } = new("https://amplodge.org");
    public TimeSpan ChallengeLifetime { get; init; } = TimeSpan.FromMinutes(5);
    /// <summary>Under the server's 15 minutes for a pending card, so the bridge gives up first.</summary>
    public TimeSpan OrderLifetime { get; init; } = TimeSpan.FromMinutes(10);
    public TimeSpan WriteTimeout { get; init; } = TimeSpan.FromSeconds(30);
    /// <summary>The server caps a stay at 30 days; a day's slack for the clocks.</summary>
    public TimeSpan MaxValidity { get; init; } = TimeSpan.FromDays(31);
    public string BridgeVersion { get; init; } = typeof(BridgeOptions).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
}

/// <summary>
/// Sends each card result to the server, retrying until the server has it.
/// Results wait in the journal meanwhile, so an internet cut loses nothing.
/// </summary>
public sealed class ReceiptSender(CardWriter writer, ServerClient server, BridgeConfig config, BridgeOptions options, Func<string?> dllVersion, TimeProvider time)
{
    private readonly Channel<bool> _poke = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    public string? LastError { get; private set; }
    public DateTimeOffset? LastSentAt { get; private set; }
    /// <summary>The server no longer knows this PC: an admin revoked it. Pair again.</summary>
    public bool Revoked { get; private set; }

    public void Poke() => _poke.Writer.TryWrite(true);

    public async Task RunAsync(CancellationToken ct)
    {
        var backoff = TimeSpan.FromSeconds(5);
        while (!ct.IsCancellationRequested)
        {
            bool done;
            try { done = await SendPendingAsync(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception ex) { LastError = ex.Message; done = false; }

            TimeSpan wait;
            if (done) { backoff = TimeSpan.FromSeconds(5); wait = TimeSpan.FromMinutes(1); }
            else { wait = Revoked ? TimeSpan.FromMinutes(5) : backoff; backoff = TimeSpan.FromTicks(Math.Min(backoff.Ticks * 2, TimeSpan.FromMinutes(5).Ticks)); }

            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var delay = Task.Delay(wait, time, linked.Token);
            var poked = _poke.Reader.WaitToReadAsync(linked.Token).AsTask();
            try { await Task.WhenAny(delay, poked); }
            finally { linked.Cancel(); }
            _poke.Reader.TryRead(out _);
        }
    }

    /// <summary>One pass over everything unsent. True when nothing is left waiting.</summary>
    public async Task<bool> SendPendingAsync(CancellationToken ct)
    {
        var url = new Uri(config.ServerUrl);
        var allSent = true;
        foreach (var (nonce, cards) in writer.PendingReceipts())
        {
            var receipt = new Receipt(nonce, [.. cards.Select(c => new ReceiptCard(c.CardNo, c.State.Status, c.State.Error))], options.BridgeVersion, dllVersion());
            var reply = await server.SendReceiptAsync(url, config.DeviceToken, receipt, ct);
            if (reply.Ok)
            {
                writer.MarkSent(nonce, cards.Select(c => c.CardNo));
                LastSentAt = time.GetUtcNow();
                LastError = null;
                Revoked = false;
                continue;
            }
            allSent = false;
            LastError = reply.Error;
            if (reply.Status == HttpStatusCode.Unauthorized) { Revoked = true; return false; }
            if (reply.Transient) return false;
            // The server refused this order for good (unknown order, another PC's order). Keep the
            // reason in the journal and move on, rather than retrying it forever.
            writer.MarkSent(nonce, cards.Select(c => c.CardNo), reply.Error);
            allSent = true;
        }
        return allSent;
    }
}

/// <summary>What exists once this PC is paired.</summary>
public sealed class PairedSession
{
    public required BridgeConfig Config { get; init; }
    public required ChallengeStore Challenges { get; init; }
    public required CardWriter Writer { get; init; }
    public required ReceiptSender Receipts { get; init; }
    internal CancellationTokenSource Stop { get; } = new();
    internal Task? Loop { get; set; }
}

public sealed record PairOutcome(int HttpStatus, string? Error, BridgeConfig? Config = null);

/// <summary>The bridge as a whole: the encoder, the journal and, once paired, the session.</summary>
public sealed class Bridge(BridgeOptions options, ILockDriver driver, IConfigStore store, Journal journal, ServerClient server, TimeProvider time) : IAsyncDisposable
{
    private readonly SemaphoreSlim _pairing = new(1, 1);
    private PairedSession? _session;

    public BridgeOptions Options => options;
    public ILockDriver Driver => driver;
    public PairedSession? Session => Volatile.Read(ref _session);
    public string? DllVersion { get; set; }

    /// <summary>Picks up an existing pairing, if there is one.</summary>
    public void Start()
    {
        if (store.Load() is { } config) Begin(config);
    }

    private void Begin(BridgeConfig config)
    {
        var challenges = new ChallengeStore(config.EncoderId, time, options.ChallengeLifetime);
        var verifier = new OrderVerifier(config.EncoderId, config.ServerPublicKey, challenges, time, options.MaxValidity);
        var writer = new CardWriter(driver, journal, verifier, time, options.OrderLifetime, options.WriteTimeout);
        var receipts = new ReceiptSender(writer, server, config, options, () => DllVersion, time);
        writer.ResultsChanged += receipts.Poke;
        var session = new PairedSession { Config = config, Challenges = challenges, Writer = writer, Receipts = receipts };
        session.Loop = Task.Run(() => receipts.RunAsync(session.Stop.Token));
        Volatile.Write(ref _session, session);
    }

    /// <summary>Redeems the one-time code an admin made in the portal's Settings. Only while unpaired.</summary>
    public async Task<PairOutcome> PairAsync(string code, CancellationToken ct)
    {
        if (!await _pairing.WaitAsync(0, ct)) return new(409, "Pairing is already under way.");
        try
        {
            if (Session is not null) return new(409, "This PC is already paired. Unpair it from the tray icon first.");
            var reply = await server.RedeemAsync(options.ServerUrl, code, options.BridgeVersion, DllVersion, ct);
            if (!reply.Ok) return new((int)reply.Status is 0 ? 502 : (int)reply.Status, reply.Error);
            var config = ServerClient.ReadPairing(reply, options.ServerUrl, time.GetUtcNow(), out var error);
            if (config is null) return new(502, error);
            store.Save(config);
            Begin(config);
            return new(200, null, config);
        }
        finally
        {
            _pairing.Release();
        }
    }

    /// <summary>Forgets the pairing (tray menu). The journal is kept.</summary>
    public async Task<bool> UnpairAsync()
    {
        var session = Session;
        if (session is null) return true;
        if (session.Writer.Busy) return false;
        Volatile.Write(ref _session, null);
        await StopAsync(session);
        store.Clear();
        return true;
    }

    private static async Task StopAsync(PairedSession session)
    {
        session.Writer.ResultsChanged -= session.Receipts.Poke;
        await session.Stop.CancelAsync();
        if (session.Loop is not null) await session.Loop;
    }

    public async ValueTask DisposeAsync()
    {
        if (Session is { } session) await StopAsync(session);
    }
}
