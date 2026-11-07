namespace LockBridge.Core;

/// <summary>
/// What the encoder's DLL answers, learned on site from the probe log
/// (tools/lock-bridge/probe). Until <see cref="Calibrated"/> is set, the real
/// driver writes nothing: Joney's documentation gives 0 as success, but not the
/// text GetCardTypeByCardDataStr gives each card type, and guessing that could
/// overwrite a master or system card.
/// </summary>
public sealed record EncoderCalibration
{
    public bool Calibrated { get; init; }
    /// <summary>The DLL's fUSB argument. Joney's 2021 DLL ignores it (their program drives the encoder); kept for the probe log.</summary>
    public byte UsbType { get; init; } = 1;
    public IReadOnlyList<int> InitOkCodes { get; init; } = [];
    public IReadOnlyList<int> ReadOkCodes { get; init; } = [];
    public IReadOnlyList<int> WriteOkCodes { get; init; } = [];
    /// <summary>
    /// The card-type code (its first character, from GetCardTypeByCardDataStr) of a blank card.
    /// Such a card may be written. Joney documents "F".
    /// </summary>
    public IReadOnlyList<string> BlankCardTypes { get; init; } = [];
    /// <summary>The card-type code of a guest card (any hotel, any room). Such a card may be overwritten. Joney documents "6".</summary>
    public IReadOnlyList<string> GuestCardTypes { get; init; } = [];
    /// <summary>Short beep after a card checks out, if the encoder does not beep by itself.</summary>
    public bool BeepOnSuccess { get; init; }
}

public enum CardKind { Blank, Guest, Other }

/// <summary>The checks around a write that do not need Windows, so they are tested on any OS.</summary>
public static class EncoderRules
{
    public static string Digits(string? s) => new((s ?? "").Where(char.IsAsciiDigit).ToArray());

    /// <summary>
    /// What the DLL says the card is. Joney's GetCardTypeByCardDataStr gives a code
    /// whose first character is the type (6 guest, F blank, B master, D floor...).
    /// Anything that is not known to be blank or a guest card is "other" and is
    /// never written over: it may be the hotel's master, floor, setup or backup card.
    /// </summary>
    public static CardKind Classify(string? typeText, EncoderCalibration c)
    {
        var t = (typeText ?? "").Trim();
        if (t.Length == 0) return CardKind.Other;
        var code = t[..1];
        if (c.BlankCardTypes.Contains(code, StringComparer.OrdinalIgnoreCase)) return CardKind.Blank;
        if (c.GuestCardTypes.Contains(code, StringComparer.OrdinalIgnoreCase)) return CardKind.Guest;
        return CardKind.Other;
    }

    /// <summary>
    /// What the card's own data says it is: a card is present when characters 5-6
    /// are "01", and characters 25-32 are the card's serial, whose first character
    /// is its type, the same code the lock program gives (6 guest, F blank, 0 system,
    /// B master, D floor...). A factory-new card reads FFFFFFFF; one the lock program
    /// erased keeps a serial such as FF2A6C1E (the shape seen on site). Joney's demo knows only
    /// FFFFFFFF. A second opinion beside <see cref="Classify"/>: both must agree
    /// before a card is written.
    /// </summary>
    public static CardKind FromCardData(string? hex)
    {
        var h = (hex ?? "").Trim();
        if (h.Length < 32 || h.Substring(4, 2) != "01") return CardKind.Other;
        return char.ToUpperInvariant(h[24]) switch
        {
            'F' => CardKind.Blank,
            '6' => CardKind.Guest,
            _ => CardKind.Other,
        };
    }

    /// <summary>
    /// The lock code as the card holds it: characters 21-22, 19-20 and 17-18 of the card
    /// data (building, floor, room; the bytes Joney's decoder reads). Null if not there.
    /// </summary>
    public static string? LockOnCard(string? hex)
    {
        var h = (hex ?? "").Trim();
        if (h.Length < 22) return null;
        var code = (h.Substring(20, 2) + h.Substring(18, 2) + h.Substring(16, 2)).ToUpperInvariant();
        return CardFormat.IsLockNo(code) ? code : null;
    }

    /// <summary>
    /// The DAI as the card holds it: characters 23-24 of the card data, in hex (seen on
    /// site: cards written with DAI 250 and 251 read FA and FB; the lock program's own
    /// cards read 00, its "Dai: 0"). Null if not there.
    /// </summary>
    public static int? DaiOnCard(string? hex)
    {
        var h = (hex ?? "").Trim();
        if (h.Length < 24) return null;
        return byte.TryParse(h.AsSpan(22, 2), System.Globalization.NumberStyles.AllowHexSpecifier, null, out var dai) ? dai : null;
    }

    /// <summary>
    /// What Joney's decoder (GetGuestLockNoByCardDataStr) shows for a lock code: it takes
    /// each byte mod 128, so building 165 (A5) shows as 25. Its answer can't tell A5 from 25.
    /// </summary>
    public static string DecoderView(string lockNo) =>
        string.Concat(Enumerable.Range(0, 3).Select(i => (Convert.ToByte(lockNo.Substring(i * 2, 2), 16) & 0x7F).ToString("X2")));

