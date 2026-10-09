@echo off
cd /d "%~dp0"
title AnyPort Studio - PS5 Native Relinker
echo ========================================================
echo   Starting AnyPort Studio Engine...
echo ========================================================
start "" http://127.0.0.1:4567
node server.js
pause
