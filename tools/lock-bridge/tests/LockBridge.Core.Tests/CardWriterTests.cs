using LockBridge.Core;

namespace LockBridge.Core.Tests;

public class CardWriterTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly FakeServerKey _key = new();
    private readonly ManualTime _time = new(Orders.Now);
    private readonly ProbeDriver _driver = new();
    private ChallengeStore _challenges = null!;
    private Journal _journal = null!;
    private CardWriter _writer = null!;

    public CardWriterTests() => Open();

    /// <summary>(Re)starts the bridge on the same journal file, as after a restart.</summary>
    private void Open()
    {
        _journal?.Dispose();
        _journal = new Journal(_dir.File("journal.jsonl"));
        _challenges = new ChallengeStore(Orders.Encoder, _time, TimeSpan.FromMinutes(5));
        var verifier = new OrderVerifier(Orders.Encoder, _key.PublicKey, _challenges, _time, TimeSpan.FromDays(31));
        _writer = new CardWriter(_driver, _journal, verifier, _time, TimeSpan.FromMinutes(10), TimeSpan.FromSeconds(5));
    }

    public void Dispose()
    {
        _journal.Dispose();
        _key.Dispose();
        _dir.Dispose();
    }

    private (string Payload, string Signature) NewOrder()
    {
        var payload = Orders.Payload(_challenges.Issue());
        return (payload, _key.Sign(payload));
    }

    [Fact]
    public async Task Writes_each_card_once_and_answers_repeats_from_the_journal()
    {
        var (payload, sig) = NewOrder();

        var first = await _writer.IssueAsync(payload, sig, 0);
        Assert.Equal((200, "issued"), (first.HttpStatus, first.Status));
        var repeat = await _writer.IssueAsync(payload, sig, 0);
        Assert.Equal((200, "issued"), (repeat.HttpStatus, repeat.Status));
        Assert.Equal(1, _driver.Writes);

        var second = await _writer.IssueAsync(payload, sig, 1);
        Assert.Equal("issued", second.Status);
        Assert.Equal(2, _driver.Writes);
    }

    [Fact]
    public async Task The_journal_has_the_intent_on_disk_before_the_encoder_is_touched()
    {
        var path = _dir.File("journal.jsonl");
        string? seen = null;
        _driver.OnWrite = (req, _) =>
        {
            using var read = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            seen = new StreamReader(read).ReadToEnd();
            return Task.FromResult(new CardWriteResult(CardWriteStatus.Issued));
        };
        var (payload, sig) = NewOrder();
        await _writer.IssueAsync(payload, sig, 0);

        Assert.NotNull(seen);
        Assert.Contains("\"t\":\"order\"", seen);
        Assert.Contains("\"t\":\"intent\"", seen);
        Assert.DoesNotContain("\"t\":\"result\"", seen);
    }

    [Fact]
    public async Task A_write_cut_off_by_a_restart_becomes_unknown_and_is_not_written_again()
    {
        var (payload, sig) = NewOrder();
        var nonce = Orders.NonceOf(payload);
        // Simulate the power going off mid-write: the intent is on disk, the result never is.
        _journal.Append(new JournalEntry("order", nonce, Payload: payload, At: _time.GetUtcNow()));
        _journal.Append(new JournalEntry("intent", nonce, 0, At: _time.GetUtcNow()));

        Open();

        Assert.Equal("unknown", _writer.OrderState(nonce)[0].Status);
        var retry = await _writer.IssueAsync(payload, sig, 0);
        Assert.Equal((409, "unknown"), (retry.HttpStatus, retry.Status));
        Assert.Equal(0, _driver.Writes);
        Assert.Single(_writer.PendingReceipts());

        // The other card of the order can still be made.
        Assert.Equal("issued", (await _writer.IssueAsync(payload, sig, 1)).Status);
    }

    [Fact]
    public async Task Results_and_what_was_reported_survive_a_restart()
    {
        var (payload, sig) = NewOrder();
        var nonce = Orders.NonceOf(payload);
        await _writer.IssueAsync(payload, sig, 0);
        await _writer.IssueAsync(payload, sig, 1);
        _writer.MarkSent(nonce, [0]);

        Open();

        var pending = Assert.Single(_writer.PendingReceipts());
        Assert.Equal(nonce, pending.Nonce);
        Assert.Equal(1, Assert.Single(pending.Cards).CardNo);
        var again = await _writer.IssueAsync(payload, sig, 0);
        Assert.Equal((200, "issued"), (again.HttpStatus, again.Status));
        Assert.Equal(2, _driver.Writes);
    }

    [Fact]
    public async Task A_failed_card_may_be_tried_again()
    {
        _driver.OnWrite = (_, _) => Task.FromResult(new CardWriteResult(CardWriteStatus.Failed, "No card on the encoder."));
        var (payload, sig) = NewOrder();
        var failed = await _writer.IssueAsync(payload, sig, 0);
        Assert.Equal(("failed", "No card on the encoder."), (failed.Status, failed.Error));

        _driver.OnWrite = (_, _) => Task.FromResult(new CardWriteResult(CardWriteStatus.Issued));
        Assert.Equal("issued", (await _writer.IssueAsync(payload, sig, 0)).Status);
    }

    [Fact]
    public async Task An_encoder_that_hangs_or_throws_leaves_the_card_unknown()
    {
        var hang = new CardWriter(_driver, _journal, new OrderVerifier(Orders.Encoder, _key.PublicKey, _challenges, _time, TimeSpan.FromDays(31)), _time, TimeSpan.FromMinutes(10), TimeSpan.FromMilliseconds(100));
        _driver.OnWrite = async (_, ct) => { await Task.Delay(Timeout.Infinite, ct); return new CardWriteResult(CardWriteStatus.Issued); };
        var (payload, sig) = NewOrder();
        Assert.Equal("unknown", (await hang.IssueAsync(payload, sig, 0)).Status);

        _driver.OnWrite = (_, _) => throw new InvalidOperationException("USB gone");
        var thrown = await hang.IssueAsync(payload, sig, 1);
        Assert.Equal("unknown", thrown.Status);
        Assert.Contains("USB gone", thrown.Error);
    }

    [Fact]
    public async Task One_card_at_a_time()
    {
        var release = new TaskCompletionSource();
        _driver.OnWrite = async (_, _) => { await release.Task; return new CardWriteResult(CardWriteStatus.Issued); };
        var (payload, sig) = NewOrder();

        var first = _writer.IssueAsync(payload, sig, 0);
        Assert.True(_writer.Busy);
        var same = await _writer.IssueAsync(payload, sig, 0);
        Assert.Equal((409, "writing"), (same.HttpStatus, same.Status));
        var other = await _writer.IssueAsync(payload, sig, 1);
        Assert.Equal((409, "busy"), (other.HttpStatus, other.Status));

        release.SetResult();
        Assert.Equal("issued", (await first).Status);
        Assert.Equal(1, _driver.Writes);
    }

    [Fact]
    public async Task A_known_order_must_match_and_expires()
    {
        var (payload, sig) = NewOrder();
        await _writer.IssueAsync(payload, sig, 0);

        var changed = payload.Replace("Test Guest", "Someone Else");
        Assert.Equal(400, (await _writer.IssueAsync(changed, _key.Sign(changed), 1)).HttpStatus);
        Assert.Equal(400, (await _writer.IssueAsync(payload, _key.Sign("other"), 1)).HttpStatus);
        Assert.Equal(400, (await _writer.IssueAsync(payload, sig, 7)).HttpStatus);

        _time.Advance(TimeSpan.FromMinutes(11));
        Assert.Equal(410, (await _writer.IssueAsync(payload, sig, 1)).HttpStatus);
        Assert.Equal(1, _driver.Writes);
    }

    [Fact]
    public async Task Garbage_is_refused_without_touching_the_encoder()
    {
        Assert.Equal(400, (await _writer.IssueAsync("not json", "x", 0)).HttpStatus);
        Assert.Equal(400, (await _writer.IssueAsync("{\"nonce\":\"abc\"}", "x", 0)).HttpStatus);
        Assert.Equal(0, _driver.Writes);
    }

    [Fact]
    public void A_line_torn_by_a_power_cut_is_skipped()
    {
        _journal.Append(new JournalEntry("intent", "n1", 0, At: _time.GetUtcNow()));
        _journal.Dispose();
        File.AppendAllText(_dir.File("journal.jsonl"), "{\"t\":\"result\",\"nonce\":\"n1\",\"car");
        _journal = new Journal(_dir.File("journal.jsonl"));
        Assert.Single(_journal.Entries);

        // The next entry starts on its own line instead of being glued to the torn one.
        _journal.Append(new JournalEntry("result", "n1", 0, "unknown", At: _time.GetUtcNow()));
        _journal.Dispose();
        _journal = new Journal(_dir.File("journal.jsonl"));
        Assert.Equal(["intent", "result"], _journal.Entries.Select(e => e.T));
    }
}
