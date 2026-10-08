@echo off
title AnyPort Studio - Native Desktop App
cd /d "%~dp0"

echo ========================================================
echo   Launching AnyPort Studio (Native Desktop Software)
echo ========================================================

:: Check if server is already running on port 4567
netstat -ano | findstr :4567 >nul
if %errorlevel% neq 0 (
    start /min "AnyPortBackend" node server.js
    timeout /t 1 /nobreak >nul
)

:: Launch standalone native desktop window (no browser tabs, no URL bar)
start "" msedge.exe --app="http://localhost:4567" --window-size=1360,880 --app-id=AnyPortStudio
exit
