using LockBridge.Core;

namespace LockBridge.Core.Tests;

public class FirewallTests
{
    private const int Public = 4, Private = 2, Domain = 1, AllProfiles = 0x7FFFFFFF;

    // The rule the probe prints, as Windows Firewall's COM interface reports it.
    private static FirewallRule Ours(int profiles = AllProfiles, bool enabled = true, bool block = true, bool inbound = true, int protocol = Firewall.Tcp,
        string ports = "10086", string remote = "0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255") =>
        new(enabled, inbound, block, protocol, ports, remote, profiles);

    private static bool On(int _) => true;

    [Fact]
    public void The_rule_the_probe_prints_keeps_other_computers_out() =>
        Assert.True(Firewall.BlocksInbound([Ours()], Public, On, 10086));

    [Fact]
    public void Every_network_in_use_must_be_covered()
    {
        Assert.True(Firewall.BlocksInbound([Ours()], Private | Public, On, 10086));
        Assert.False(Firewall.BlocksInbound([Ours(profiles: Private)], Private | Public, On, 10086));
        Assert.True(Firewall.BlocksInbound([Ours(profiles: Private), Ours(profiles: Public)], Private | Public, On, 10086));
        Assert.True(Firewall.BlocksInbound([Ours(profiles: Domain)], Domain, On, 10086));
    }

    [Fact]
    public void A_firewall_switched_off_blocks_nothing() =>
        Assert.False(Firewall.BlocksInbound([Ours()], Public, bit => bit != Public, 10086));

    [Fact]
    public void No_network_profile_means_no_answer() =>
        Assert.False(Firewall.BlocksInbound([Ours()], 0, On, 10086));

    [Fact]
    public void Only_an_enabled_inbound_TCP_block_rule_for_the_port_counts()
    {
        Assert.False(Firewall.BlocksInbound([], Public, On, 10086));
        Assert.False(Firewall.BlocksInbound([Ours(enabled: false)], Public, On, 10086));
        Assert.False(Firewall.BlocksInbound([Ours(block: false)], Public, On, 10086));
        Assert.False(Firewall.BlocksInbound([Ours(inbound: false)], Public, On, 10086));
        Assert.False(Firewall.BlocksInbound([Ours(protocol: 17)], Public, On, 10086));
        Assert.False(Firewall.BlocksInbound([Ours(ports: "10087")], Public, On, 10086));
        Assert.True(Firewall.BlocksInbound([Ours(ports: "80, 10086")], Public, On, 10086));
        Assert.True(Firewall.BlocksInbound([Ours(ports: "10000-11000")], Public, On, 10086));
    }

