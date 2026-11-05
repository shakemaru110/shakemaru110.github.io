using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Metronome;

internal sealed class MetronomeWindow : Form
{
    private const string Origin = "https://metronome.example";
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill };
    private readonly string? reportPath;
    private CoreWebView2Environment? environment;
    public int ExitCode { get; private set; }

    public MetronomeWindow(string? reportPath)
    {
        this.reportPath = reportPath;
        Text = "Metronome";
        ClientSize = new Size(880, 900);
        MinimumSize = new Size(400, 600);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.FromArgb(245, 247, 250);
        Controls.Add(browser);
        if (reportPath is not null)
        {
            ShowInTaskbar = false;
            Opacity = 0;
        }
        Shown += Initialize;
    }

    private async void Initialize(object? sender, EventArgs e)
    {
        try
        {
            string userData = reportPath is null
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "shakemaru", "Metronome", "WebView2")
                : Path.Combine(Path.GetDirectoryName(reportPath)!, "test-profile-" + Guid.NewGuid().ToString("N"));
            // Keep the scheduler active when another window covers the app, or it is minimized.
            var options = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows"
                    + (reportPath is not null ? " --autoplay-policy=no-user-gesture-required --mute-audio" : ""),
                Language = "ja"
            };
            environment = await CoreWebView2Environment.CreateAsync(null, userData, options);
            await browser.EnsureCoreWebView2Async(environment);
            var core = browser.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = reportPath is not null;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.IsMuted = reportPath is not null;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += ServeResource;
            core.NewWindowRequested += (_, request) => { request.Handled = true; OpenExternal(request.Uri); };
            core.NavigationStarting += (_, navigation) =>
            {
                if (!IsLocal(navigation.Uri)) { navigation.Cancel = true; OpenExternal(navigation.Uri); }
            };
            core.DownloadStarting += (_, download) => download.Cancel = true;
            await Navigate(() => core.Navigate(Origin + "/metronome.html"));
            if (reportPath is not null) await SelfTest();
        }
        catch (Exception error)
        {
            ExitCode = 1;
            if (reportPath is not null)
            {
                WriteReport(new { success = false, error = error.ToString() });
            }
            else if (error is WebView2RuntimeNotFoundException)
            {
                if (MessageBox.Show(this,
                    "Microsoft Edge WebView2 Runtimeが必要です。\nMicrosoft公式のダウンロードページを開きますか？\nインストール後に、このアプリをもう一度起動してください。",
                    "Metronome", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
            }
            else
            {
                MessageBox.Show(this, "アプリを起動できませんでした。\n" + error.Message, "Metronome", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            Close();
        }
    }

    private static bool IsLocal(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == "https" && uri.Host == "metronome.example" && uri.IsDefaultPort;

    private static void OpenExternal(string value)
    {
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme is "https" or "http")
        {
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
            catch (System.ComponentModel.Win32Exception) { /* No default browser is configured. */ }
        }
    }

    private void ServeResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var uri = new Uri(e.Request.Uri);
        string? contentType = uri.AbsolutePath switch
        {
            "/metronome.html" => "text/html; charset=utf-8",
            "/metronome.css" => "text/css; charset=utf-8",
            "/metronome.js" or "/metronome-audio.js" => "text/javascript; charset=utf-8",
            _ => null
        };
        if (!IsLocal(e.Request.Uri) || contentType is null)
        {
            e.Response = environment!.CreateWebResourceResponse(null, 404, "Not Found", "Content-Type: text/plain");
            return;
        }
        Stream stream = Resource("Metronome.Web." + uri.AbsolutePath[1..]);
        if (uri.AbsolutePath == "/metronome.html")
        {
            using var reader = new StreamReader(stream, Encoding.UTF8);
            string html = reader.ReadToEnd();
            html = Regex.Replace(html, @"\s*<nav\b[^>]*>.*?</nav>", "", RegexOptions.Singleline);
            html = Regex.Replace(html, @"<p class=""hint footer-note"">.*?</p>",
                "<p class=\"hint footer-note\">設定はこのアプリに保存されます。スペースキーでも再生・停止できます。</p>", RegexOptions.Singleline);
            stream = new MemoryStream(Encoding.UTF8.GetBytes(html));
        }
        string headers = "Content-Type: " + contentType + "\r\nCache-Control: no-store\r\n"
            + "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\n";
        e.Response = environment!.CreateWebResourceResponse(stream, 200, "OK", headers);
    }

    private static Stream Resource(string name) => Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
        ?? throw new InvalidOperationException("同梱ファイルが見つかりません: " + name);

    private async Task Navigate(Action action)
    {
        var completed = new TaskCompletionSource<bool>();
        void OnCompleted(object? _, CoreWebView2NavigationCompletedEventArgs navigation)
        {
            if (navigation.IsSuccess) completed.TrySetResult(true);
            else completed.TrySetException(new InvalidOperationException("画面を読み込めませんでした: " + navigation.WebErrorStatus));
        }
        browser.CoreWebView2.NavigationCompleted += OnCompleted;
        try { action(); await completed.Task.WaitAsync(TimeSpan.FromSeconds(30)); }
        finally { browser.CoreWebView2.NavigationCompleted -= OnCompleted; }
    }

    private async Task SelfTest()
    {
        var completed = new TaskCompletionSource<JsonElement>();
        void OnMessage(object? _, CoreWebView2WebMessageReceivedEventArgs message)
        {
            if (!IsLocal(message.Source)) return;
            using var json = JsonDocument.Parse(message.WebMessageAsJson);
            completed.TrySetResult(json.RootElement.Clone());
        }
        browser.CoreWebView2.WebMessageReceived += OnMessage;
        JsonElement result;
        try
        {
            using var reader = new StreamReader(Resource("Metronome.Tests.smoke.js"));
            await browser.CoreWebView2.ExecuteScriptAsync(await reader.ReadToEndAsync());
            result = await completed.Task.WaitAsync(TimeSpan.FromSeconds(45));
        }
        finally { browser.CoreWebView2.WebMessageReceived -= OnMessage; }
        if (!result.GetProperty("success").GetBoolean()) throw new InvalidOperationException(result.ToString());
        await Navigate(() => browser.CoreWebView2.Reload());
        string persisted = await browser.CoreWebView2.ExecuteScriptAsync("document.getElementById('tempo').value === '123' && document.getElementById('offbeat-volume').value === '65' && document.getElementById('subdivision').value === 'bars-8'");
        if (persisted != "true") throw new InvalidOperationException("Settings did not persist after reload.");
        foreach (string subdivision in new[] { "0.5", "0.25", "bars-2", "bars-4", "bars-8" })
        {
            string value = JsonSerializer.Serialize(subdivision);
            await browser.CoreWebView2.ExecuteScriptAsync($"document.getElementById('subdivision').value = {value}; document.getElementById('subdivision').dispatchEvent(new Event('change'));");
            await Navigate(() => browser.CoreWebView2.Reload());
            string restored = await browser.CoreWebView2.ExecuteScriptAsync($"document.getElementById('subdivision').value === {value}");
            if (restored != "true") throw new InvalidOperationException("Rhythm did not persist after reload: " + subdivision);
        }
        using var image = File.Create(Path.ChangeExtension(reportPath!, ".png"));
        await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
        WriteReport(new { success = true, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
            runtime = environment!.BrowserVersionString, persistenceAfterReload = true, sparseRhythmPersistenceAfterReload = true, tests = result });
        Close();
    }

    private void WriteReport(object result)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(reportPath!)!);
        File.WriteAllText(reportPath!, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) browser.Dispose();
        base.Dispose(disposing);
    }
}
