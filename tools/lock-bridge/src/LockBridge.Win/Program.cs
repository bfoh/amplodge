using LockBridge.Core;

namespace LockBridge.Win;

/// <summary>
/// AMPLockBridge.exe                     run in the tray (autostart)
/// AMPLockBridge.exe --set-hotel-id N    store the hotel's lock ID (sealed to this PC), then exit
/// AMPLockBridge.exe --unpair            forget the pairing, then exit
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetHighDpiMode(HighDpiMode.SystemAware);

        var paths = BridgePaths.Default;
        Directory.CreateDirectory(paths.Root);
        var protector = new DpapiProtector();
        var store = new FileConfigStore(paths.Pairing, protector);

        if (args is ["--set-hotel-id", var raw])
        {
            if (!int.TryParse(raw, out var id) || id <= 0) return Say("The hotel lock ID must be a whole number above 0.", 2);
            HotelIdStore.Save(paths.HotelId, protector, id);
            return Say("Hotel lock ID saved on this PC.", 0);
        }
        if (args is ["--unpair"])
        {
            store.Clear();
            return Say("This PC is no longer paired.", 0);
        }
        if (args.Length > 0) return Say("Unknown option. Use --set-hotel-id <number> or --unpair.", 2);

        using var single = new Mutex(true, @"Global\AMPLockBridge", out var first);
        if (!first) return Say("The lock bridge is already running (see the tray, by the clock).", 1);

        var log = new FileLog(paths.Log);
        var options = new BridgeOptions();
        log.Write($"starting {options.BridgeVersion}");
        var settings = EncoderSettings.LoadOrCreate(paths.Settings);
        int? hotelId = null;
        try { hotelId = HotelIdStore.Load(paths.HotelId, protector); }
        catch (Exception ex) { log.Write($"hotel ID unreadable: {ex.Message}"); }

        using var driver = new ProRflDriver(settings, hotelId, log);
        using var journal = new Journal(paths.Journal);
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        var bridge = new Bridge(options, driver, store, journal, new ServerClient(http), TimeProvider.System);
        try { bridge.Start(); }
        catch (Exception ex) { log.Write($"pairing unreadable, starting unpaired: {ex.Message}"); }

        var app = BridgeApi.Build(bridge);
        try { app.StartAsync().GetAwaiter().GetResult(); }
        catch (IOException ex)
        {
            log.Write($"port {options.Port} unavailable: {ex.Message}");
            return Say($"The lock bridge could not start: port {options.Port} is in use by another program.", 3);
        }

        Application.Run(new TrayApp(bridge, new LockProgram(paths.LockProgram, log)));

        // Quit: a page may still be waiting on a request (a read that waits for a card, or the
        // encoder's thread may be inside Joney's DLL), so the clean-up gets a few seconds, then the
        // process ends regardless. The journal writes through, so nothing waits on it.
        log.Write("stopping");
        var cleanup = Task.Run(async () =>
        {
            using var grace = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            try { await app.StopAsync(grace.Token); } catch (Exception ex) { log.Write($"stopping the web side: {ex.Message}"); }
            try { await bridge.DisposeAsync(); } catch (Exception ex) { log.Write($"stopping the session: {ex.Message}"); }
        });
        log.Write(cleanup.Wait(TimeSpan.FromSeconds(6)) ? "stopped" : "stopped (clean-up did not finish in time)");
        Environment.Exit(0);
        return 0;
    }

    private static int Say(string message, int code)
    {
        MessageBox.Show(message, "AMP Lock Bridge", MessageBoxButtons.OK, code == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        return code;
    }
}
