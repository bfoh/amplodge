using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace LockBridge.Win;

/// <summary>
/// Joney's lock program (LQ015's CardLock.exe): the proRFL.dll talks to it, so no card can be
/// made while it is closed. The tray starts it. Where it lives is learnt from the running
/// program and remembered in ProgramData; until then the installer's usual folders are tried.
/// </summary>
public sealed class LockProgram(string rememberedFile, FileLog log)
{
    private const string ProcessName = "CardLock";
    private const string InstallFolder = "LQ015 Smart Locks System";
    private string? _remembered;

    public bool Running
    {
        get
        {
            var running = Process.GetProcessesByName(ProcessName);
            try
            {
                if (running.Length == 0) return false;
                // Learn where it runs from, so the tray can start it next time.
                if (running.Select(PathOf).FirstOrDefault(p => p is not null) is { } path && !string.Equals(path, Remembered(), StringComparison.OrdinalIgnoreCase)) Remember(path);
                return true;
            }
            finally { foreach (var p in running) p.Dispose(); }
        }
    }

    /// <summary>Starts it as this user. It may ask for Windows' permission, then for its own log-in.</summary>
    public string? Start()
    {
        var path = Find();
        if (path is null)
            return "Joney's lock program (CardLock.exe) was not found. Start it once from its own icon: the lock bridge then remembers where it is.";
        try
        {
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(path)! })?.Dispose();
            log.Write($"started the lock program: {path}");
            return null;
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223) { return null; } // the person said no to Windows' prompt
        catch (Exception ex)
        {
            log.Write($"starting the lock program failed: {ex.Message}");
            return $"Joney's lock program could not be started: {ex.Message}";
        }
    }

    private string? Find()
    {
        if (Remembered() is { } known && File.Exists(known)) return known;
        var candidates = DriveInfo.GetDrives()
            .Where(d => d.DriveType == DriveType.Fixed)
            .Select(d => Path.Combine(d.RootDirectory.FullName, InstallFolder))
            .Append(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), InstallFolder))
            .Append(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), InstallFolder));
        return candidates.Select(dir => Path.Combine(dir, ProcessName + ".exe")).FirstOrDefault(File.Exists);
    }

    private string? Remembered()
    {
        if (_remembered is not null) return _remembered;
        try { _remembered = File.Exists(rememberedFile) ? File.ReadAllText(rememberedFile).Trim() is { Length: > 0 } p ? p : null : null; }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return _remembered;
    }

    private void Remember(string path)
    {
        _remembered = path;
        try
        {
            File.WriteAllText(rememberedFile, path);
            log.Write($"lock program found at {path}");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { log.Write($"could not remember the lock program's folder: {ex.Message}"); }
    }

    /// <summary>
    /// The program's file. Limited query rights are enough, even when Joney's program runs as
    /// administrator and the bridge does not (Process.MainModule would need more).
    /// </summary>
    private static string? PathOf(Process p)
    {
        var handle = OpenProcess(QueryLimitedInformation, false, p.Id);
        if (handle == IntPtr.Zero) return null;
        try
        {
            var buffer = new StringBuilder(1024);
            var size = buffer.Capacity;
            return QueryFullProcessImageName(handle, 0, buffer, ref size) ? buffer.ToString(0, size) : null;
        }
        finally { CloseHandle(handle); }
    }

    private const uint QueryLimitedInformation = 0x1000;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "QueryFullProcessImageNameW")]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
}
