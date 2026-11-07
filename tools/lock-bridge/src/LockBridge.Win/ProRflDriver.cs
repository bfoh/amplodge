using System.Collections.Concurrent;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;
using LockBridge.Core;

namespace LockBridge.Win;

/// <summary>
/// Joney's encoder through their proRFL.dll (SDK V0925). The DLL is a client of
/// Joney's Lock Management System, which must be running on this PC: each call
/// is a text command to it on 127.0.0.1:10086, answered within about 3 s, and
/// the DLL waits for the answer by pumping the calling thread's messages. So
/// every DLL call runs on one STA thread, one job at a time. A job whose caller
/// has given up is never started late, so a write cannot land on whatever card
/// is lying on the encoder minutes later.
/// </summary>
public sealed class ProRflDriver : ILockDriver, IDisposable
{
    // A write is four calls to the lock program (read, card type, write, read back) of up to ~3 s each.
    private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(20);

    private readonly EncoderSettings _settings;
    private readonly int? _hotelId;
    private readonly FileLog _log;
    private readonly BlockingCollection<Job> _jobs = [];
    private readonly Thread _thread;
    private long _runningSinceTicks;
    private string? _loadError;
    private string? _dllVersion;
    private bool _initialised;
    private LockServerState? _serverState;
    private DriverStatus _lastStatus = new(false, null, "Starting…");

    private sealed record Job(Action Work, Action<Exception> Cancel, CancellationToken Ct, DateTimeOffset Deadline);

    public ProRflDriver(EncoderSettings settings, int? hotelId, FileLog log)
    {
        (_settings, _hotelId, _log) = (settings, hotelId, log);
        _thread = new Thread(Run) { IsBackground = true, Name = "proRFL" };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        OnWorker(Load, CancellationToken.None).ContinueWith(t => _log.Write($"loading failed: {t.Exception?.GetBaseException().Message}"), TaskContinuationOptions.OnlyOnFaulted);
    }

    public string Name => "proRFL";

    private EncoderCalibration Cal => _settings.Calibration;

    /// <summary>A DLL call has been running for longer than it ever should: the encoder or its driver has hung.</summary>
    public bool Stuck
    {
        get
        {
            var since = Interlocked.Read(ref _runningSinceTicks);
            return since != 0 && DateTimeOffset.UtcNow.UtcTicks - since > CallTimeout.Ticks;
        }
    }

    private void Run()
    {
        foreach (var job in _jobs.GetConsumingEnumerable())
        {
            if (job.Ct.IsCancellationRequested || DateTimeOffset.UtcNow > job.Deadline)
            {
                job.Cancel(new OperationCanceledException("Given up before it started."));
                continue;
            }
            Interlocked.Exchange(ref _runningSinceTicks, DateTimeOffset.UtcNow.UtcTicks);
            try { job.Work(); }
            finally { Interlocked.Exchange(ref _runningSinceTicks, 0); }
        }
    }

    private Task<T> OnWorker<T>(Func<T> work, CancellationToken ct)
    {
        if (Stuck) return Task.FromException<T>(new EncoderStuckException());
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        var deadline = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(5);
        _jobs.Add(new Job(
            () => { try { tcs.TrySetResult(work()); } catch (Exception ex) { tcs.TrySetException(ex); } },
            ex => tcs.TrySetException(ex),
            ct,
            deadline));
        return tcs.Task.WaitAsync(CallTimeout, ct);
    }

    // ---- on the worker thread only ------------------------------------------------