    /// <summary>
    /// Is the card made for this lock? The card's own bytes must be the code exactly, and
    /// Joney's decoder must agree: on the seven bits of each byte it keeps, or on the whole
    /// code (should a later DLL keep all eight).
    /// </summary>
    public static bool LockMatches(string expected, string? decoded, string? cardHex)
    {
        if (!CardFormat.IsLockNo(expected)) return false;
        var d = new string((decoded ?? "").Where(c => !char.IsWhiteSpace(c) && c != '\0').ToArray());
        return string.Equals(LockOnCard(cardHex), expected, StringComparison.OrdinalIgnoreCase)
            && (string.Equals(d, DecoderView(expected), StringComparison.OrdinalIgnoreCase)
                || string.Equals(d, expected, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The end time a decoder printed, as yyMMddHHmm: it may come with a 4-digit year or with
    /// seconds. Null if it is not a time.
    /// </summary>
    public static string? CardEnd(string? decoded)
    {
        var d = Digits(decoded);
        if (d.Length is 12 or 14 && d.StartsWith("20", StringComparison.Ordinal)) d = d[2..];
        if (d.Length is not (10 or 12)) return null;
        return CardFormat.TryParseCardTime(d[..10], out _) ? d[..10] : null;
    }

    /// <summary>The staff and setup cards, by the type code that starts a card's serial (Joney's list).</summary>
    private static readonly Dictionary<char, string> StaffCards = new()
    {
        ['0'] = "System card", ['1'] = "Record card", ['2'] = "Lock setting card", ['3'] = "Clock card",
        ['4'] = "Lost card", ['5'] = "Group setting card", ['7'] = "Check-out card", ['8'] = "Group card",
        ['A'] = "Emergency card", ['B'] = "Master card", ['C'] = "Building card", ['D'] = "Floor card",
    };

    /// <summary>
    /// What a card is, for "Read a card": the DLL's card type and the card's own data must agree,
    /// as before a write. A guest card of this hotel gives its door (from the card's bytes), end
    /// time and DAI; endCode is GetGuestETimeByCardDataStr's answer, 2 for another hotel's card.
    /// A staff or setup card gives only its kind: its data never leaves the bridge.
    /// </summary>
    public static CardReading Describe(EncoderCalibration c, string hex, string? dllType, int endCode, string? endRead)
    {
        var kind = Classify(dllType, c);
        var layout = FromCardData(hex);
        if (kind == CardKind.Blank && layout == CardKind.Blank) return new(CardReadKind.Blank);
        if (kind == CardKind.Guest && layout == CardKind.Guest)
        {
            if (endCode == 2) return new(CardReadKind.OtherHotel);
            var lockNo = LockOnCard(hex);
            var end = CardEnd(endRead);
            if (endCode != 0 || lockNo is null || end is null)
                return new(CardReadKind.Unknown, Message: "A guest card, but its door or end time could not be read.");
            return new(CardReadKind.Guest, lockNo, end, DaiOnCard(hex));
        }
        if (kind == CardKind.Other && layout == CardKind.Other)
        {
            var t = (dllType ?? "").Trim();
            var name = t.Length > 0 && StaffCards.TryGetValue(char.ToUpperInvariant(t[0]), out var n) ? n : "A staff or setup card";
            return new(CardReadKind.Staff, StaffType: name);
        }
        return new(CardReadKind.Unknown, Message: "The encoder and the card's own data disagree about what this card is.");
    }

    /// <summary>The DLL may print the end time with a 4-digit year or with seconds; compare the minutes.</summary>
    public static bool EndMatches(string expected, string? decoded)
    {
        var d = Digits(decoded);
        if (d.Length is 12 or 14 && d.StartsWith("20", StringComparison.Ordinal) && d[2..].StartsWith(expected, StringComparison.Ordinal)) return true;
        return d.Length >= 10 && d[..10] == expected && d.Length is 10 or 12;
    }

    /// <summary>
    /// What one write came to, from the DLL's return code and a read-back of the card.
    /// The card's own content decides; the code only matters when the card cannot be read.
    /// </summary>
    public static CardWriteResult Judge(EncoderCalibration c, int writeCode, bool readBackOk, string? cardHex, string? lockRead, string? endRead, string expectedLock, string expectedEnd, int expectedDai)
    {
        if (readBackOk && LockMatches(expectedLock, lockRead, cardHex) && EndMatches(expectedEnd, endRead) && DaiOnCard(cardHex) == expectedDai)
            return new(CardWriteStatus.Issued);
        if (!readBackOk)
            return new(CardWriteStatus.Unknown, $"The card could not be read back (code {writeCode}). It may have been moved. Try it at the door.");
        if (c.WriteOkCodes.Contains(writeCode))
            return new(CardWriteStatus.Unknown, "The encoder said it wrote the card, but the card does not read back as written. Try it at the door.");
        // Read back fine and holds something else: the write did not happen, so trying again is safe.
        return new(CardWriteStatus.Failed, $"The encoder did not write the card (code {writeCode}). Try again with the card flat on the encoder.");
    }
}
