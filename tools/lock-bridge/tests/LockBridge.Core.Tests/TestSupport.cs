using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LockBridge.Core;

namespace LockBridge.Core.Tests;

/// <summary>A clock the test moves by hand.</summary>
public sealed class ManualTime(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = start;
    public override DateTimeOffset GetUtcNow() => Now;
    public void Advance(TimeSpan by) => Now += by;
}

/// <summary>Plays the server: signs orders the way key-card-order.js does.</summary>
public sealed class FakeServerKey : IDisposable
{
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public string PublicKey => Convert.ToBase64String(_key.ExportSubjectPublicKeyInfo());

    public string Sign(string payload) =>
        Convert.ToBase64String(_key.SignData(Encoding.UTF8.GetBytes(payload), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));

    public void Dispose() => _key.Dispose();
}

public static class Orders
{
    public static readonly Guid Encoder = Guid.Parse("7d1f4c2a-9b3e-4d5f-8a6b-0c1d2e3f4a5b");
    public static readonly DateTimeOffset Now = new(2026, 11, 7, 13, 0, 0, TimeSpan.Zero);

    public static string Payload(
        string challenge,
        string? nonce = null,
        Guid? encoderId = null,
        string begin = "2611071200",
        string end = "2611091200",
        object? cards = null,
        int v = 1,
        string kind = "guest-cards") =>
        JsonSerializer.Serialize(new
        {
            v,
            kind,
            challenge,
            nonce = nonce ?? Convert.ToBase64String(RandomNumberGenerator.GetBytes(18)).Replace('+', '-').Replace('/', '_'),
            encoderId = encoderId ?? Encoder,
            bookingId = Guid.Parse("0b8e6f1a-2c3d-4e5f-9a0b-1c2d3e4f5a6b"),
            guest = "Test Guest",
            room = "104",
            begin,
            end,
            validUntil = "2026-11-09T12:00:00.000Z",
            cards = cards ?? new[] { new { cardNo = 0, lockNos = new[] { "01011004" } }, new { cardNo = 1, lockNos = new[] { "01011004" } } },
        });

    public static string NonceOf(string payload) => JsonDocument.Parse(payload).RootElement.GetProperty("nonce").GetString()!;
}

/// <summary>A driver whose writes the test controls, and which can look at the journal mid-write.</summary>
public sealed class ProbeDriver : ILockDriver
{
    public string Name => "probe";
    public Func<GuestCardRequest, CancellationToken, Task<CardWriteResult>> OnWrite { get; set; } =
        (_, _) => Task.FromResult(new CardWriteResult(CardWriteStatus.Issued));
    public int Writes;
    public GuestCardRequest? Last;

    public Task<DriverStatus> StatusAsync(CancellationToken ct) => Task.FromResult(new DriverStatus(true, "probe 1.0", "ok"));

    public Task<CardWriteResult> WriteGuestCardAsync(GuestCardRequest request, CancellationToken ct)
    {
        Interlocked.Increment(ref Writes);
        Last = request;
        return OnWrite(request, ct);
    }
}

/// <summary>Answers the bridge's server calls without a network.</summary>
public sealed class FakeHttp : HttpMessageHandler
{
    public List<(HttpRequestMessage Request, string Body)> Calls { get; } = [];
    public Func<HttpRequestMessage, string, (HttpStatusCode, object?)> Reply { get; set; } = (_, _) => (HttpStatusCode.OK, new { });

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
        lock (Calls) Calls.Add((request, body));
        var (status, json) = Reply(request, body);
        return new HttpResponseMessage(status)
        {
            Content = new StringContent(json is null ? "" : JsonSerializer.Serialize(json), Encoding.UTF8, "application/json"),
        };
    }
}

/// <summary>A scratch folder per test.</summary>
public sealed class TempDir : IDisposable
{
    public string Path { get; } = Directory.CreateTempSubdirectory("lockbridge-test-").FullName;
    public string File(string name) => System.IO.Path.Combine(Path, name);
    public void Dispose() { try { Directory.Delete(Path, true); } catch (IOException) { } }
}
