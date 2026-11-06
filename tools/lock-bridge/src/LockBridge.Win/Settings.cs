using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LockBridge.Core;

namespace LockBridge.Win;

/// <summary>Where the bridge keeps its files: %ProgramData%\AMPLockBridge.</summary>
public sealed class BridgePaths(string root)
{
    public static BridgePaths Default => new(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AMPLockBridge"));
    public string Root => root;
    public string Settings => Path.Combine(root, "encoder.json");
    public string Pairing => Path.Combine(root, "bridge-config.bin");
    public string HotelId => Path.Combine(root, "hotel.bin");
    public string Journal => Path.Combine(root, "journal.jsonl");
    public string Log => Path.Combine(root, "bridge.log");
}

/// <summary>
/// encoder.json: where the SDK is and what its answers mean (from the on-site
/// probe). Plain JSON so the developer can fill it in over remote desktop; it
/// holds nothing secret. The hotel's lock ID is kept separately, sealed.
/// </summary>
public sealed record EncoderSettings
{
    public string DllDirectory { get; init; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "AMP Lock Bridge", "sdk");
    /// <summary>The proRFL.dll fingerprint (sha256, from the bridge log). Once set, a different DLL is refused.</summary>
    public string? ProRflSha256 { get; init; }
    public EncoderCalibration Calibration { get; init; } = new();

    private static readonly JsonSerializerOptions Json = new(CardFormat.Json) { WriteIndented = true };

    public static EncoderSettings LoadOrCreate(string path)
    {
        if (File.Exists(path)) return JsonSerializer.Deserialize<EncoderSettings>(File.ReadAllText(path), Json) ?? new();
        var fresh = new EncoderSettings();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(fresh, Json));
        return fresh;
    }
}

/// <summary>DPAPI, machine scope: the sealed files open on this PC only.</summary>
public sealed class DpapiProtector : ISecretProtector
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("AMPLockBridge v1");
    public byte[] Protect(byte[] data) => ProtectedData.Protect(data, Entropy, DataProtectionScope.LocalMachine);
    public byte[] Unprotect(byte[] data) => ProtectedData.Unprotect(data, Entropy, DataProtectionScope.LocalMachine);
}

/// <summary>The hotel's lock ID ("Hotel CoID" in the lock program's Export LockNo file). Sealed with DPAPI.</summary>
public static class HotelIdStore
{
    public static int? Load(string path, ISecretProtector protector)
    {
        if (!File.Exists(path)) return null;
        var text = Encoding.UTF8.GetString(protector.Unprotect(File.ReadAllBytes(path)));
        return int.TryParse(text, out var id) && id > 0 ? id : null;
    }

    public static void Save(string path, ISecretProtector protector, int id)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, protector.Protect(Encoding.UTF8.GetBytes(id.ToString(System.Globalization.CultureInfo.InvariantCulture))));
    }
}

/// <summary>A plain log of what the encoder answered (return codes, never card data).</summary>
public sealed class FileLog(string path)
{
    private readonly Lock _gate = new();

    public void Write(string line)
    {
        lock (_gate)
        {
            try
            {
                if (File.Exists(path) && new FileInfo(path).Length > 5_000_000) File.Move(path, path + ".old", overwrite: true);
                File.AppendAllText(path, $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss} {line}{Environment.NewLine}");
            }
            catch (IOException) { }
        }
    }
}
