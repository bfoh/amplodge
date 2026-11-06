using System.Runtime.InteropServices;
using System.Text;

namespace LockBridge.Win;

/// <summary>
/// The few proRFL.dll calls the bridge uses (32-bit, stdcall). Master, floor,
/// building, emergency, system and "always open" cards are deliberately not
/// declared: the bridge cannot make them.
/// </summary>
internal static class ProRfl
{
    public const string Dll = "proRFL.dll";
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

    /// <summary>Loads proRFL.dll from the SDK folder; its own d12/d12c/MFC companions are found beside it.</summary>
    public static void LoadFrom(string directory)
    {
        SetDllDirectoryW(directory);
        var path = Path.Combine(directory, Dll);
        NativeLibrary.SetDllImportResolver(typeof(ProRfl).Assembly, (name, _, _) =>
            string.Equals(name, Dll, StringComparison.OrdinalIgnoreCase) ? NativeLibrary.Load(path) : IntPtr.Zero);
    }
}
