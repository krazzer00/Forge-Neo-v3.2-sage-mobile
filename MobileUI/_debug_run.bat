@echo off
set "NoDefaultCurrentDirectoryInExePath="
set PYTHONUNBUFFERED=1
cd /d "%~dp0.."
call "%~dp0..\environment.bat"
cd /d "%~dp0..\webui"
call webui-user-sage.bat > "%~dp0forge.log" 2>&1
