using LockBridge.Core;

namespace LockBridge.Core.Tests;

public class EncoderRulesTests
{
    private static readonly EncoderCalibration Cal = new()
    {
        Calibrated = true,
        WriteOkCodes = [0],
        BlankCardTypes = ["F"],
        GuestCardTypes = ["6"],
    };

    [Theory]
    [InlineData("F", CardKind.Blank)]
    [InlineData(" f ", CardKind.Blank)]
    [InlineData("6", CardKind.Guest)]
    [InlineData("6010203", CardKind.Guest)]
    [InlineData("B", CardKind.Other)]
    [InlineData("D", CardKind.Other)]
    [InlineData("0", CardKind.Other)]
    [InlineData("", CardKind.Other)]
    [InlineData(null, CardKind.Other)]
    public void Only_known_blank_or_guest_cards_may_be_written(string? type, CardKind kind) =>
        Assert.Equal(kind, EncoderRules.Classify(type, Cal));

    [Fact]
    public void An_uncalibrated_encoder_knows_no_card_type() =>
        Assert.Equal(CardKind.Other, EncoderRules.Classify("6", new EncoderCalibration()));

    // 551501 = a card is present; characters 25-32 are the card's serial.
    private static string Card(string serial, string present = "01") => "5515" + present + "0123456789ABCDEF00" + serial + "0400" + new string('0', 40);

    [Fact]
    public void The_card_data_gives_a_second_opinion()
    {
        Assert.Equal(CardKind.Blank, EncoderRules.FromCardData(Card("FFFFFFFF")));
        Assert.Equal(CardKind.Blank, EncoderRules.FromCardData(Card("ffffffff")));
        Assert.Equal(CardKind.Guest, EncoderRules.FromCardData(Card("6A1B2C3D")));
        Assert.Equal(CardKind.Other, EncoderRules.FromCardData(Card("B0000001"))); // a master card
        Assert.Equal(CardKind.Other, EncoderRules.FromCardData(Card("6A1B2C3D", present: "00"))); // no card on the encoder
        Assert.Equal(CardKind.Other, EncoderRules.FromCardData("551501"));
        Assert.Equal(CardKind.Other, EncoderRules.FromCardData(null));
    }

    [Theory]
    [InlineData("2611091200", true)]
    [InlineData("202611091200", true)]
    [InlineData("26-11-09 12:00", true)]
    [InlineData("2026-11-09 12:00:00", true)]
    [InlineData("261109120000", true)]
    [InlineData("2611091300", false)]
    [InlineData("26110912", false)]
    [InlineData("", false)]
    public void End_time_read_back(string decoded, bool matches) =>
        Assert.Equal(matches, EncoderRules.EndMatches("2611091200", decoded));

    [Theory]
    [InlineData("01030D", true)]
    [InlineData("01030d", true)]
    [InlineData(" 01030D\0", true)]
    [InlineData("01030E", false)]
    [InlineData("1030D", false)]
    [InlineData("001030D", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Lock_code_read_back(string? decoded, bool matches) =>
        Assert.Equal(matches, EncoderRules.LockMatches("01030D", decoded));

    [Fact]
    public void A_lock_code_that_is_not_one_never_matches() =>
        Assert.False(EncoderRules.LockMatches("", ""));

    [Fact]
    public void The_card_itself_decides()
    {
        var ok = EncoderRules.Judge(Cal, 99, true, "01030D", "2611091200", "01030D", "2611091200");
        Assert.Equal(CardWriteStatus.Issued, ok.Status);

        var moved = EncoderRules.Judge(Cal, 0, false, null, null, "01030D", "2611091200");
        Assert.Equal(CardWriteStatus.Unknown, moved.Status);

        var oddOk = EncoderRules.Judge(Cal, 0, true, "01030E", "2611091200", "01030D", "2611091200");
        Assert.Equal(CardWriteStatus.Unknown, oddOk.Status);

        var refused = EncoderRules.Judge(Cal, 3, true, "01030E", "2611081200", "01030D", "2611091200");
        Assert.Equal(CardWriteStatus.Failed, refused.Status);
        Assert.Contains("code 3", refused.Error);
    }
}
