namespace LockBridge.Core;

public enum CardWriteStatus { Issued, Failed, Unknown }

/// <summary>
/// What to write on one guest card. Times are yyMMddHHmm, hotel time; lock codes
/// are 6 hex characters; Dai (1..255) is the stay's override number.
/// </summary>
public sealed record GuestCardRequest(int CardNo, IReadOnlyList<string> LockNos, string Begin, string End, int Dai);

/// <summary>The outcome of one write. Never carries the raw card data: that stays on this PC.</summary>
public sealed record CardWriteResult(CardWriteStatus Status, string? Error = null);

public sealed record DriverStatus(bool Ready, string? DllVersion, string Message);

/// <summary>What "Read a card" found on the encoder.</summary>
public enum CardReadKind { None, Blank, Guest, OtherHotel, Staff, Unknown }

/// <summary>
/// A card on the encoder, as far as staff need to know it. Never the card's data: for a guest
/// card of this hotel only its door, end time and DAI; for a staff or setup card only its kind.
/// End is yyMMddHHmm, hotel time.
/// </summary>
public sealed record CardReading(CardReadKind Kind, string? LockNo = null, string? End = null, int? Dai = null, string? StaffType = null, string? Message = null);

/// <summary>
/// The card encoder. On the reception PC this is Joney's encoder, driven by their
/// Lock Management System through proRFL.dll (LockBridge.Win); for development
/// it is the simulator.
/// Calls are made one at a time (CardWriter holds the lock).
/// </summary>
public interface ILockDriver
{
    string Name { get; }
    Task<DriverStatus> StatusAsync(CancellationToken ct);
    Task<CardWriteResult> WriteGuestCardAsync(GuestCardRequest request, CancellationToken ct);
    /// <summary>Reads the card on the encoder. Writes nothing.</summary>
    Task<CardReading> ReadCardAsync(CancellationToken ct);
}

/// <summary>A pretend encoder for development and tests: it remembers what it "wrote".</summary>
public sealed class SimulatorDriver(TimeSpan? delay = null) : ILockDriver
{
    private readonly List<GuestCardRequest> _written = [];

    public string Name => "simulator";

    /// <summary>The next writes' outcomes, in order; after that every write succeeds.</summary>
    public Queue<CardWriteResult> Script { get; } = new();

    public IReadOnlyList<GuestCardRequest> Written { get { lock (_written) return [.. _written]; } }

    /// <summary>What "Read a card" finds; by default the card written last (a guest card), or a blank one.</summary>
    public CardReading? OnEncoder { get; set; }

    public Task<DriverStatus> StatusAsync(CancellationToken ct) =>
        Task.FromResult(new DriverStatus(true, "simulator", "Simulated encoder: no card is really written."));

    public async Task<CardWriteResult> WriteGuestCardAsync(GuestCardRequest request, CancellationToken ct)
    {
        await Task.Delay(delay ?? TimeSpan.FromMilliseconds(400), ct);
        CardWriteResult result;
        lock (Script) result = Script.Count > 0 ? Script.Dequeue() : new CardWriteResult(CardWriteStatus.Issued);
        if (result.Status == CardWriteStatus.Issued) lock (_written) _written.Add(request);
        return result;
    }

    public async Task<CardReading> ReadCardAsync(CancellationToken ct)
    {
        await Task.Delay(delay ?? TimeSpan.FromMilliseconds(400), ct);
        if (OnEncoder is { } set) return set;
        GuestCardRequest? last;
        lock (_written) last = _written.Count > 0 ? _written[^1] : null;
        return last is null ? new CardReading(CardReadKind.Blank) : new CardReading(CardReadKind.Guest, last.LockNos[0], last.End, last.Dai);
    }
}
