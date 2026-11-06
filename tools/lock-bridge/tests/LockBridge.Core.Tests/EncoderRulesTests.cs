using LockBridge.Core;

namespace LockBridge.Core.Tests;

public class EncoderRulesTests
{
    private static readonly EncoderCalibration Cal = new()
    {
        Calibrated = true,
        WriteOkCodes = [0],
        BlankCardTypes = ["Blank card"],
        GuestCardTypes = ["Guest card"],
    };

    [Theory]
    [InlineData("Blank card", CardKind.Blank)]
    [InlineData(" guest CARD ", CardKind.Guest)]
    [InlineData("Master card", CardKind.Other)]
    [InlineData("", CardKind.Other)]
    [InlineData(null, CardKind.Other)]
    public void Only_known_blank_or_guest_cards_may_be_written(string? type, CardKind kind) =>
        Assert.Equal(kind, EncoderRules.Classify(type, Cal));

    [Fact]
    public void An_uncalibrated_encoder_knows_no_card_type() =>
        Assert.Equal(CardKind.Other, EncoderRules.Classify("Guest card", new EncoderCalibration()));

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

    [Fact]
    public void The_card_itself_decides()
    {
        var ok = EncoderRules.Judge(Cal, 99, true, "01011004", "2611091200", "01011004", "2611091200");
        Assert.Equal(CardWriteStatus.Issued, ok.Status);

        var moved = EncoderRules.Judge(Cal, 0, false, null, null, "01011004", "2611091200");
        Assert.Equal(CardWriteStatus.Unknown, moved.Status);

        var oddOk = EncoderRules.Judge(Cal, 0, true, "01011005", "2611091200", "01011004", "2611091200");
        Assert.Equal(CardWriteStatus.Unknown, oddOk.Status);

        var refused = EncoderRules.Judge(Cal, 3, true, "01011005", "2611081200", "01011004", "2611091200");
        Assert.Equal(CardWriteStatus.Failed, refused.Status);
        Assert.Contains("code 3", refused.Error);
    }
}
