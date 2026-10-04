@echo off
rem Starts the freshly built Jarvis exe the way the e2e scripts expect (test data dir, debugging port, assistant
rem process run from this checkout, voice captures kept for diagnostics). Double-click it, or run it from a terminal.
set "ROOT=%~dp0..\.."
set "JARVIS_DATA_DIR=%USERPROFILE%\jarvis-e2e-data"
set "JARVIS_SIDECAR_REPO=%ROOT%"
set "JARVIS_DUMP_CAPTURES=%JARVIS_DATA_DIR%\captures"
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222"
set "WEBVIEW2_USER_DATA_FOLDER=%JARVIS_DATA_DIR%\webview2"
start "" "%ROOT%\dist-windows\jarvis-desktop.exe"
