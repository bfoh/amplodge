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
}

/// <summary>A pretend encoder for development and tests: it remembers what it "wrote".</summary>
public sealed class SimulatorDriver(TimeSpan? delay = null) : ILockDriver
{
    private readonly List<GuestCardRequest> _written = [];

    public string Name => "simulator";

    /// <summary>The next writes' outcomes, in order; after that every write succeeds.</summary>
    public Queue<CardWriteResult> Script { get; } = new();

    public IReadOnlyList<GuestCardRequest> Written { get { lock (_written) return [.. _written]; } }

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
}