    [Theory]
    [InlineData("10086", true)]
    [InlineData("80,10086,443", true)]
    [InlineData("10086-10086", true)]
    [InlineData("10087-20000", false)]
    [InlineData("100860", false)]
    [InlineData("*", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Local_ports(string? ports, bool listed) => Assert.Equal(listed, Firewall.ListsPort(ports, 10086));

    [Theory]
    [InlineData("*", true)]
    [InlineData("0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255", true)]
    [InlineData("128.0.0.0-255.255.255.255,0.0.0.0-126.255.255.255", true)]
    [InlineData("0.0.0.0-255.255.255.255", true)]
    [InlineData("0.0.0.0/1,128.0.0.0/1", true)]
    [InlineData("0.0.0.0/128.0.0.0,128.0.0.0/128.0.0.0", true)]
    [InlineData("0.0.0.0-126.255.255.255,127.0.0.5,128.0.0.0-255.255.255.255", true)]
    [InlineData("0.0.0.0-126.255.255.255", false)]
    [InlineData("0.0.0.0-126.255.255.255,128.0.0.1-255.255.255.255", false)]
    [InlineData("0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.254", false)]
    [InlineData("1.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255", false)]
    [InlineData("192.168.1.0/255.255.255.0", false)]
    [InlineData("LocalSubnet", false)]
    [InlineData("::/0", false)]
    [InlineData("1-255.255.255.255", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Remote_addresses_must_cover_everything_but_loopback(string? remote, bool covers) =>
        Assert.Equal(covers, Firewall.CoversAllButLoopback(remote));

    [Fact]
    public void Only_a_sure_yes_from_the_firewall_quiets_the_warning()
    {
        Assert.Equal(LockServerState.Firewalled, LockServer.WithFirewall(LockServerState.OpenToNetwork, true));
        Assert.Equal(LockServerState.OpenToNetwork, LockServer.WithFirewall(LockServerState.OpenToNetwork, false));
        Assert.Equal(LockServerState.OpenToNetwork, LockServer.WithFirewall(LockServerState.OpenToNetwork, null));
        Assert.Equal(LockServerState.LocalOnly, LockServer.WithFirewall(LockServerState.LocalOnly, true));
        Assert.Equal(LockServerState.NotRunning, LockServer.WithFirewall(LockServerState.NotRunning, true));
    }

    // PowerShellCheck's answer on a PC like the reception PC: on a Public network, the probe's rule in place.
    private const string Answer = """
        {"rules":[{"protocol":"TCP","ports":"10086","remote":"0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255","profile":0}],
         "nets":["Public"],
         "profiles":[{"name":"Domain","enabled":true},{"name":"Private","enabled":true},{"name":"Public","enabled":true}]}
        """;

    [Fact]
    public void The_PowerShell_answer_on_the_reception_PC_keeps_other_computers_out()
    {
        var view = Firewall.FromPowerShell(Answer);
        Assert.Equal(Public, view.CurrentProfiles);
        Assert.Equal(AllProfiles, Assert.Single(view.Rules).Profiles); // profile 0 = Any
        Assert.True(view.BlocksInbound(10086));
        Assert.Equal("profiles in use 4, firewall on 1=True,2=True,4=True, 1 block rule(s) name port 10086", view.Describe(10086));
    }

    [Fact]
    public void PowerShell_may_write_a_one_item_list_as_the_item()
    {
        var view = Firewall.FromPowerShell("""
            {"rules":{"protocol":"6","ports":"10086","remote":"Any","profile":4},"nets":"Public","profiles":{"name":"Public","enabled":true}}
            """);
        Assert.True(view.BlocksInbound(10086));
        Assert.Equal("*", view.Rules[0].RemoteAddresses);
    }

    [Theory]
    [InlineData("""{"rules":[],"nets":["Public"],"profiles":[{"name":"Public","enabled":true}]}""")]                   // no rule
    [InlineData("""{"rules":null,"nets":["Public"],"profiles":[{"name":"Public","enabled":true}]}""")]
    [InlineData("""{"rules":[{"protocol":"TCP","ports":"10086","remote":"0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255","profile":0}],"nets":["Public"],"profiles":[{"name":"Public","enabled":false}]}""")] // firewall off
    [InlineData("""{"rules":[{"protocol":"TCP","ports":"10086","remote":"0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255","profile":2}],"nets":["Public"],"profiles":[{"name":"Public","enabled":true}]}""")] // Private only
    [InlineData("""{"rules":[{"protocol":"UDP","ports":"10086","remote":"Any","profile":0}],"nets":["Public"],"profiles":[{"name":"Public","enabled":true}]}""")]
    [InlineData("""{"rules":[{"protocol":"TCP","ports":"10086","remote":"LocalSubnet","profile":0}],"nets":["Public"],"profiles":[{"name":"Public","enabled":true}]}""")]
    [InlineData("""{"rules":[{"protocol":"TCP","ports":"10086","remote":"Any","profile":65535}],"nets":["Public"],"profiles":[{"name":"Public","enabled":true}]}""")] // NotApplicable
    [InlineData("""{"rules":[{"protocol":"TCP","ports":"10086","remote":"Any","profile":0}],"nets":[],"profiles":[{"name":"Public","enabled":true}]}""")]  // no network
    public void PowerShell_answers_that_do_not_keep_other_computers_out(string json) =>
        Assert.False(Firewall.FromPowerShell(json).BlocksInbound(10086));

    [Fact]
    public void Rules_the_check_passes_on_are_judged_here()
    {
        // PowerShellCheck run against stand-in firewall cmdlets: the probe's rule, a UDP range and a
        // TCP list for the local subnet only. Only the first keeps every other computer out.
        var view = Firewall.FromPowerShell("""
            {"rules":[{"protocol":"TCP","ports":"10086","remote":"0.0.0.0-126.255.255.255,128.0.0.0-255.255.255.255","profile":0},{"protocol":"UDP","ports":"10000-11000","remote":"Any","profile":4},{"protocol":"TCP","ports":"80,10086","remote":"LocalSubnet","profile":1}],"nets":["Public"],"profiles":[{"name":"Domain","enabled":true},{"name":"Private","enabled":true},{"name":"Public","enabled":true}]}
            """);
        Assert.Equal(3, view.Rules.Count);
        Assert.True(view.BlocksInbound(10086));
        Assert.False(new FirewallView(view.CurrentProfiles, view.On, view.Rules.Skip(1).ToList()).BlocksInbound(10086));
    }

    [Fact]
    public void A_domain_network_is_the_Domain_profile()
    {
        var view = Firewall.FromPowerShell("""
            {"rules":[{"protocol":"TCP","ports":"10000-11000","remote":"Any","profile":1}],"nets":["DomainAuthenticated"],"profiles":[{"name":"Domain","enabled":true}]}
            """);
        Assert.Equal(Domain, view.CurrentProfiles);
        Assert.True(view.BlocksInbound(10086));
    }

    [Fact]
    public void The_PowerShell_check_fits_on_one_command_line()
    {
        var script = Firewall.PowerShellCheck(10086);
        Assert.DoesNotContain('"', script);
        Assert.DoesNotContain('\n', script);
        Assert.DoesNotContain('\r', script);
        Assert.Contains("$port = '10086';", script);
        Assert.True(script.All(c => c < 128), "ASCII only");
    }
}
