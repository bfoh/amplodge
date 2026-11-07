using System.Net;
using LockBridge.Core;

namespace LockBridge.Core.Tests;

public class LockServerTests
{
    private static IPEndPoint At(string address, int port = LockServer.Port) => new(IPAddress.Parse(address), port);

    [Fact]
    public void Nothing_on_port_10086_means_the_lock_program_is_closed() =>
        Assert.Equal(LockServerState.NotRunning, LockServer.Judge([At("127.0.0.1", 47123), At("0.0.0.0", 445)]));

    [Fact]
    public void Listening_on_127_0_0_1_only_is_the_safe_setup() =>
        Assert.Equal(LockServerState.LocalOnly, LockServer.Judge([At("127.0.0.1")]));

    [Fact]
    public void Listening_on_every_address_works_but_is_open_to_the_network() =>
        Assert.Equal(LockServerState.OpenToNetwork, LockServer.Judge([At("0.0.0.0")]));

    [Fact]
    public void Listening_on_a_LAN_address_as_well_is_open_to_the_network() =>
        Assert.Equal(LockServerState.OpenToNetwork, LockServer.Judge([At("127.0.0.1"), At("192.168.1.20")]));

    [Theory]
    [InlineData("192.168.1.20")]
    [InlineData("::1")]
    [InlineData("::")]
    public void A_listener_the_DLL_cannot_reach_at_127_0_0_1_counts_as_closed(string address) =>
        Assert.Equal(LockServerState.NotRunning, LockServer.Judge([At(address)]));
}
