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
"app still running: $(-not $p.HasExited)" | Add-Content "$out\self-test.txt"
Get-Process | Where-Object { $_.Name -match 'jarvis|agent-host' } | Select-Object Name, Id | Out-String | Add-Content "$out\self-test.txt"
Get-ChildItem "$env:APPDATA\dev.lopadova.jarvis", "$env:APPDATA\Jarvis" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -lt 2MB } | Copy-Item -Destination $out -Force
Stop-Transcript | Out-Null
'done' | Set-Content "$out\DONE.txt"
