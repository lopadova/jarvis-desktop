# Runs INSIDE Windows Sandbox (LogonCommand). Installs the WebView2 Runtime (a clean Windows image may not have
# it), copies Jarvis to a writable place, runs the self-test, starts the app, takes screenshots and writes
# everything to C:\JarvisOut (mapped to <repo>\dist-sandbox).
param([int]$Seconds = 45)
$ErrorActionPreference = 'Continue'
$out = 'C:\JarvisOut'
Start-Transcript -Path "$out\sandbox-transcript.txt" -Force | Out-Null

# WebView2 Evergreen bootstrapper (Microsoft's official link). Normal Windows 11 installs already have the runtime.
# A clean Windows can have the registry key with version 0.0.0.0 (placeholder): only a real version counts.
$wvKey = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$wvVersion = @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
               "HKCU:\$wvKey", "HKLM:\$wvKey") |
  ForEach-Object { (Get-ItemProperty $_ -ErrorAction SilentlyContinue).pv } |
  Where-Object { $_ -and $_ -ne '0.0.0.0' } | Select-Object -First 1
"WebView2 registry version: $(if ($wvVersion) { $wvVersion } else { 'none' })" | Add-Content "$out\self-test.txt"
# The registry alone is not trustworthy inside Sandbox (it can claim a runtime that is not usable by this account):
# require the real msedgewebview2.exe on disk.
$wvExe = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application", "$env:ProgramFiles\Microsoft\EdgeWebView\Application" -Filter msedgewebview2.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
"WebView2 runtime on disk: $(if ($wvExe) { $wvExe.FullName } else { 'none' })" | Add-Content "$out\self-test.txt"
if (-not $wvExe) {
  "WebView2 not installed, installing…" | Add-Content "$out\self-test.txt"
  try {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile 'C:\wv2-setup.exe'
    Start-Process 'C:\wv2-setup.exe' -ArgumentList '/silent', '/install' -Wait
    $wvExe = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application", "$env:ProgramFiles\Microsoft\EdgeWebView\Application" -Filter msedgewebview2.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    "WebView2 install finished; on disk now: $(if ($wvExe) { $wvExe.FullName } else { 'STILL MISSING' })" | Add-Content "$out\self-test.txt"
  } catch { "WebView2 install failed: $_" | Add-Content "$out\self-test.txt" }
}

# The Sandbox base image can carry a registry version that differs from the runtime folder on disk, which makes
# the WebView2 loader report "runtime not found". Point it at the folder explicitly (official override variable).
if ($wvExe) {
  $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = Split-Path $wvExe.FullName -Parent
  "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER=$env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER" | Add-Content "$out\self-test.txt"
}

Copy-Item C:\Jarvis -Destination C:\JarvisApp -Recurse -Force
$exe = 'C:\JarvisApp\jarvis-desktop.exe'

# The exe is a GUI-subsystem program (no console): redirect its stdout through Start-Process and wait.
$st = Start-Process -FilePath $exe -ArgumentList '--self-test' -Wait -PassThru -RedirectStandardOutput "$out\self-test-stdout.txt" -RedirectStandardError "$out\self-test-stderr.txt"
"self-test exit code: $($st.ExitCode)" | Add-Content "$out\self-test.txt"

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Shot([string]$name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save("$out\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8;  Shot 'sandbox-01-start'
Start-Sleep -Seconds 12; Shot 'sandbox-02-running'
Start-Sleep -Seconds ([Math]::Max(1, $Seconds - 20)); Shot 'sandbox-03-later'
# ── Walkthrough: click through the onboarding and capture ONLY the app window (never the whole screen) ──
Add-Type @'
using System; using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
'@
[void][Win32]::SetProcessDPIAware()
function AppRect {
  $p.Refresh()
  $h = $p.MainWindowHandle
  if ($h -eq [IntPtr]::Zero) { return $null }
  $r = New-Object Win32+RECT
  [void][Win32]::GetWindowRect($h, [ref]$r)
  return @{ H = $h; R = $r }
}
function ShotApp([string]$name) {
  $w = AppRect
  if (-not $w) { "no window for $name" | Add-Content "$out\self-test.txt"; return }
  $r = $w.R; $pad = 16
  $x = [Math]::Max(0, $r.L - $pad); $y = [Math]::Max(0, $r.T - $pad)
  $width = ($r.R - $r.L) + 2 * $pad; $height = ($r.B - $r.T) + 2 * $pad
  $bmp = New-Object System.Drawing.Bitmap $width, $height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $width, $height))
  $bmp.Save("$out\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
function ClickRel([double]$fx, [double]$fy) {
  $w = AppRect
  if (-not $w) { return }
  [void][Win32]::SetForegroundWindow($w.H)
  $r = $w.R
  $x = [int]($r.L + ($r.R - $r.L) * $fx); $y = [int]($r.T + ($r.B - $r.T) * $fy)
  [void][Win32]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 300
  [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80
  [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
ShotApp 'real-onboarding-1'
for ($i = 2; $i -le 6; $i++) {
  ClickRel 0.867 0.934            # the primary "Next" / "Get started" / "Finish" button (bottom right)
  Start-Sleep -Seconds 3
  ShotApp "real-onboarding-$i"
}
Start-Sleep -Seconds 4
ShotApp 'real-after-onboarding'

"app still running: $(-not $p.HasExited)" | Add-Content "$out\self-test.txt"
Get-Process | Where-Object { $_.Name -match 'jarvis|agent-host' } | Select-Object Name, Id | Out-String | Add-Content "$out\self-test.txt"
Get-ChildItem "$env:APPDATA\dev.lopadova.jarvis", "$env:APPDATA\Jarvis" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 2MB } | Copy-Item -Destination $out -Force
Stop-Transcript | Out-Null
'done' | Set-Content "$out\DONE.txt"
