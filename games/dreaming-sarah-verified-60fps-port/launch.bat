@echo off
cd /d "%~dp0"
echo ===========================================
echo   Launching Dreaming Sarah via AnyPS5 Native Runtime
echo ===========================================
set PATH=%~dp0libs;%~dp0..\..\bin;%PATH%
start "" "%~dp0app.exe"
exit
