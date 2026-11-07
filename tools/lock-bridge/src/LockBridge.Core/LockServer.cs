using System.Net;

namespace LockBridge.Core;

public enum LockServerState { NotRunning, LocalOnly, OpenToNetwork }

/// <summary>
/// Joney's 2021 proRFL.dll does not touch the encoder. It sends each command to
/// their Lock Management System, which must be running on this PC and listening
/// on 127.0.0.1:10086 (fixed in the DLL). Its initializeUSB answers "success"
/// even when nothing is listening, and every call then waits about 3 s and
/// reports the code a missing card gives. So the driver looks at the PC's
/// listening ports itself before each job: that connects to nothing, and tells
/// "the program is closed" apart from "no card on the encoder".
/// </summary>
public static class LockServer
{
    public const int Port = 10086;

    public const string NotRunningMessage =
        "Joney's Lock Management System is not running on this PC (nothing is listening on port 10086). Open it and log in, then try again.";

    public const string OpenToNetworkWarning =
        "Joney's lock program accepts connections from the network on port 10086, so another computer could ask it for cards. Block port 10086 in Windows Firewall (the developer can help).";

    /// <summary>From the PC's listening TCP endpoints: can the DLL reach the program, and can other computers?</summary>
    public static LockServerState Judge(IEnumerable<IPEndPoint> listeners, int port = Port)
    {
        var mine = listeners.Where(l => l.Port == port).ToList();
        // The DLL connects to 127.0.0.1 (IPv4), which a listener on 127.0.0.1 or on every IPv4 address (0.0.0.0) takes.
        var reachable = mine.Any(l => l.Address.Equals(IPAddress.Loopback) || l.Address.Equals(IPAddress.Any));
        if (!reachable) return LockServerState.NotRunning;
        return mine.Any(l => !IPAddress.IsLoopback(l.Address)) ? LockServerState.OpenToNetwork : LockServerState.LocalOnly;
    }
}
