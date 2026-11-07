using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace LockBridge.Core;

/// <summary>
/// A card order as the server signs it (netlify/functions/key-card-order.js), v2.
/// Dai is the same for every card of one stay and new for the next stay: a card
/// with a new DAI, once used at the door, locks out cards with an older one.
/// </summary>
public sealed record GuestCardOrder(
    int V,
    string Kind,
    string Challenge,
    string Nonce,
    Guid EncoderId,
    Guid BookingId,
    string? Guest,
    [property: JsonConverter(typeof(TextOrNumberConverter))] string? Room,
    string Begin,
    string End,
    DateTimeOffset ValidUntil,
    int Dai,
    IReadOnlyList<OrderCard> Cards)
{
    /// <summary>The only order version this bridge writes: 6-hex lock codes, with a DAI.</summary>
    public const int Version = 2;
}

public sealed record OrderCard(int CardNo, IReadOnlyList<string> LockNos);

/// <summary>Room numbers are text in the database, but a number must not make an order unreadable.</summary>
public sealed class TextOrNumberConverter : JsonConverter<string?>
{
    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => reader.TokenType switch
    {
        JsonTokenType.Null => null,
        JsonTokenType.Number => Encoding.UTF8.GetString(reader.ValueSpan),
        _ => reader.GetString(),
    };

    public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options) => writer.WriteStringValue(value);
}

public static partial class CardFormat
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [GeneratedRegex(@"^[0-9A-F]{6}$")] private static partial Regex SixHex();
    [GeneratedRegex(@"^\d{10}$")] private static partial Regex TenDigits();

    /// <summary>The 6-character code Joney's Lock Management System shows for a door: 0-9 and A-F, capitals (e.g. 01020A).</summary>
    public static bool IsLockNo(string? s) => s is not null && SixHex().IsMatch(s);

    /// <summary>The card's yyMMddHHmm, in hotel time (Ghana: GMT all year, so UTC).</summary>
    public static bool TryParseCardTime(string s, out DateTimeOffset value)
    {
        value = default;
        if (!TenDigits().IsMatch(s)) return false;
        if (!DateTime.TryParseExact(s, "yyMMddHHmm", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dt)) return false;
        value = new DateTimeOffset(dt, TimeSpan.Zero);
        return true;
    }
}

/// <summary>One-time challenges. An order is only accepted against a challenge this bridge made and has not used.</summary>
public sealed class ChallengeStore(Guid encoderId, TimeProvider time, TimeSpan lifetime)
{
    private readonly ConcurrentDictionary<string, DateTimeOffset> _open = new();

    public string Issue()
    {
        var now = time.GetUtcNow();
        foreach (var (key, expires) in _open)
            if (expires <= now) _open.TryRemove(key, out _);
        var challenge = $"{encoderId:D}.{Base64Url(RandomNumberGenerator.GetBytes(24))}";
        _open[challenge] = now + lifetime;
        return challenge;
    }

    /// <summary>Tests only: accept a challenge made elsewhere (the node-signed fixture).</summary>
    internal void Add(string challenge) => _open[challenge] = time.GetUtcNow() + lifetime;

    public bool TryConsume(string challenge) =>
        _open.TryRemove(challenge, out var expires) && expires > time.GetUtcNow();

    internal static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public sealed record VerifyResult(GuestCardOrder? Order, string? Error)
{
    public static VerifyResult Fail(string error) => new(null, error);
}

/// <summary>
/// Checks a signed order before any card is written: the server's signature over
/// the exact bytes, that it was made for this encoder against a challenge from
/// this bridge, and that its doors and times are sane. The server already
/// decided all of this; the checks here mean a compromised page or server
/// account still cannot make this PC write something wild.
/// </summary>
public sealed class OrderVerifier(Guid encoderId, string serverPublicKeyB64, ChallengeStore challenges, TimeProvider time, TimeSpan maxValidity)
{
    private readonly byte[] _publicKey = Convert.FromBase64String(serverPublicKeyB64);

    public bool SignatureValid(string payload, string signatureB64)
    {
        byte[] signature;
        try { signature = Convert.FromBase64String(signatureB64); }
        catch (FormatException) { return false; }
        using var ecdsa = ECDsa.Create();
        ecdsa.ImportSubjectPublicKeyInfo(_publicKey, out _);
        return ecdsa.VerifyData(Encoding.UTF8.GetBytes(payload), signature, HashAlgorithmName.SHA256);
    }

    /// <summary>Full check of a new order. Uses up its challenge only when everything else passes.</summary>
    public VerifyResult Verify(string payload, string signatureB64)
    {
        if (!SignatureValid(payload, signatureB64)) return VerifyResult.Fail("The order's signature does not match the server's key.");

        GuestCardOrder? order;
        try { order = JsonSerializer.Deserialize<GuestCardOrder>(payload, CardFormat.Json); }
        catch (JsonException) { return VerifyResult.Fail("The order could not be read."); }
        if (order is null || order.Kind != "guest-cards") return VerifyResult.Fail("Unknown order type.");
        if (order.V != GuestCardOrder.Version) return VerifyResult.Fail("The order is in a format this lock bridge does not know. Update the lock bridge, or the website.");
        if (order.EncoderId != encoderId) return VerifyResult.Fail("This order was made for another encoder PC.");
        if (string.IsNullOrEmpty(order.Nonce) || order.Nonce.Length > 64) return VerifyResult.Fail("The order has no valid id.");

        if (order.Dai is < 1 or > 255) return VerifyResult.Fail("The order's DAI is not valid.");
        if (order.Cards is null || order.Cards.Count is < 1 or > 8) return VerifyResult.Fail("An order holds 1 to 8 cards.");
        if (order.Cards.Select(c => c.CardNo).Distinct().Count() != order.Cards.Count) return VerifyResult.Fail("A card number appears twice.");
        foreach (var card in order.Cards)
        {
            if (card.CardNo is < 0 or > 15) return VerifyResult.Fail("Card numbers run from 0 to 15.");
            if (card.LockNos is null || card.LockNos.Count is < 1 or > 2 || !card.LockNos.All(CardFormat.IsLockNo))
                return VerifyResult.Fail("A card's lock number is not valid.");
        }

        if (!CardFormat.TryParseCardTime(order.Begin, out var begin) || !CardFormat.TryParseCardTime(order.End, out var end))
            return VerifyResult.Fail("The card times are not valid.");
        var now = time.GetUtcNow();
        if (end <= begin) return VerifyResult.Fail("The card would end before it starts.");
        if (end <= now) return VerifyResult.Fail("The card would already have expired. Is this PC's clock right?");
        if (end - now > maxValidity) return VerifyResult.Fail("The card would be valid for too long.");
        if (begin > now + TimeSpan.FromMinutes(5)) return VerifyResult.Fail("The card would start in the future. Is this PC's clock right?");

        if (!challenges.TryConsume(order.Challenge)) return VerifyResult.Fail("This order is stale or was already used. Try again.");
        return new VerifyResult(order, null);
    }
}
