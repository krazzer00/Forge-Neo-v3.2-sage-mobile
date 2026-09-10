@echo off
title Forge MobileUI
cd /d %~dp0..
call environment.bat
"%DIR%\python\python.exe" "%~dp0server.py" --host 0.0.0.0 --port 9595 --forge http://127.0.0.1:7860
pause
