:: by OreX
:: Homepage: https://stabledif.ru
:: Telegram: https://t.me/stable_dif

@echo off
cd /d "%~dp0"
chcp 65001 >nul
color 0a
echo.
..\system\python\python.exe "add\check_gpu.py"
echo.
echo Отчет готов!
echo.
echo stabledif.ru
echo by OreX
pause