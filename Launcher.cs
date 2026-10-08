using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace AnyPortStudioLauncher
{
    static class Program
    {
        private const int Port = 4567;
        private const string AppUrl = "http://localhost:4567";

        [STAThread]
        static void Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);

            Process nodeProcess = null;

            try
            {
                // 1. Check if server is already running on port 4567
                if (!IsPortOpen("127.0.0.1", Port))
                {
                    string serverScript = Path.Combine(baseDir, "server.js");
                    if (!File.Exists(serverScript))
                    {
                        MessageBox.Show("Could not find server.js in: " + baseDir, "AnyPort Studio Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }

                    ProcessStartInfo nodePsi = new ProcessStartInfo
                    {
                        FileName = "node.exe",
                        Arguments = "\"" + serverScript + "\"",
                        WorkingDirectory = baseDir,
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };

                    try
                    {
                        nodeProcess = Process.Start(nodePsi);
                    }
                    catch (Exception ex)
                    {
                        // Try finding node in PATH
                        try
                        {
                            nodePsi.FileName = "node";
                            nodeProcess = Process.Start(nodePsi);
                        }
                        catch
                        {
                            MessageBox.Show("Node.js runtime was not found. Please install Node.js from https://nodejs.org or bundle node.exe in the application folder.\n\nDetails: " + ex.Message, "AnyPort Studio", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                            return;
                        }
                    }

                    // Wait up to 5 seconds for server to start
                    int retries = 50;
                    while (retries-- > 0 && !IsPortOpen("127.0.0.1", Port))
                    {
                        Thread.Sleep(100);
                    }
                }

                // 2. Launch in standalone Native App mode (Edge / Chrome / Default)
                Process browserProcess = LaunchAppWindow(AppUrl);

                if (browserProcess != null && nodeProcess != null)
                {
                    // Keep launcher alive waiting for the window to close, then clean up node
                    browserProcess.WaitForExit();
                    try
                    {
                        if (!nodeProcess.HasExited)
                        {
                            nodeProcess.Kill();
                        }
                    }
                    catch { }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("An unexpected error occurred: " + ex.Message, "AnyPort Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static bool IsPortOpen(string host, int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(300);
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private static Process LaunchAppWindow(string url)
        {
            string[] candidateBrowsers = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (string browser in candidateBrowsers)
            {
                if (File.Exists(browser))
                {
                    try
                    {
                        ProcessStartInfo psi = new ProcessStartInfo
                        {
                            FileName = browser,
                            Arguments = string.Format("--app=\"{0}\" --window-size=1420,920", url),
                            UseShellExecute = false
                        };
                        return Process.Start(psi);
                    }
                    catch { }
                }
            }

            // Fallback to default browser
            try
            {
                return Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch
            {
                return null;
            }
        }
    }
}
