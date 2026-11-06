using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using LockBridge.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;

namespace LockBridge.Core.Tests;

public class ApiTests : IAsyncLifetime
{
    private const string Portal = "https://amplodge.org";
    private readonly TempDir _dir = new();
    private readonly FakeServerKey _key = new();
    private readonly ManualTime _time = new(Orders.Now);
    private readonly ProbeDriver _driver = new();
    private readonly FakeHttp _server = new();
    private Journal _journal = null!;
    private Bridge _bridge = null!;
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _server.Reply = (req, body) => req.RequestUri!.AbsolutePath switch
        {
            ServerClient.PairPath when body.Contains("\"code\":\"GOOD-CODE\"") =>
                (HttpStatusCode.OK, new { encoderId = Orders.Encoder, label = "Front desk", deviceToken = "device-secret", publicKey = _key.PublicKey, allowedOrigins = new[] { "https://evil.example" } }),
            ServerClient.PairPath when body.Contains("\"code\":\"BAD-KEY\"") =>
                (HttpStatusCode.OK, new { encoderId = Orders.Encoder, label = "x", deviceToken = "t", publicKey = "AAAA" }),
            ServerClient.PairPath => (HttpStatusCode.NotFound, new { error = "That code is not valid or has expired." }),
            ServerClient.ReceiptPath => (HttpStatusCode.OK, new { updated = 1, ignored = 0 }),
            _ => (HttpStatusCode.NotFound, null),
        };
        _journal = new Journal(_dir.File("journal.jsonl"));
        var options = new BridgeOptions { ServerUrl = new Uri("https://amplodge.org") };
        _bridge = new Bridge(options, _driver, new FileConfigStore(_dir.File("config.json")), _journal, new ServerClient(new HttpClient(_server)), _time);
        _bridge.Start();
        _app = BridgeApi.Build(_bridge, b => b.WebHost.UseTestServer());
        await _app.StartAsync();
        _client = _app.GetTestClient();
        _client.BaseAddress = new Uri("http://127.0.0.1:47123/");
    }

    public async Task DisposeAsync()
    {
        await _app.DisposeAsync();
        await _bridge.DisposeAsync();
        _journal.Dispose();
        _key.Dispose();
        _dir.Dispose();
    }

    private Task<HttpResponseMessage> Post(string path, object body, string? origin = Portal, string contentType = "application/json")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, contentType) };
        if (origin is not null) request.Headers.Add("Origin", origin);
        return _client.SendAsync(request);
    }

    private static async Task<JsonElement> Json(HttpResponseMessage r) => JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;

    private async Task Pair()
    {
        var r = await Post("/pair", new { code = "GOOD-CODE" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
    }

    [Fact]
    public async Task Only_the_bridges_own_host_name_is_served()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/status");
        request.Headers.Host = "rebound.attacker.example";
        Assert.Equal(HttpStatusCode.Forbidden, (await _client.SendAsync(request)).StatusCode);

        var ok = await _client.GetAsync("/status");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("no-store", ok.Headers.CacheControl?.ToString());
        Assert.False((await Json(ok)).GetProperty("paired").GetBoolean());
    }

    [Fact]
    public async Task Posts_need_the_portals_origin_and_JSON()
    {
        await Pair();
        Assert.Equal(HttpStatusCode.Forbidden, (await Post("/challenge", new { }, origin: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post("/challenge", new { }, origin: "https://evil.example")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post("/challenge", new { }, origin: "http://amplodge.org")).StatusCode);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, (await Post("/challenge", new { }, contentType: "text/plain")).StatusCode);

        var ok = await Post("/challenge", new { }, origin: "https://www.amplodge.org");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("https://www.amplodge.org", ok.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.StartsWith($"{Orders.Encoder}.", (await Json(ok)).GetProperty("challenge").GetString());

        var other = new HttpRequestMessage(HttpMethod.Delete, "/status");
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await _client.SendAsync(other)).StatusCode);
    }

    [Fact]
    public async Task Preflight_answers_only_the_portal()
    {
        var good = new HttpRequestMessage(HttpMethod.Options, "/cards/issue");
        good.Headers.Add("Origin", Portal);
        good.Headers.Add("Access-Control-Request-Method", "POST");
        good.Headers.Add("Access-Control-Request-Private-Network", "true");
        var r = await _client.SendAsync(good);
        Assert.Equal(HttpStatusCode.NoContent, r.StatusCode);
        Assert.Equal(Portal, r.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("true", r.Headers.GetValues("Access-Control-Allow-Private-Network").Single());
        Assert.Equal("Content-Type", r.Headers.GetValues("Access-Control-Allow-Headers").Single());

        var bad = new HttpRequestMessage(HttpMethod.Options, "/cards/issue");
        bad.Headers.Add("Origin", "https://evil.example");
        var refused = await _client.SendAsync(bad);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.False(refused.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Nothing_is_written_before_pairing()
    {
        Assert.Equal(HttpStatusCode.Conflict, (await Post("/challenge", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post("/cards/issue", new { order = "{}", signature = "x", cardNo = 0 })).StatusCode);
        Assert.Equal(0, _driver.Writes);
    }

    [Fact]
    public async Task Pairing_once_pins_the_servers_key_and_cannot_be_redone_from_a_page()
    {
        var wrong = await Post("/pair", new { code = "WRONG" });
        Assert.Equal(HttpStatusCode.NotFound, wrong.StatusCode);
        Assert.Contains("not valid", (await Json(wrong)).GetProperty("error").GetString());

        var badKey = await Post("/pair", new { code = "BAD-KEY" });
        Assert.Equal(HttpStatusCode.BadGateway, badKey.StatusCode);
        Assert.False(File.Exists(_dir.File("config.json")));

        await Pair();
        var status = await Json(await _client.GetAsync("/status"));
        Assert.True(status.GetProperty("paired").GetBoolean());
        Assert.Equal("Front desk", status.GetProperty("label").GetString());
        var saved = new FileConfigStore(_dir.File("config.json")).Load()!;
        Assert.Equal(("device-secret", _key.PublicKey, "https://amplodge.org"), (saved.DeviceToken, saved.ServerPublicKey, saved.ServerUrl));

        Assert.Equal(HttpStatusCode.Conflict, (await Post("/pair", new { code = "GOOD-CODE" })).StatusCode);
        var redeem = _server.Calls.Last(c => c.Request.RequestUri!.AbsolutePath == ServerClient.PairPath);
        Assert.Contains("\"action\":\"redeem\"", redeem.Body);

        // The origins the server sent back are not trusted: the list is built in.
        Assert.Equal(HttpStatusCode.Forbidden, (await Post("/challenge", new { }, origin: "https://evil.example")).StatusCode);
    }

    [Fact]
    public async Task Issues_a_signed_order_and_reports_it_to_the_server()
    {
        await Pair();
        var challenge = (await Json(await Post("/challenge", new { }))).GetProperty("challenge").GetString()!;
        var order = Orders.Payload(challenge);
        var nonce = Orders.NonceOf(order);

        var r = await Post("/cards/issue", new { order, signature = _key.Sign(order), cardNo = 0 });
        var body = await Json(r);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("issued", body.GetProperty("status").GetString());
        Assert.Equal(1, _driver.Writes);
        Assert.Equal(["01011004"], _driver.Last!.LockNos);
        Assert.Equal(("2611071200", "2611091200"), (_driver.Last.Begin, _driver.Last.End));

        // The receipt goes out on its own, with the device token.
        var deadline = DateTime.UtcNow.AddSeconds(10);
        (HttpRequestMessage Request, string Body)? receipt = null;
        while (receipt is null && DateTime.UtcNow < deadline)
        {
            lock (_server.Calls) receipt = _server.Calls.FirstOrDefault(c => c.Request.RequestUri!.AbsolutePath == ServerClient.ReceiptPath);
            if (receipt is null) await Task.Delay(50);
        }
        Assert.NotNull(receipt);
        Assert.Equal("Device device-secret", receipt.Value.Request.Headers.Authorization?.ToString());
        var sent = JsonDocument.Parse(receipt.Value.Body).RootElement;
        Assert.Equal(nonce, sent.GetProperty("nonce").GetString());
        Assert.Equal("issued", sent.GetProperty("cards")[0].GetProperty("status").GetString());
        Assert.False(receipt.Value.Body.Contains("lockNos"), "the receipt carries no card data");

        deadline = DateTime.UtcNow.AddSeconds(5);
        JsonElement state;
        do { state = await Json(await _client.GetAsync($"/orders/{nonce}")); await Task.Delay(20); }
        while (!state.GetProperty("cards")[0].GetProperty("reported").GetBoolean() && DateTime.UtcNow < deadline);
        Assert.True(state.GetProperty("cards")[0].GetProperty("reported").GetBoolean());

        // A forged order (signed by someone else) writes nothing.
        using var forger = new FakeServerKey();
        var forgedChallenge = (await Json(await Post("/challenge", new { }))).GetProperty("challenge").GetString()!;
        var forged = Orders.Payload(forgedChallenge);
        var refused = await Post("/cards/issue", new { order = forged, signature = forger.Sign(forged), cardNo = 0 });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal(1, _driver.Writes);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/orders/unknown-nonce")).StatusCode);
    }
}

public class ReceiptSenderTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly FakeServerKey _key = new();
    private readonly ManualTime _time = new(Orders.Now);
    private readonly FakeHttp _http = new();
    private readonly Journal _journal;
    private readonly CardWriter _writer;
    private readonly ChallengeStore _challenges;
    private readonly ReceiptSender _sender;

    public ReceiptSenderTests()
    {
        _journal = new Journal(_dir.File("journal.jsonl"));
        _challenges = new ChallengeStore(Orders.Encoder, _time, TimeSpan.FromMinutes(5));
        var verifier = new OrderVerifier(Orders.Encoder, _key.PublicKey, _challenges, _time, TimeSpan.FromDays(31));
        _writer = new CardWriter(new ProbeDriver(), _journal, verifier, _time, TimeSpan.FromMinutes(10), TimeSpan.FromSeconds(5));
        var config = new BridgeConfig(Orders.Encoder, "Front desk", "device-secret", _key.PublicKey, "https://amplodge.org", Orders.Now);
        _sender = new ReceiptSender(_writer, new ServerClient(new HttpClient(_http)), config, new BridgeOptions(), () => "proRFL 1.0", _time);
    }

    public void Dispose()
    {
        _journal.Dispose();
        _key.Dispose();
        _dir.Dispose();
    }

    private async Task<string> Issue()
    {
        var order = Orders.Payload(_challenges.Issue());
        await _writer.IssueAsync(order, _key.Sign(order), 0);
        return Orders.NonceOf(order);
    }

    [Fact]
    public async Task Keeps_results_until_the_server_has_them()
    {
        await Issue();
        _http.Reply = (_, _) => (HttpStatusCode.ServiceUnavailable, new { error = "down" });
        Assert.False(await _sender.SendPendingAsync(default));
        Assert.Single(_writer.PendingReceipts());
        Assert.Equal("down", _sender.LastError);

        _http.Reply = (_, _) => throw new HttpRequestException("no internet");
        Assert.False(await _sender.SendPendingAsync(default));
        Assert.Contains("internet", _sender.LastError);
        Assert.Single(_writer.PendingReceipts());

        _http.Reply = (_, _) => (HttpStatusCode.OK, new { updated = 1 });
        Assert.True(await _sender.SendPendingAsync(default));
        Assert.Empty(_writer.PendingReceipts());
        Assert.Contains("\"dllVersion\":\"proRFL 1.0\"", _http.Calls.Last().Body);
    }

    [Fact]
    public async Task A_revoked_PC_stops_and_says_so()
    {
        await Issue();
        _http.Reply = (_, _) => (HttpStatusCode.Unauthorized, new { error = "Unknown or unpaired device" });
        Assert.False(await _sender.SendPendingAsync(default));
        Assert.True(_sender.Revoked);
        Assert.Single(_writer.PendingReceipts());
    }

    [Fact]
    public async Task An_order_the_server_refuses_for_good_is_not_retried_forever()
    {
        var nonce = await Issue();
        _http.Reply = (_, _) => (HttpStatusCode.NotFound, new { error = "No such order" });
        Assert.True(await _sender.SendPendingAsync(default));
        Assert.Empty(_writer.PendingReceipts());
        Assert.Contains(_journal.Entries, e => e.T == "sent" && e.Nonce == nonce && e.Error == "No such order");
    }
}
