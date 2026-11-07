namespace LockBridge.Core;

/// <summary>One Windows Firewall rule, with only what the port check needs (from INetFwRule).</summary>
public sealed record FirewallRule(bool Enabled, bool Inbound, bool Block, int Protocol, string? LocalPorts, string? RemoteAddresses, int Profiles);

/// <summary>
/// Joney's lock program listens on every address (0.0.0.0:10086), so another computer on the
/// hotel network could ask it for guest cards unless Windows Firewall stops it. This decides
/// from the firewall's own rules whether it does: the firewall is on for every network profile
/// in use, and for each of them an enabled inbound Block rule for the TCP port covers every IPv4
/// address except 127.x (which the DLL on this PC uses). Block rules win over Allow rules, so
/// only Block rules matter, and a rule that can't be read can only make the answer "no".
/// </summary>
public static class Firewall
{
    public const int Tcp = 6;

    // NET_FW_PROFILE2_DOMAIN, _PRIVATE and _PUBLIC; a rule for all of them has Profiles 0x7FFFFFFF.
    public static readonly int[] ProfileBits = [1, 2, 4];

    private const uint LoopbackFirst = 0x7F000000, LoopbackLast = 0x7FFFFFFF;

    public static bool BlocksInbound(IEnumerable<FirewallRule> rules, int currentProfiles, Func<int, bool> firewallOn, int port)
    {
        var used = ProfileBits.Where(b => (currentProfiles & b) != 0).ToList();
        if (used.Count == 0) return false;
        var blocking = rules.Where(r => r.Enabled && r.Inbound && r.Block && r.Protocol == Tcp
            && ListsPort(r.LocalPorts, port) && CoversAllButLoopback(r.RemoteAddresses)).ToList();
        return used.All(b => firewallOn(b) && blocking.Any(r => (r.Profiles & b) != 0));
    }

    /// <summary>"10086", "80,10086" or "10000-11000". "*" (every port) is not counted: no such rule is expected here.</summary>
    public static bool ListsPort(string? ports, int port) =>
        (ports ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Any(p =>
        {
            var dash = p.IndexOf('-');
            if (dash < 0) return int.TryParse(p, out var one) && one == port;
            return int.TryParse(p[..dash], out var lo) && int.TryParse(p[(dash + 1)..], out var hi) && lo <= port && port <= hi;
        });

    /// <summary>
    /// "*", or IPv4 ranges ("a-b"), subnets ("a/255.255.0.0" or "a/16") and single addresses that
    /// together cover every address outside 127.0.0.0/8. Keywords such as LocalSubnet and IPv6
    /// entries don't count (the program listens on IPv4 only).
    /// </summary>
    public static bool CoversAllButLoopback(string? addresses)
    {
        var text = (addresses ?? "").Trim();
        if (text == "*") return true;
        var ranges = new List<(ulong Lo, ulong Hi)>();
        foreach (var part in text.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            if (TryRange(part, out var r)) ranges.Add(r);
        ulong next = 0; // the lowest address not covered yet
        foreach (var (lo, hi) in ranges.OrderBy(r => r.Lo))
        {
            if (lo > next && !(next >= LoopbackFirst && lo - 1 <= LoopbackLast)) return false;
            next = Math.Max(next, hi + 1);
        }
        return next > uint.MaxValue;
    }

    private static bool TryRange(string s, out (ulong Lo, ulong Hi) range)
    {
        range = default;
        var dash = s.IndexOf('-');
        if (dash >= 0)
        {
            if (!TryV4(s[..dash], out var a) || !TryV4(s[(dash + 1)..], out var b) || a > b) return false;
            range = (a, b);
            return true;
        }
        var slash = s.IndexOf('/');
        if (slash < 0)
        {
            if (!TryV4(s, out var one)) return false;
            range = (one, one);
            return true;
        }
        if (!TryV4(s[..slash], out var net)) return false;
        var m = s[(slash + 1)..];
        uint mask;
        if (int.TryParse(m, out var bits) && !m.Contains('.')) { if (bits is < 0 or > 32) return false; mask = bits == 0 ? 0 : uint.MaxValue << (32 - bits); }
        else if (!TryV4(m, out var dotted)) return false;
        else mask = (uint)dotted;
        var first = (uint)net & mask;
        range = (first, first | ~mask);
        return true;
    }

    /// <summary>Exactly four dotted numbers 0-255 (IPAddress.TryParse would also take "1" or "1.2").</summary>
    private static bool TryV4(string s, out ulong value)
    {
        value = 0;
        var parts = s.Split('.');
        if (parts.Length != 4) return false;
        foreach (var p in parts)
        {
            if (p.Length is 0 or > 3 || !p.All(char.IsAsciiDigit) || !byte.TryParse(p, out var b)) return false;
            value = (value << 8) | b;
        }
        return true;
    }
}
