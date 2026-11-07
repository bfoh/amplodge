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
        Assert.Equal(CardKind.Blank, EncoderRules.FromCardData(Card("FFFFFFFF"))); // factory-new
        Assert.Equal(CardKind.Blank, EncoderRules.FromCardData(Card("ffffffff")));
        Assert.Equal(CardKind.Blank, EncoderRules.FromCardData(Card("FF2A6C1E"))); // erased by the lock program (the shape seen on site)
        Assert.Equal(CardKind.Blank, EncoderRules.FromCardData(Card("fF0B3C4D")));
        Assert.Equal(CardKind.Guest, EncoderRules.FromCardData(Card("6A1B2C3D")));
        Assert.Equal(CardKind.Guest, EncoderRules.FromCardData(Card("68A0B1C2")));
        Assert.Equal(CardKind.Other, EncoderRules.FromCardData(Card("B0000001"))); // a master card
        Assert.Equal(CardKind.Other, EncoderRules.FromCardData(Card("0A1B2C3D"))); // the system card
        Assert.Equal(CardKind.Other, EncoderRules.FromCardData(Card("D0C0FFEE"))); // a floor card
        Assert.Equal(CardKind.Other, EncoderRules.FromCardData(Card("7FFFFFFF"))); // a check-out card
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

    // A guest card's data: characters 17-22 hold the lock code backwards (room, floor, building).
    // Characters 23-24 hold the DAI.
    private static string Guest(string lockNo, int dai = 7) =>
        "551501" + "00" + "01" + "0203" + "00" + lockNo[4..6] + lockNo[2..4] + lockNo[..2] + dai.ToString("X2") + "6A1B2C3D" + "0400" + new string('0', 40);

    [Fact]
    public void The_DAI_comes_off_the_card()
    {
        Assert.Equal(250, EncoderRules.DaiOnCard(Guest("01030D", 250)));
        Assert.Equal(0, EncoderRules.DaiOnCard(Guest("01030D", 0))); // the lock program's own cards
        Assert.Equal(1, EncoderRules.DaiOnCard(Guest("01030D", 1)));
        Assert.Null(EncoderRules.DaiOnCard("551501"));
        Assert.Null(EncoderRules.DaiOnCard("5515010001020300010203ZZ"));
        Assert.Null(EncoderRules.DaiOnCard(null));
    }

    [Fact]
    public void The_lock_code_comes_off_the_card_whole()
    {
        Assert.Equal("01030D", EncoderRules.LockOnCard(Guest("01030D")));
        Assert.Equal("A50203", EncoderRules.LockOnCard(Guest("A50203")));
        Assert.Equal("A50203", EncoderRules.LockOnCard(Guest("a50203")));
        Assert.Null(EncoderRules.LockOnCard("551501"));
        Assert.Null(EncoderRules.LockOnCard(null));
    }

    [Theory]
    [InlineData("01030D", "01030D")]
    [InlineData("A50203", "250203")] // a building number above 127: Joney's decoder drops the top bit
    [InlineData("FF8081", "7F0001")]
    public void What_Joneys_decoder_shows(string lockNo, string shown) =>
        Assert.Equal(shown, EncoderRules.DecoderView(lockNo));

    [Theory]
    [InlineData("01030D", "01030D", "01030D", true)]
    [InlineData("01030D", "01030D", "01030d", true)]
    [InlineData("01030D", "01030D", " 01030D\0", true)]
    [InlineData("A50203", "A50203", "250203", true)]   // the decoder's 7-bit view of the right card
    [InlineData("A50203", "A50203", "A50203", true)]   // a decoder that keeps all 8 bits
    [InlineData("A50203", "250203", "250203", false)]  // another building whose code differs only in the top bit
    [InlineData("01030D", "01030E", "01030E", false)]
    [InlineData("01030D", "01030D", "01030E", false)]  // the card and the decoder disagree
    [InlineData("01030D", "01030E", "01030D", false)]
    [InlineData("01030D", "01030D", "1030D", false)]
    [InlineData("01030D", "01030D", "", false)]
    [InlineData("01030D", "01030D", null, false)]
    public void Lock_code_read_back(string expected, string onCard, string? decoded, bool matches) =>
        Assert.Equal(matches, EncoderRules.LockMatches(expected, decoded, Guest(onCard)));

    [Fact]
    public void A_lock_code_that_is_not_one_never_matches()
    {
        Assert.False(EncoderRules.LockMatches("", "", ""));
        Assert.False(EncoderRules.LockMatches("01030D", "01030D", null));
    }

    [Fact]
    public void Reading_a_guest_card_gives_its_door_end_and_DAI()
    {
        var r = EncoderRules.Describe(Cal, Guest("A50203", 3), "6", 0, "2611091200");
        Assert.Equal(new CardReading(CardReadKind.Guest, "A50203", "2611091200", 3), r); // the door from the card's bytes, not the 7-bit decoder
        Assert.Equal("2611091200", EncoderRules.Describe(Cal, Guest("01030D"), "6", 0, "2026-11-09 12:00:00").End);
        Assert.Equal(0, EncoderRules.Describe(Cal, Guest("01030D", 0), "6", 0, "2611091200").Dai); // made in the lock program
    }

    [Fact]
    public void Reading_tells_blank_other_hotel_and_unreadable_cards_apart()
    {
        Assert.Equal(CardReadKind.Blank, EncoderRules.Describe(Cal, Card("FF2A6C1E"), "F", -1, null).Kind);
        Assert.Equal(new CardReading(CardReadKind.OtherHotel), EncoderRules.Describe(Cal, Guest("01030D"), "6", 2, ""));
        Assert.Equal(CardReadKind.Unknown, EncoderRules.Describe(Cal, Guest("01030D"), "6", 0, "").Kind);
        Assert.Equal(CardReadKind.Unknown, EncoderRules.Describe(Cal, Guest("01030D"), "6", 0, "2613451200").Kind); // not a time
    }

    [Theory]
    [InlineData("B0000001", "B", "Master card")]
    [InlineData("A1B2C3D4", "A", "Emergency card")]
    [InlineData("0A1B2C3D", "0", "System card")]
    [InlineData("D0C0FFEE", "D", "Floor card")]
    [InlineData("7FFFFFFF", "7", "Check-out card")]
    [InlineData("E1234567", "E", "A staff or setup card")]
    public void A_staff_card_is_named_and_nothing_more(string serial, string type, string name) =>
        Assert.Equal(new CardReading(CardReadKind.Staff, StaffType: name), EncoderRules.Describe(Cal, Card(serial), type, -1, null));

    [Fact]
    public void When_the_DLL_and_the_card_disagree_nothing_is_claimed()
    {
        Assert.Equal(CardReadKind.Unknown, EncoderRules.Describe(Cal, Card("B0000001"), "6", 0, "2611091200").Kind);
        Assert.Equal(CardReadKind.Unknown, EncoderRules.Describe(Cal, Guest("01030D"), "F", -1, null).Kind);
        Assert.Null(EncoderRules.Describe(Cal, Card("B0000001"), "6", 0, "2611091200").LockNo);
    }

    [Fact]
    public void The_card_itself_decides()
    {
        var card = Guest("01030D", 7);
        var ok = EncoderRules.Judge(Cal, 99, true, card, "01030D", "2611091200", "01030D", "2611091200", 7);
        Assert.Equal(CardWriteStatus.Issued, ok.Status);

        var high = EncoderRules.Judge(Cal, 0, true, Guest("A50204", 251), "250204", "2611091200", "A50204", "2611091200", 251);
        Assert.Equal(CardWriteStatus.Issued, high.Status);

        // Right door and time, but the card still holds the previous stay's DAI: not this order's card.
        var oldDai = EncoderRules.Judge(Cal, 0, true, Guest("01030D", 6), "01030D", "2611091200", "01030D", "2611091200", 7);
        Assert.Equal(CardWriteStatus.Unknown, oldDai.Status);

        var moved = EncoderRules.Judge(Cal, 0, false, null, null, null, "01030D", "2611091200", 7);
        Assert.Equal(CardWriteStatus.Unknown, moved.Status);

        var oddOk = EncoderRules.Judge(Cal, 0, true, Guest("01030E"), "01030E", "2611091200", "01030D", "2611091200", 7);
        Assert.Equal(CardWriteStatus.Unknown, oddOk.Status);

        var refused = EncoderRules.Judge(Cal, 3, true, Guest("01030E"), "01030E", "2611081200", "01030D", "2611091200", 7);
        Assert.Equal(CardWriteStatus.Failed, refused.Status);
        Assert.Contains("code 3", refused.Error);
    }
}
