using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using LockBridge.Core;

namespace LockBridge.Win;

/// <summary>
/// The tray icon. Green: ready to make cards. Amber: something to do (not paired,
/// results not yet sent, encoder not ready). Red: the server no longer knows this
/// PC, or Joney's lock program has stopped answering.
/// </summary>
public sealed class TrayApp : ApplicationContext
{
    private const string KeyCardsUrl = "https://amplodge.org/staff/key-cards";
    private readonly Bridge _bridge;
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _state = new("Starting…") { Enabled = false };
    private readonly ToolStripMenuItem _unpair = new("Unpair this PC…");
    private readonly ToolStripMenuItem _startLocks = new("Start Joney's lock program");
    private readonly LockProgram _lockProgram;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 5000 };
    private readonly Icon _green = Dot(Color.FromArgb(22, 163, 74));
    private readonly Icon _amber = Dot(Color.FromArgb(217, 119, 6));
    private readonly Icon _red = Dot(Color.FromArgb(220, 38, 38));
    private bool _refreshing;

    public TrayApp(Bridge bridge, LockProgram lockProgram)
    {
        _bridge = bridge;
        _lockProgram = lockProgram;
        var menu = new ContextMenuStrip();
        menu.Items.Add(_state);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Open the Key cards page", null, (_, _) => Open(KeyCardsUrl));
        menu.Items.Add(_startLocks);
        menu.Items.Add(_unpair);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit the lock bridge", null, (_, _) => Quit());
        _unpair.Click += async (_, _) => await Unpair();
        _startLocks.Click += async (_, _) => await StartLockProgram();

        _icon = new NotifyIcon { Icon = _amber, Text = "AMP Lock Bridge", ContextMenuStrip = menu, Visible = true };
        _icon.DoubleClick += (_, _) => Open(KeyCardsUrl);
        _timer.Tick += async (_, _) => await Refresh();
        _timer.Start();
        _ = Refresh();
    }

    private async Task Refresh()
    {
        if (_refreshing) return;
        _refreshing = true;
        try
        {
            DriverStatus driver;
            try { driver = await _bridge.Driver.StatusAsync(CancellationToken.None); }
            catch (Exception ex) { driver = new DriverStatus(false, null, ex.Message); }
            if (driver.DllVersion is not null) _bridge.DllVersion = driver.DllVersion;

            var session = _bridge.Session;
            var unsent = session?.Writer.PendingReceipts().Sum(p => p.Cards.Count) ?? 0;
            (Icon icon, string text) = (session, driver) switch
            {
                ({ Receipts.Revoked: true }, _) => (_red, "This PC was removed in Settings. Pair it again."),
                (_, { Ready: false }) when driver.Message.Contains("stopped answering") => (_red, driver.Message),
                (null, _) => (_amber, "Not paired. In the portal: Settings → Door locks → Pair this PC."),
                (_, { Ready: false }) => (_amber, driver.Message),
                _ when unsent > 0 => (_amber, $"{unsent} card result(s) not sent to the server yet. Is the internet working?"),
                _ => (_green, $"Ready: {session!.Config.Label}"),
            };
            _icon.Icon = icon;
            _state.Text = text;
            _icon.Text = Truncate($"AMP Lock Bridge — {text}", 127);
            _unpair.Enabled = session is not null;
            var running = _lockProgram.Running;
            _startLocks.Enabled = !running;
            _startLocks.Text = running ? "Joney's lock program is open" : "Start Joney's lock program";
        }
        finally { _refreshing = false; }
    }

    private async Task StartLockProgram()
    {
        if (_lockProgram.Running) { await Refresh(); return; }
        if (_lockProgram.Start() is { } problem)
            MessageBox.Show(problem, "AMP Lock Bridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
        else
            _icon.ShowBalloonTip(8000, "AMP Lock Bridge", "Starting Joney's lock program. Log in to it: the encoder is ready a few seconds later.", ToolTipIcon.Info);
        await Refresh();
    }

    private async Task Unpair()
    {
        var sure = MessageBox.Show(
            "Unpair this PC from AMP Lodge?\n\nKey cards cannot be made here until an admin pairs it again in Settings → Door locks. Cards already made keep working.",
            "AMP Lock Bridge", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
        if (sure != DialogResult.Yes) return;
        if (!await _bridge.UnpairAsync())
            MessageBox.Show("A card is being written right now. Try again in a moment.", "AMP Lock Bridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
        await Refresh();
    }

    private void Quit()
    {
        if (_bridge.Session?.Writer.Busy == true)
        {
            MessageBox.Show("A card is being written right now. Quit once it is done.", "AMP Lock Bridge", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        ExitThread();
    }

    protected override void ExitThreadCore()
    {
        _timer.Stop();
        _icon.Visible = false;
        _icon.Dispose();
        base.ExitThreadCore();
    }

    private static void Open(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception) { /* no browser: nothing to do */ }
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..(max - 1)] + "…";

    private static Icon Dot(Color color)
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var fill = new SolidBrush(color);
            g.FillEllipse(fill, 3, 3, 26, 26);
            using var ring = new Pen(Color.White, 3);
            g.DrawEllipse(ring, 3, 3, 26, 26);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }
}
