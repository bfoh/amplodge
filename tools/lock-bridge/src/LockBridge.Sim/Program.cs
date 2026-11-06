using LockBridge.Core;

// lock-bridge-sim [--port 47123] [--server http://localhost:8888] [--origin <extra origin>]...
//                 [--data <folder>] [--delay-ms 600] [--pair <code>]
//
// The bridge exactly as on the reception PC, but with a pretend encoder: every
// "card" succeeds and nothing is written. The default server is `netlify dev`,
// not the live site, so a simulated card is never reported as a real one.

var port = 47123;
var server = new Uri("http://localhost:8888");
var origins = new List<string> { "https://amplodge.org", "https://www.amplodge.org", "http://localhost:3000", "http://localhost:8888" };
var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AMPLockBridgeSim");
var delay = TimeSpan.FromMilliseconds(600);
string? pairCode = null;

for (var i = 0; i < args.Length; i++)
{
    string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{args[i]} needs a value");
    switch (args[i])
    {
        case "--port": port = int.Parse(Next()); break;
        case "--server": server = new Uri(Next()); break;
        case "--origin": origins.Add(Next().TrimEnd('/')); break;
        case "--data": data = Next(); break;
        case "--delay-ms": delay = TimeSpan.FromMilliseconds(int.Parse(Next())); break;
        case "--pair": pairCode = Next(); break;
        default:
            Console.Error.WriteLine($"Unknown option {args[i]}. See the top of Program.cs.");
            return 2;
    }
}

var options = new BridgeOptions
{
    Port = port,
    ExpectedHost = $"127.0.0.1:{port}",
    AllowedOrigins = origins,
    ServerUrl = server,
};

Directory.CreateDirectory(data);
using var journal = new Journal(Path.Combine(data, "journal-sim.jsonl"));
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
var driver = new SimulatorDriver(delay);
await using var bridge = new Bridge(options, driver, new FileConfigStore(Path.Combine(data, "bridge-config-sim.json")), journal, new ServerClient(http), TimeProvider.System);
bridge.Start();

Console.WriteLine($"""
    AMP Lock Bridge {options.BridgeVersion} — SIMULATOR: no real card is written.
      listening  http://{options.ExpectedHost}
      server     {server}
      origins    {string.Join(", ", origins)}
      data       {data}
      paired     {(bridge.Session is { } s ? $"yes, as \"{s.Config.Label}\" ({s.Config.EncoderId})" : "no")}
    """);
if (server.Host is "amplodge.org" or "www.amplodge.org")
    Console.WriteLine("  WARNING: this simulator reports to the LIVE site. Its pretend cards would show as real ones.");

if (pairCode is not null)
{
    var outcome = await bridge.PairAsync(pairCode, CancellationToken.None);
    Console.WriteLine(outcome.Config is { } c ? $"Paired as \"{c.Label}\" ({c.EncoderId})." : $"Pairing failed: {outcome.Error}");
}

var app = BridgeApi.Build(bridge);
await app.RunAsync();
return 0;
