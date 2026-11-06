namespace LockBridge.Core;

/// <summary>
/// What the encoder's DLL answers, learned on site from the probe log
/// (tools/lock-bridge/probe). Until <see cref="Calibrated"/> is set, the real
/// driver writes nothing: return codes and card-type names are not published
/// anywhere, and guessing them could overwrite a master or system card.
/// </summary>
public sealed record EncoderCalibration
{
    public bool Calibrated { get; init; }
    /// <summary>The DLL's USB type: 1 is the HID encoder (d12c.dll), as the hotel software uses.</summary>
    public byte UsbType { get; init; } = 1;
    public IReadOnlyList<int> InitOkCodes { get; init; } = [];
    public IReadOnlyList<int> ReadOkCodes { get; init; } = [];
    public IReadOnlyList<int> WriteOkCodes { get; init; } = [];
    /// <summary>Card-type text the DLL gives a blank card. Such a card may be written.</summary>
    public IReadOnlyList<string> BlankCardTypes { get; init; } = [];
    /// <summary>Card-type text for a guest card (any hotel, any room). Such a card may be overwritten.</summary>
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
    /// Anything that is not known to be blank or a guest card is "other" and is
    /// never written over: it may be the hotel's master, floor, setup or backup card.
    /// </summary>
    public static CardKind Classify(string? typeText, EncoderCalibration c)
    {
        var t = (typeText ?? "").Trim();
        if (t.Length == 0) return CardKind.Other;
        if (c.BlankCardTypes.Contains(t, StringComparer.OrdinalIgnoreCase)) return CardKind.Blank;
        if (c.GuestCardTypes.Contains(t, StringComparer.OrdinalIgnoreCase)) return CardKind.Guest;
        return CardKind.Other;
    }

    public static bool LockMatches(string expected, string? decoded) => Digits(decoded) == expected;

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
    public static CardWriteResult Judge(EncoderCalibration c, int writeCode, bool readBackOk, string? lockRead, string? endRead, string expectedLock, string expectedEnd)
    {
        if (readBackOk && LockMatches(expectedLock, lockRead) && EndMatches(expectedEnd, endRead))
            return new(CardWriteStatus.Issued);
        if (!readBackOk)
            return new(CardWriteStatus.Unknown, $"The card could not be read back (code {writeCode}). It may have been moved. Try it at the door.");
        if (c.WriteOkCodes.Contains(writeCode))
            return new(CardWriteStatus.Unknown, "The encoder said it wrote the card, but the card does not read back as written. Try it at the door.");
        // Read back fine and holds something else: the write did not happen, so trying again is safe.
        return new(CardWriteStatus.Failed, $"The encoder did not write the card (code {writeCode}). Try again with the card flat on the encoder.");
    }
}
