# Runs INSIDE Windows Sandbox (LogonCommand). Copies Jarvis to a writable place, runs the self-test,
# starts the app, takes screenshots and writes everything to C:\JarvisOut (mapped to <repo>\dist-sandbox).
param([int]$Seconds = 45)
$ErrorActionPreference = 'Continue'
$out = 'C:\JarvisOut'
Start-Transcript -Path "$out\sandbox-transcript.txt" -Force | Out-Null
Copy-Item C:\Jarvis -Destination C:\JarvisApp -Recurse -Force
$exe = 'C:\JarvisApp\jarvis-desktop.exe'

& $exe --self-test *> "$out\self-test.txt"
"self-test exit code: $LASTEXITCODE" | Add-Content "$out\self-test.txt"

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
Get-ChildItem "$env:APPDATA\Jarvis\logs" -Recurse -File -ErrorAction SilentlyContinue | Copy-Item -Destination $out -Force
Stop-Transcript | Out-Null
'done' | Set-Content "$out\DONE.txt"
