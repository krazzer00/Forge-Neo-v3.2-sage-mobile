:: by OreX
:: Homepage: https://stabledif.ru
:: Telegram: https://t.me/stable_dif

@echo off

cls
setlocal enabledelayedexpansion
chcp 65001>nul
color 0F
cd /d "%~dp0"

:: triton-windows 3.6.x соответствует torch 2.10
echo УСТАНОВКА TRITON...
..\system\python\python.exe -m pip install -U "triton-windows<3.7"

:: Устанавливается первый найденный whl из папки whl (cp313 / cu130 / torch 2.10)
echo УСТАНОВКА SAGEATTENTION...
set "SAGE_WHL="
for %%f in ("whl\sageattention-*.whl") do if not defined SAGE_WHL set "SAGE_WHL=%%f"
if not defined SAGE_WHL (
    echo [ERROR] В папке Additions\whl нет файла sageattention-*.whl
    pause
    exit /b 1
)
..\system\python\python.exe -m pip install "!SAGE_WHL!"

echo.
echo ===============================
echo ПРОВЕРКА ВЕРСИЙ TRITON AND SAGE:
echo ===============================

echo ВЕРСИЯ PYTHON:
..\system\python\python.exe -V

echo.
echo ВЕРСИЯ TRITON:
..\system\python\python.exe -c "import triton; print(triton.__version__)"

echo.
echo ВЕРСИЯ SageAttention:
..\system\python\python.exe -m pip show sageattention

echo.
echo stabledif.ru
echo by OreX
pause
