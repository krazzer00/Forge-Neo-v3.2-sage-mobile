@echo off
title Forge Neo (Sage)

:: Allow batch files to be found in the current directory even when the parent
:: shell disables it (git bash / some IDE terminals set this variable).
set "NoDefaultCurrentDirectoryInExePath="
cd /d "%~dp0"

call "%~dp0environment.bat"

:: ---------------------------------------------------------------------------
::  Mobile UI - mobile web interface at http://<host-ip>:9595
::  Starts minimized in its own window and waits until Forge is up.
:: ---------------------------------------------------------------------------
start "Forge MobileUI" /min "%DIR%\python\python.exe" "%~dp0MobileUI\server.py" --host 0.0.0.0 --port 9595 --forge http://127.0.0.1:7860

cd /d "%~dp0webui"
call webui-user-sage.bat

:: Forge has exited - shut down the mobile server as well
taskkill /F /FI "WINDOWTITLE eq Forge MobileUI*" >nul 2>&1
