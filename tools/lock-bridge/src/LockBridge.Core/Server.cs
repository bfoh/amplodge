using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace LockBridge.Core;

/// <summary>What pairing leaves on this PC. The device token is a secret: the config store protects it.</summary>
public sealed record BridgeConfig(Guid EncoderId, string Label, string DeviceToken, string ServerPublicKey, string ServerUrl, DateTimeOffset PairedAt);

public interface IConfigStore
{
    BridgeConfig? Load();
    void Save(BridgeConfig config);
    void Clear();
}

/// <summary>Seals the config file to this PC (Windows: DPAPI). Without one the file is plain JSON (simulator only).</summary>
public interface ISecretProtector
{
    byte[] Protect(byte[] data);
    byte[] Unprotect(byte[] data);
}

public sealed class FileConfigStore(string path, ISecretProtector? protector = null) : IConfigStore
{
    public BridgeConfig? Load()
    {
        if (!File.Exists(path)) return null;
        var bytes = File.ReadAllBytes(path);
        if (protector is not null) bytes = protector.Unprotect(bytes);
        return JsonSerializer.Deserialize<BridgeConfig>(bytes, CardFormat.Json);
    }

    public void Save(BridgeConfig config)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(config, CardFormat.Json);
        if (protector is not null) bytes = protector.Protect(bytes);
        var temp = path + ".tmp";
        File.WriteAllBytes(temp, bytes);
        File.Move(temp, path, overwrite: true);
    }

    public void Clear()
    {
        if (File.Exists(path)) File.Delete(path);
    }
}

public sealed record ServerReply(HttpStatusCode Status, JsonElement Body, string? Error)
{
    public bool Ok => (int)Status is >= 200 and < 300;
    /// <summary>Worth trying again later: the network, a rate limit or the server itself.</summary>
    public bool Transient => (int)Status == 0 || Status is HttpStatusCode.TooManyRequests or HttpStatusCode.RequestTimeout || (int)Status >= 500;
}

public sealed record ReceiptCard(int CardNo, string Status, string? Error);

public sealed record Receipt(string Nonce, IReadOnlyList<ReceiptCard> Cards, string BridgeVersion, string? DllVersion);

/// <summary>The two server calls the bridge makes itself: pairing, and reporting what it wrote.</summary>
public sealed class ServerClient(HttpClient http)
{
    public const string PairPath = "/.netlify/functions/lock-encoder-pair";
    public const string ReceiptPath = "/.netlify/functions/key-card-receipt";

    public Task<ServerReply> RedeemAsync(Uri server, string code, string bridgeVersion, string? dllVersion, CancellationToken ct) =>
        PostAsync(new Uri(server, PairPath), new { action = "redeem", code, bridgeVersion, dllVersion }, null, ct);

    public Task<ServerReply> SendReceiptAsync(Uri server, string deviceToken, Receipt receipt, CancellationToken ct) =>
        PostAsync(new Uri(server, ReceiptPath), receipt, deviceToken, ct);

    private async Task<ServerReply> PostAsync(Uri url, object body, string? deviceToken, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body, options: CardFormat.Json) };
        if (deviceToken is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Device", deviceToken);
        try
        {
            using var response = await http.SendAsync(request, ct);
            var text = await response.Content.ReadAsStringAsync(ct);
            JsonElement json = default;
            try { if (!string.IsNullOrWhiteSpace(text)) json = JsonDocument.Parse(text).RootElement.Clone(); }
            catch (JsonException) { }
            string? error = null;
            if (!response.IsSuccessStatusCode)
                error = json.ValueKind == JsonValueKind.Object && json.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String
                    ? e.GetString()
                    : $"The server answered {(int)response.StatusCode}.";
            return new ServerReply(response.StatusCode, json, error);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            return new ServerReply(0, default, "Could not reach the server. Is the internet working?");
        }
    }

    /// <summary>Reads the pairing reply, refusing anything that would leave the bridge unable to check orders.</summary>
    public static BridgeConfig? ReadPairing(ServerReply reply, Uri server, DateTimeOffset now, out string? error)
    {
        error = null;
        var b = reply.Body;
        if (b.ValueKind != JsonValueKind.Object
            || !b.TryGetProperty("encoderId", out var id) || !Guid.TryParse(id.GetString(), out var encoderId)
            || !b.TryGetProperty("deviceToken", out var token) || string.IsNullOrWhiteSpace(token.GetString())
            || !b.TryGetProperty("publicKey", out var key) || key.GetString() is not { } publicKey)
        {
            error = "The server's pairing reply was incomplete.";
            return null;
        }
        try
        {
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKey), out _);
            if (ecdsa.KeySize != 256) throw new CryptographicException("not P-256");
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException)
        {
            error = "The server's signing key is not one this bridge can use.";
            return null;
        }
        var label = b.TryGetProperty("label", out var l) && l.GetString() is { Length: > 0 } s ? s : "Reception PC";
        return new BridgeConfig(encoderId, label, token.GetString()!, publicKey, server.GetLeftPart(UriPartial.Authority), now);
    }
}
