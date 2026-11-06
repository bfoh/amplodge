using System.Text.Json;
using LockBridge.Core;

namespace LockBridge.Core.Tests;

public class OrderVerifierTests : IDisposable
{
    private readonly FakeServerKey _key = new();
    private readonly ManualTime _time = new(Orders.Now);
    private readonly ChallengeStore _challenges;
    private readonly OrderVerifier _verifier;

    public OrderVerifierTests()
    {
        _challenges = new ChallengeStore(Orders.Encoder, _time, TimeSpan.FromMinutes(5));
        _verifier = new OrderVerifier(Orders.Encoder, _key.PublicKey, _challenges, _time, TimeSpan.FromDays(31));
    }

    public void Dispose() => _key.Dispose();

    private VerifyResult Check(string payload) => _verifier.Verify(payload, _key.Sign(payload));

    [Fact]
    public void A_good_order_is_accepted_once()
    {
        var payload = Orders.Payload(_challenges.Issue());
        var ok = Check(payload);
        Assert.Null(ok.Error);
        Assert.Equal(2, ok.Order!.Cards.Count);
        Assert.Equal("01011004", ok.Order.Cards[0].LockNos[0]);
        Assert.Equal("104", ok.Order.Room);

        var again = Check(payload);
        Assert.Null(again.Order);
        Assert.Contains("already used", again.Error);
    }

    [Fact]
    public void A_changed_byte_breaks_the_signature()
    {
        var payload = Orders.Payload(_challenges.Issue());
        var signature = _key.Sign(payload);
        var tampered = payload.Replace("2611091200", "2612091200");
        Assert.Contains("signature", _verifier.Verify(tampered, signature).Error);
    }

    [Fact]
    public void Another_key_is_refused()
    {
        using var other = new FakeServerKey();
        var payload = Orders.Payload(_challenges.Issue());
        Assert.Contains("signature", _verifier.Verify(payload, other.Sign(payload)).Error);
        Assert.Contains("signature", _verifier.Verify(payload, "not base64!").Error);
    }

    [Fact]
    public void A_failed_check_does_not_use_up_the_challenge()
    {
        var challenge = _challenges.Issue();
        Assert.NotNull(Check(Orders.Payload(challenge, encoderId: Guid.NewGuid())).Error);
        Assert.Null(Check(Orders.Payload(challenge)).Error);
    }

    [Fact]
    public void Challenges_are_one_time_and_expire()
    {
        Assert.Contains("stale", Check(Orders.Payload($"{Orders.Encoder}.made-up-challenge-xyz")).Error);
        var challenge = _challenges.Issue();
        _time.Advance(TimeSpan.FromMinutes(6));
        Assert.Contains("stale", Check(Orders.Payload(challenge, begin: "2611071300", end: "2611091200")).Error);
    }

    [Theory]
    [InlineData(2, "guest-cards", "Unknown order type")]
    [InlineData(1, "master-card", "Unknown order type")]
    public void Only_guest_card_orders(int v, string kind, string error) =>
        Assert.Contains(error, Check(Orders.Payload(_challenges.Issue(), v: v, kind: kind)).Error);

    [Fact]
    public void Wrong_encoder_is_refused() =>
        Assert.Contains("another encoder", Check(Orders.Payload(_challenges.Issue(), encoderId: Guid.NewGuid())).Error);

    public static TheoryData<object, string> BadCards => new()
    {
        { Array.Empty<object>(), "1 to 8" },
        { new[] { new { cardNo = 0, lockNos = new[] { "01011004" } }, new { cardNo = 0, lockNos = new[] { "01011004" } } }, "twice" },
        { new[] { new { cardNo = 16, lockNos = new[] { "01011004" } } }, "0 to 15" },
        { new[] { new { cardNo = 0, lockNos = new[] { "1011004" } } }, "lock number" },
        { new[] { new { cardNo = 0, lockNos = new[] { "16011004" } } }, "lock number" },
        { new[] { new { cardNo = 0, lockNos = new[] { "0101100A" } } }, "lock number" },
        { new[] { new { cardNo = 0, lockNos = new[] { "01011004", "01011005", "01011006" } } }, "lock number" },
        { new[] { new { cardNo = 0, lockNos = Array.Empty<string>() } }, "lock number" },
    };

    [Theory]
    [MemberData(nameof(BadCards))]
    public void Card_lists_are_checked(object cards, string error) =>
        Assert.Contains(error, Check(Orders.Payload(_challenges.Issue(), cards: cards)).Error);

    [Theory]
    [InlineData("2611071200", "2611071100", "end before it starts")]
    [InlineData("2611061200", "2611071200", "already have expired")]
    [InlineData("2611071200", "2612091200", "too long")]
    [InlineData("2611071310", "2611091200", "start in the future")]
    [InlineData("2611071200", "2613091200", "not valid")]
    [InlineData("26110712", "2611091200", "not valid")]
    public void Times_are_checked(string begin, string end, string error) =>
        Assert.Contains(error, Check(Orders.Payload(_challenges.Issue(), begin: begin, end: end)).Error);

    [Fact]
    public void Card_times_are_hotel_time_which_is_UTC()
    {
        Assert.True(CardFormat.TryParseCardTime("2611091200", out var t));
        Assert.Equal(new DateTimeOffset(2026, 11, 9, 12, 0, 0, TimeSpan.Zero), t);
        Assert.False(CardFormat.TryParseCardTime("2602301200", out _));
    }

    [Fact]
    public void A_numeric_room_number_does_not_break_the_order()
    {
        var payload = Orders.Payload(_challenges.Issue()).Replace("\"room\":\"104\"", "\"room\":104");
        Assert.Equal("104", Check(payload).Order?.Room);
    }

    /// <summary>The order exactly as node signs it on the server (tests/fixtures/make-node-order.mjs).</summary>
    [Fact]
    public void Accepts_an_order_signed_by_the_servers_own_code()
    {
        var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "node-order.json"))).RootElement;
        var order = fixture.GetProperty("order").GetString()!;
        var time = new ManualTime(DateTimeOffset.Parse(fixture.GetProperty("now").GetString()!));
        var challenges = new ChallengeStore(Orders.Encoder, time, TimeSpan.FromMinutes(5));
        var verifier = new OrderVerifier(Orders.Encoder, fixture.GetProperty("publicKey").GetString()!, challenges, time, TimeSpan.FromDays(31));
        challenges.Add(JsonDocument.Parse(order).RootElement.GetProperty("challenge").GetString()!);

        var result = verifier.Verify(order, fixture.GetProperty("signature").GetString()!);

        Assert.Null(result.Error);
        Assert.Equal("Test Guest — Ama", result.Order!.Guest);
        Assert.Equal(["01011001", "01011002"], result.Order.Cards[1].LockNos);
        Assert.Equal(new DateTimeOffset(2026, 11, 9, 12, 0, 0, TimeSpan.Zero), result.Order.ValidUntil);
    }
}