    private bool Load()
    {
        try
        {
            var dir = _settings.DllDirectory;
            var path = Path.Combine(dir, ProRfl.Dll);
            if (!File.Exists(path)) { _loadError = $"proRFL.dll is not in {dir}. See the probe README for where it comes from."; return false; }
            var hash = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path)));
            _log.Write($"proRFL.dll sha256 {hash}");
            // Unless encoder.json names another build, only the DLL from Joney's SDK V0925 is used.
            var pinned = _settings.ProRflSha256 is { Length: > 0 } p ? p : ProRfl.JoneyV0925Sha256;
            if (!string.Equals(pinned, hash, StringComparison.OrdinalIgnoreCase))
            {
                _loadError = "proRFL.dll is not the build this bridge was set up for (Joney's SDK V0925, or the one named in encoder.json). Ask the developer.";
                _log.Write(_loadError);
                return false;
            }
            ProRfl.LoadFrom(dir);
            var version = new StringBuilder(256);
            var rc = ProRfl.GetDLLVersion(version);
            _dllVersion = version.ToString().Trim() is { Length: > 0 } v ? v : $"proRFL (code {rc})";
            _log.Write($"GetDLLVersion -> {rc} \"{_dllVersion}\"");
            return true;
        }
        catch (Exception ex) when (ex is DllNotFoundException or BadImageFormatException or EntryPointNotFoundException or IOException)
        {
            _loadError = $"proRFL.dll could not be loaded: {ex.Message}";
            _log.Write(_loadError);
            return false;
        }
    }

    private string? NotReadyReason()
    {
        if (_loadError is not null) return _loadError;
        if (_dllVersion is null) return "Loading proRFL.dll…";
        if (!Cal.Calibrated) return "Card writing is not switched on yet: the encoder has to be checked with the probe first.";
        if (_hotelId is not int id || id == 0) return "The hotel's lock ID is not set on this PC yet.";
        return ServerProblem();
    }

    /// <summary>Is Joney's lock program listening for the DLL? Looks at this PC's listening ports; connects to nothing.</summary>
    private string? ServerProblem()
    {
        LockServerState state;
        try { state = LockServer.Judge(IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()); }
        catch (NetworkInformationException ex)
        {
            _log.Write($"listening-port check failed: {ex.Message}");
            return "Could not check whether Joney's lock program is running.";
        }
        if (state != _serverState)
        {
            _log.Write($"lock program on port {LockServer.Port}: {state}");
            if (state == LockServerState.OpenToNetwork) _log.Write("WARNING: " + LockServer.OpenToNetworkWarning);
            _serverState = state;
        }
        if (state != LockServerState.NotRunning) return null;
        // When the program comes back, connect to it again.
        _initialised = false;
        return LockServer.NotRunningMessage;
    }

    /// <summary>initializeUSB connects the DLL to the lock program. It answers 0 even when that failed, hence ServerProblem.</summary>
    private bool EnsureInitialised()
    {
        if (_initialised) return true;
        var rc = ProRfl.initializeUSB(Cal.UsbType);
        _log.Write($"initializeUSB({Cal.UsbType}) -> {rc}");
        _initialised = Cal.InitOkCodes.Contains(rc);
        return _initialised;
    }

    private const string NoConnection = "The lock bridge could not connect to Joney's lock program. Close the program and open it again, then restart the lock bridge.";

    private (bool Ok, string Hex, int Code) Read()
    {
        var buffer = new StringBuilder(ProRfl.BufferChars);
        var rc = ProRfl.ReadCard(Cal.UsbType, buffer);
        var hex = buffer.ToString().Trim();
        // Never logged: the card's data stays on this PC, in memory only.
        return (Cal.ReadOkCodes.Contains(rc) && hex.Length > 0, hex, rc);
    }

    private CardWriteResult Write(GuestCardRequest request)
    {
        if (NotReadyReason() is { } why) return new(CardWriteStatus.Failed, why);
        if (request.LockNos.Count != 1) return new(CardWriteStatus.Failed, "One card for two doors is not supported: make one card per door.");
        var lockNo = request.LockNos[0];
        if (!CardFormat.IsLockNo(lockNo) || request.Dai is < 1 or > 255) return new(CardWriteStatus.Failed, "The card's lock code or DAI is not valid.");
        var hotel = _hotelId!.Value;
        if (!EnsureInitialised()) return new(CardWriteStatus.Failed, NoConnection);

        // 1. Look before writing: never write over a card that is not blank or a guest card.
        var before = Read();
        _log.Write($"ReadCard -> {before.Code} ({before.Hex.Length} chars)");
        if (!before.Ok) return new(CardWriteStatus.Failed, "No card on the encoder, or it could not be read. Lay one card flat on the encoder. If one is there, check that Joney's lock program is open and logged in.");
        var type = new StringBuilder(256);
        var typeRc = ProRfl.GetCardTypeByCardDataStr(before.Hex, type);
        var kind = EncoderRules.Classify(type.ToString(), Cal);
        var layout = EncoderRules.FromCardData(before.Hex);
        _log.Write($"GetCardTypeByCardDataStr -> {typeRc} \"{type}\" = {kind}; card data says {layout}");
        if (kind == CardKind.Other || kind != layout)
            return new(CardWriteStatus.Failed, "This is not a blank or guest card, so it was not touched. It may be one of the hotel's master or setup cards: put it away safely and use a spare guest card.");

        // 2. Write. Joney's DLL passes on the card number, lock code, end time and DAI; it ignores
        //    the hotel ID, the deadbolt and public-door flags (left 0) and the begin time (their
        //    program sets that itself).
        var written = new StringBuilder(ProRfl.BufferChars);
        var rc = ProRfl.GuestCard(Cal.UsbType, hotel, (byte)request.CardNo, (byte)request.Dai, 0, 0, request.Begin, request.End, lockNo, written);
        _log.Write($"GuestCard(card {request.CardNo}, lock {lockNo}, dai {request.Dai}, {request.Begin}-{request.End}) -> {rc}");

        // 3. Read it back with the DLL's own decoders: the card's content decides.
        var after = Read();
        string? lockRead = null, endRead = null;
        if (after.Ok)
        {
            var l = new StringBuilder(256);
            var e = new StringBuilder(256);
            var lrc = ProRfl.GetGuestLockNoByCardDataStr(hotel, after.Hex, l);
            var erc = ProRfl.GetGuestETimeByCardDataStr(hotel, after.Hex, e);
            (lockRead, endRead) = (l.ToString(), e.ToString());
            _log.Write($"read back -> {after.Code}; lock {lrc} \"{lockRead}\"; end {erc} \"{endRead}\"");
        }
        else _log.Write($"read back -> {after.Code}, unreadable");

        var result = EncoderRules.Judge(Cal, rc, after.Ok, lockRead, endRead, lockNo, request.End);
        if (result.Status == CardWriteStatus.Issued && Cal.BeepOnSuccess) ProRfl.Buzzer(Cal.UsbType, 30);
        return result;
    }

    // ---- ILockDriver ---------------------------------------------------------------

    public async Task<DriverStatus> StatusAsync(CancellationToken ct)
    {
        // Never queue behind a write: report what is known.
        if (Interlocked.Read(ref _runningSinceTicks) != 0)
            return Stuck ? new DriverStatus(false, _dllVersion, new EncoderStuckException().Message) : _lastStatus;
        try
        {
            _lastStatus = await OnWorker(() =>
            {
                if (NotReadyReason() is { } why) return new DriverStatus(false, _dllVersion, why);
                if (!EnsureInitialised()) return new DriverStatus(false, _dllVersion, NoConnection);
                return _serverState == LockServerState.OpenToNetwork
                    ? new DriverStatus(true, _dllVersion, "Encoder ready. Warning: " + LockServer.OpenToNetworkWarning)
                    : new DriverStatus(true, _dllVersion, "Encoder ready.");
            }, ct);
        }
        catch (Exception ex) when (ex is TimeoutException or EncoderStuckException)
        {
            _lastStatus = new DriverStatus(false, _dllVersion, ex is EncoderStuckException ? ex.Message : "The lock program did not answer in time.");
        }
        return _lastStatus;
    }

    public async Task<CardWriteResult> WriteGuestCardAsync(GuestCardRequest request, CancellationToken ct)
    {
        try
        {
            return await OnWorker(() => Write(request), ct);
        }
        catch (TimeoutException)
        {
            _initialised = false;
            return new CardWriteResult(CardWriteStatus.Unknown, "The encoder took too long to answer. Try the card at the door.");
        }
        catch (EncoderStuckException ex)
        {
            // Refused before anything was queued: nothing was written.
            return new CardWriteResult(CardWriteStatus.Failed, ex.Message);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // Never started (the worker was busy past this job's start deadline): nothing was written.
            return new CardWriteResult(CardWriteStatus.Failed, "The encoder was busy. Try again.");
        }
    }

    public void Dispose() => _jobs.CompleteAdding();
}

public sealed class EncoderStuckException() : Exception("The lock program stopped answering. Close Joney's lock program and open it again, then restart the lock bridge.");
