using System.Runtime.InteropServices;
using System.Text;

namespace LockBridge.Win;

/// <summary>
/// The few proRFL.dll calls the bridge uses (32-bit, stdcall), as in Joney's SDK
/// V0925 ("ProUsb-20211115"). That DLL has no master, floor, building, emergency
/// or system card functions; the bridge declares no others either, so it cannot
/// make them. Lock codes are 6 hex characters; times are yyMMddHHmm.
/// </summary>
internal static class ProRfl
{
    public const string Dll = "proRFL.dll";
    /// <summary>sha256 of proRFL.dll in Joney's "New Lock System SDK [V0925]". The only build used unless encoder.json names another.</summary>
    public const string JoneyV0925Sha256 = "4a86c167956aaf025a033362a84164be944c2c16a8615489ad4243215af08e1d";
    /// <summary>Generous: a whole MIFARE 1K card as hex is 2,048 characters.</summary>
    public const int BufferChars = 8192;

    [DllImport(Dll, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int GetDLLVersion(StringBuilder version);

    [DllImport(Dll, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int initializeUSB(byte fUSB);

    [DllImport(Dll, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int Buzzer(byte fUSB, int t);

    [DllImport(Dll, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int ReadCard(byte fUSB, StringBuilder buffer);

    [DllImport(Dll, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int GuestCard(byte fUSB, int dlsCoID, byte cardNo, byte dai, byte llock, byte pdoors,
        string bDate, string eDate, string lockNo, StringBuilder cardHexStr);

    [DllImport(Dll, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int GetCardTypeByCardDataStr(string cardHexStr, StringBuilder cardType);

    [DllImport(Dll, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int GetGuestLockNoByCardDataStr(int dlsCoID, string cardHexStr, StringBuilder lockNo);

    [DllImport(Dll, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int GetGuestETimeByCardDataStr(int dlsCoID, string cardHexStr, StringBuilder eTime);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetDllDirectoryW(string? path);

    /// <summary>Loads proRFL.dll from the SDK folder. Joney's 2021 build needs no other DLL beside it.</summary>
    public static void LoadFrom(string directory)
    {
        SetDllDirectoryW(directory);
        var path = Path.Combine(directory, Dll);
        NativeLibrary.SetDllImportResolver(typeof(ProRfl).Assembly, (name, _, _) =>
            string.Equals(name, Dll, StringComparison.OrdinalIgnoreCase) ? NativeLibrary.Load(path) : IntPtr.Zero);
    }
}
