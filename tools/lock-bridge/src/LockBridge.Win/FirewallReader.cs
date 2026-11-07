using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using LockBridge.Core;

namespace LockBridge.Win;

/// <summary>
/// Reads Windows Firewall through its COM interface (HNetCfg.FwPolicy2), which any user may
/// read, to see whether other computers are kept away from Joney's lock program. The judging is
/// in <see cref="Firewall"/>. Null when the firewall can't be read: the bridge then keeps warning.
/// Rules it fails to read are skipped, which can only turn the answer into "no".
/// </summary>
internal static class FirewallReader
{
    public static bool? BlocksInbound(int port, out string detail)
    {
        object? policy = null;
        try
        {
            var type = Type.GetTypeFromProgID("HNetCfg.FwPolicy2", throwOnError: false);
            if (type is null) { detail = "firewall check: HNetCfg.FwPolicy2 is not registered"; return null; }
            policy = Activator.CreateInstance(type)!;
            var current = Convert.ToInt32(Get(policy, "CurrentProfileTypes"));
            var rules = RulesNaming(Get(policy, "Rules")!, port);
            var on = new Dictionary<int, bool>();
            foreach (var bit in Firewall.ProfileBits)
                if ((current & bit) != 0) on[bit] = Convert.ToBoolean(Get(policy, "FirewallEnabled", bit));
            var blocks = Firewall.BlocksInbound(rules, current, bit => on.GetValueOrDefault(bit), port);
            detail = $"firewall check: profiles in use {current}, firewall on {string.Join(",", on.Select(p => $"{p.Key}={p.Value}"))}, " +
                $"{rules.Count} rule(s) name port {port}; blocks other computers: {blocks}";
            return blocks;
        }
        catch (Exception ex)
        {
            detail = $"firewall check failed: {ex.GetType().Name}: {ex.Message}";
            return null;
        }
        finally
        {
            if (policy is not null && Marshal.IsComObject(policy)) Marshal.FinalReleaseComObject(policy);
        }
    }

    /// <summary>The rules whose local ports include <paramref name="port"/>: no other rule can matter.</summary>
    private static List<FirewallRule> RulesNaming(object all, int port)
    {
        var found = new List<FirewallRule>();
        var e = (IEnumVARIANT)NewEnum(all);
        try
        {
            var one = new object?[1];
            while (e.Next(1, one, IntPtr.Zero) == 0)
            {
                var r = one[0];
                one[0] = null;
                if (r is null) continue;
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
        }
        finally { if (Marshal.IsComObject(e)) Marshal.ReleaseComObject(e); }
        return found;
    }

    /// <summary>The collection's enumerator: its _NewEnum property (DISPID_NEWENUM, -4).</summary>
    private static object NewEnum(object collection)
    {
        try { return Get(collection, "[DISPID=-4]")!; }
        catch (Exception) { return Get(collection, "_NewEnum")!; }
    }

    private static object? Get(object com, string name, params object[] args) =>
        com.GetType().InvokeMember(name, BindingFlags.GetProperty, null, com, args);
}
