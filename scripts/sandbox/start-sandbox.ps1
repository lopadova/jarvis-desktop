<#
.SYNOPSIS
  Runs a Windows build of Jarvis inside Windows Sandbox (a disposable, clean Windows) and collects
  self-test output, logs and screenshots into <repo>\dist-sandbox\.
.DESCRIPTION
  Useful when the host blocks unsigned freshly built binaries (Smart App Control) or to test a clean install.
  Build first: node scripts/windows-xbuild/build-windows.mjs
  Requires the "Windows Sandbox" optional feature (Windows 11 Pro/Enterprise).
#>
param(
  [int]$MemoryMB = 4096,
  [int]$Seconds = 45
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$app = Join-Path $repo 'dist-windows'
$out = Join-Path $repo 'dist-sandbox'
if (-not (Test-Path (Join-Path $app 'jarvis-desktop.exe'))) { throw "Build first: node scripts/windows-xbuild/build-windows.mjs ($app\jarvis-desktop.exe missing)" }
New-Item -ItemType Directory -Force -Path $out | Out-Null
Get-ChildItem $out -File -ErrorAction SilentlyContinue | Remove-Item -Force

$wsb = @"
<Configuration>
  <MemoryInMB>$MemoryMB</MemoryInMB>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>$app</HostFolder><SandboxFolder>C:\Jarvis</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$PSScriptRoot</HostFolder><SandboxFolder>C:\JarvisScripts</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$out</HostFolder><SandboxFolder>C:\JarvisOut</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\JarvisScripts\inside-sandbox.ps1 -Seconds $Seconds</Command>
  </LogonCommand>
</Configuration>
"@
$wsbPath = Join-Path $env:TEMP 'jarvis-sandbox.wsb'
Set-Content -Path $wsbPath -Value $wsb -Encoding UTF8
Write-Host "Starting Windows Sandbox… results will appear in $out"
Start-Process -FilePath $wsbPath
