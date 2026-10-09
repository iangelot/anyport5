using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace AnyPortStudio
{
    public class MainForm : Form
    {
        private const int Port = 4567;
        private const string AppUrl = "http://127.0.0.1:4567";
        private const string PingUrl = "http://127.0.0.1:4567/api/ping";

        private WebView2 webView;
        private Process nodeProcess;
        private Panel splashPanel;
        private Label titleLabel;
        private Label subTitleLabel;
        private Label statusLabel;
        private ProgressBar progressBar;

        [DllImport("dwmapi.dll", PreserveSig = true)]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        public MainForm()
        {
            this.Text = "AnyPort Studio — 1-Click PlayStation 5 PC Porting Engine";
            this.Size = new Size(1420, 890);
            this.MinimumSize = new Size(1024, 700);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(6, 8, 14); // Cyber Black #06080e
            this.ForeColor = Color.White;

            // Apply App Icon if available
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app.ico");
            if (File.Exists(iconPath))
            {
                try
                {
                    this.Icon = new Icon(iconPath);
                }
                catch { }
            }

            // Build Sleek Native Cyber Splash
            InitializeSplashUI();

            // Setup Embedded WebView2 control
            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.Visible = false;
            this.Controls.Add(webView);

            this.Load += MainForm_Load;
            this.FormClosing += MainForm_FormClosing;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            TryEnableImmersiveDarkMode(this.Handle);
        }

        private static void TryEnableImmersiveDarkMode(IntPtr handle)
        {
            try
            {
                int darkMode = 1;
                // DWMWA_USE_IMMERSIVE_DARK_MODE (20 on Windows 11 / Windows 10 20H1+, 19 on older 10)
                int res = DwmSetWindowAttribute(handle, 20, ref darkMode, sizeof(int));
                if (res != 0)
                {
                    DwmSetWindowAttribute(handle, 19, ref darkMode, sizeof(int));
                }
            }
            catch { }
        }

        private void InitializeSplashUI()
        {
            splashPanel = new Panel();
            splashPanel.Dock = DockStyle.Fill;
            splashPanel.BackColor = Color.FromArgb(6, 8, 14);

            titleLabel = new Label();
            titleLabel.Text = "ANYPORT 5";
            titleLabel.Font = new Font("Segoe UI", 36, FontStyle.Bold);
            titleLabel.ForeColor = Color.FromArgb(191, 255, 0); // Electric Lime #BFFF00
            titleLabel.AutoSize = false;
            titleLabel.Size = new Size(800, 75);
            titleLabel.TextAlign = ContentAlignment.MiddleCenter;

            subTitleLabel = new Label();
            subTitleLabel.Text = "1-CLICK PLAYSTATION 5 NATIVE PORTER & RUNTIME";
            subTitleLabel.Font = new Font("Segoe UI", 12, FontStyle.Bold);
            subTitleLabel.ForeColor = Color.FromArgb(167, 139, 250); // Neon Violet #A78BFA
            subTitleLabel.AutoSize = false;
            subTitleLabel.Size = new Size(800, 30);
            subTitleLabel.TextAlign = ContentAlignment.MiddleCenter;

            statusLabel = new Label();
            statusLabel.Text = "INITIALIZING ANYPS5 CORE ENGINE...";
            statusLabel.Font = new Font("Segoe UI", 10, FontStyle.Regular);
            statusLabel.ForeColor = Color.FromArgb(148, 163, 184); // Slate 400
            statusLabel.AutoSize = false;
            statusLabel.Size = new Size(800, 30);
            statusLabel.TextAlign = ContentAlignment.MiddleCenter;

            progressBar = new ProgressBar();
            progressBar.Style = ProgressBarStyle.Marquee;
            progressBar.MarqueeAnimationSpeed = 25;
            progressBar.Size = new Size(360, 6);

            splashPanel.Controls.Add(titleLabel);
            splashPanel.Controls.Add(subTitleLabel);
            splashPanel.Controls.Add(statusLabel);
            splashPanel.Controls.Add(progressBar);

            splashPanel.Resize += (s, e) => CenterSplashElements();
            this.Controls.Add(splashPanel);
            CenterSplashElements();
        }

        private void CenterSplashElements()
        {
            int cx = splashPanel.ClientSize.Width / 2;
            int cy = splashPanel.ClientSize.Height / 2;

            titleLabel.Location = new Point(cx - titleLabel.Width / 2, cy - 100);
            subTitleLabel.Location = new Point(cx - subTitleLabel.Width / 2, cy - 25);
            statusLabel.Location = new Point(cx - statusLabel.Width / 2, cy + 25);
            progressBar.Location = new Point(cx - progressBar.Width / 2, cy + 65);
        }

        private async void MainForm_Load(object sender, EventArgs e)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);

            // 1. Check if backend is already alive
            bool backendReady = await CheckServerReadyAsync();
            if (!backendReady)
            {
                UpdateSplashStatus("STARTING ANYPORT LOCAL ENGINE...");
                bool started = StartNodeBackend(baseDir);
                if (!started)
                {
                    return;
                }

                // Wait up to 10 seconds for backend to respond to /api/ping
                int attempts = 50;
                while (attempts-- > 0 && !backendReady)
                {
                    await Task.Delay(200);
                    backendReady = await CheckServerReadyAsync();
                }

                if (!backendReady)
                {
                    MessageBox.Show(
                        "The AnyPort Studio backend engine failed to respond on 127.0.0.1:4567.\n\nPlease verify that node.js is working and no other app is blocking port 4567.",
                        "AnyPort Studio Engine Warning",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                    return;
                }
            }

            // 2. Initialize Native WebView2
            UpdateSplashStatus("LOADING NATIVE GAMING INTERFACE...");
            try
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string userDataFolder = Path.Combine(localAppData, "AnyPortStudio", "WebView2Data");

                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(env);

                // Configure WebView2 settings
                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                webView.CoreWebView2.Settings.AreDevToolsEnabled = true;

                // Handle external links (open in user's default browser)
                webView.CoreWebView2.NewWindowRequested += (s, args) =>
                {
                    args.Handled = true;
                    try
                    {
                        Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
                    }
                    catch { }
                };

                // Navigate to local native engine
                webView.NavigationCompleted += (s, args) =>
                {
                    if (args.IsSuccess)
                    {
                        webView.Visible = true;
                        webView.BringToFront();
                        splashPanel.Visible = false;
                    }
                };

                webView.CoreWebView2.Navigate(AppUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "WebView2 runtime initialization error: " + ex.Message + "\n\nPlease ensure Microsoft Edge WebView2 runtime is installed.",
                    "AnyPort Studio Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private void UpdateSplashStatus(string text)
        {
            if (statusLabel.InvokeRequired)
            {
                statusLabel.Invoke(new Action<string>(UpdateSplashStatus), text);
            }
            else
            {
                statusLabel.Text = text;
            }
        }

        private bool StartNodeBackend(string baseDir)
        {
            string serverScript = Path.Combine(baseDir, "server.js");
            if (!File.Exists(serverScript))
            {
                MessageBox.Show("Could not find server.js in: " + baseDir, "AnyPort Studio Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }

            string nodeExe = ResolveNodeExecutable(baseDir);
            if (string.IsNullOrEmpty(nodeExe))
            {
                MessageBox.Show(
                    "Node.js runtime was not found.\n\nPlease install Node.js from https://nodejs.org or place node.exe in the AnyPort Studio folder.",
                    "AnyPort Studio Required Runtime",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                return false;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = baseDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                nodeProcess = Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to start native backend process: " + ex.Message, "AnyPort Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return false;
            }
        }

        private static string ResolveNodeExecutable(string baseDir)
        {
            // 1. Bundled next to application
            string localNode = Path.Combine(baseDir, "node.exe");
            if (File.Exists(localNode)) return localNode;

            // 2. Standard Program Files installations
            string pfNode = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"nodejs\node.exe");
            if (File.Exists(pfNode)) return pfNode;

            string pf86Node = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"nodejs\node.exe");
            if (File.Exists(pf86Node)) return pf86Node;

            // 3. User local AppData
            string localAppDataNode = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe");
            if (File.Exists(localAppDataNode)) return localAppDataNode;

            // 4. Test PATH
            try
            {
                Process p = Process.Start(new ProcessStartInfo
                {
                    FileName = "node.exe",
                    Arguments = "-v",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                });
                if (p != null)
                {
                    p.WaitForExit(1000);
                    return "node.exe";
                }
            }
            catch { }

            return null;
        }

        private static async Task<bool> CheckServerReadyAsync()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(PingUrl);
                req.Timeout = 1000;
                req.Method = "GET";

                using (HttpWebResponse resp = (HttpWebResponse)await req.GetResponseAsync())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            try
            {
                if (nodeProcess != null && !nodeProcess.HasExited)
                {
                    nodeProcess.Kill();
                }
            }
            catch { }
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}
