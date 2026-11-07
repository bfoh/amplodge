using System.Collections;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using LockBridge.Core;

namespace LockBridge.Win;

/// <summary>
/// Reads Windows Firewall to see whether other computers are kept away from Joney's lock
/// program. The judging is in <see cref="Firewall"/>. First through the firewall's COM interface
/// (HNetCfg.FwPolicy2: fast, in-process); when that fails or finds no such rule, through the
/// PowerShell the probe used, which worked on the reception PC. Null when neither can read
/// the firewall: the bridge then keeps warning. Slow (PowerShell takes seconds), so it is never
/// called on the encoder's thread.
/// </summary>
internal static class FirewallReader
{
    public static bool? BlocksInbound(int port, out string detail)
    {
        var com = ViaCom(port, out var comDetail);
        if (com == true) { detail = $"firewall check: COM: {comDetail}"; return true; }
        var ps = ViaPowerShell(port, out var psDetail);
        detail = $"firewall check: COM: {comDetail}; PowerShell: {psDetail}";
        return ps ?? com;
    }

    private static bool? ViaCom(int port, out string detail)
    {
        object? policy = null;
        var step = "HNetCfg.FwPolicy2";
        try
        {
            var type = Type.GetTypeFromProgID("HNetCfg.FwPolicy2", throwOnError: false);
            if (type is null) { detail = "HNetCfg.FwPolicy2 is not registered"; return null; }
            policy = Activator.CreateInstance(type)!;
            step = "CurrentProfileTypes";
            var current = Convert.ToInt32(Get(policy, "CurrentProfileTypes"));
            step = "Rules";
            var all = Get(policy, "Rules")!;
            step = "the rules";
            var rules = RulesNaming(all, port, ref step);
            step = "FirewallEnabled";
            var on = new Dictionary<int, bool>();
            foreach (var bit in Firewall.ProfileBits)
                if ((current & bit) != 0) on[bit] = Convert.ToBoolean(Get(policy, "FirewallEnabled", bit));
            var view = new FirewallView(current, on, rules);
            var blocks = view.BlocksInbound(port);
            detail = $"{view.Describe(port)}; blocks other computers: {blocks}";
            return blocks;
        }
        catch (Exception ex)
        {
            if (ex is TargetInvocationException { InnerException: { } inner }) ex = inner;
            detail = $"failed at {step}: {ex.GetType().Name}: {ex.Message} (0x{ex.HResult:X8})";
            return null;
        }
        finally
        {
            if (policy is not null && Marshal.IsComObject(policy)) Marshal.FinalReleaseComObject(policy);
        }
    }

    /// <summary>The rules whose local ports include <paramref name="port"/>: no other rule can matter.</summary>
    private static List<FirewallRule> RulesNaming(object all, int port, ref string step)
    {
        var found = new List<FirewallRule>();
        foreach (var r in Items(all, ref step))
        {
            try
            {
                var ports = Get(r, "LocalPorts") as string;
                if (!Firewall.ListsPort(ports, port)) continue;
                found.Add(new FirewallRule(
                    Enabled: Convert.ToBoolean(Get(r, "Enabled")),
                    Inbound: Convert.ToInt32(Get(r, "Direction")) == 1, // NET_FW_RULE_DIR_IN
                    Block: Convert.ToInt32(Get(r, "Action")) == 0,      // NET_FW_ACTION_BLOCK
                    Protocol: Convert.ToInt32(Get(r, "Protocol")),
                    LocalPorts: ports,
                    RemoteAddresses: Get(r, "RemoteAddresses") as string,
                    Profiles: Convert.ToInt32(Get(r, "Profiles"))));
            }
            catch (Exception) { /* unreadable: skipped, which can only mean "not blocked" */ }
            finally { if (Marshal.IsComObject(r)) Marshal.ReleaseComObject(r); }
        }
        return found;
    }

    /// <summary>
    /// The collection's items. .NET can enumerate a COM collection itself; failing that, ask for
    /// its enumerator (_NewEnum, DISPID -4) and walk it.
    /// </summary>
    private static List<object> Items(object collection, ref string step)
    {
        step = "enumerating the rules";
        if (collection is IEnumerable list)
        {
            try { return [.. list.Cast<object>().Where(o => o is not null)]; }
            catch (Exception) { step = "enumerating the rules through _NewEnum"; }
        }
        else step = "enumerating the rules through _NewEnum";
        object en;
        try { en = Get(collection, "[DISPID=-4]")!; }
        catch (Exception) { en = Get(collection, "_NewEnum")!; }
        if (en is IEnumerator managed)
        {
            var items = new List<object>();
            while (managed.MoveNext()) if (managed.Current is { } o) items.Add(o);
            return items;
        }
        var e = (IEnumVARIANT)en;
        try
        {
            var items = new List<object>();
            var one = new object?[1];
            while (e.Next(1, one, IntPtr.Zero) == 0)
            {
                if (one[0] is { } o) items.Add(o);
                one[0] = null;
            }
            return items;
        }
        finally { if (Marshal.IsComObject(e)) Marshal.ReleaseComObject(e); }
    }

    private static object? Get(object com, string name, params object[] args) =>
        com.GetType().InvokeMember(name, BindingFlags.GetProperty, null, com, args);

    /// <summary>
    /// Windows PowerShell's firewall cmdlets (the probe's way). powershell.exe from this 32-bit
    /// process is the 32-bit one, as the probe ran. Hidden, at most 30 seconds.
    /// </summary>
    private static bool? ViaPowerShell(int port, out string detail)
    {
        try
        {
            var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            foreach (var a in (string[])["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", Firewall.PowerShellCheck(port)])
                psi.ArgumentList.Add(a);
            using var p = Process.Start(psi)!;
            var stdout = p.StandardOutput.ReadToEndAsync();
            var stderr = p.StandardError.ReadToEndAsync();
            if (!p.WaitForExit(30_000))
            {
                try { p.Kill(entireProcessTree: true); } catch (Exception) { /* already gone */ }
                detail = "no answer within 30 seconds";
                return null;
            }
            // The JSON is the last line that starts with "{"; warnings may come before it.
            var json = stdout.GetAwaiter().GetResult().Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.StartsWith('{'));
            if (p.ExitCode != 0 || json is null)
            {
                var why = stderr.GetAwaiter().GetResult().Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "no output";
                detail = $"exit code {p.ExitCode}: {why}";
                return null;
            }
            var view = Firewall.FromPowerShell(json);
            var blocks = view.BlocksInbound(port);
            detail = $"{view.Describe(port)}; blocks other computers: {blocks}";
            return blocks;
        }
        catch (Exception ex)
        {
            detail = $"{ex.GetType().Name}: {ex.Message}";
            return null;
        }
    }
}
