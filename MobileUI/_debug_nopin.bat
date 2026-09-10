@echo off
set "NoDefaultCurrentDirectoryInExePath="
set PYTHONUNBUFFERED=1
call "%~dp0..\environment.bat"
cd /d "%~dp0..\webui"
set COMMANDLINE_ARGS=--sage --cuda-malloc --cuda-stream --listen --enable-insecure-extension-access --api --skip-version-check --lock-oo-submodule
call webui.bat > "%~dp0forge-nopin.log" 2>&1
