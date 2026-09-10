# Устанавливает портативное окружение (папку system) из GitHub Releases.
# Запускается из install.bat. Архив system.7z разбит на части до 2 ГБ.

param(
    [string]$Tag = "system-v1",
    [switch]$KeepArchives
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = "krazzer00/Forge-Neo-v3.2-sage-mobile"
$Root = Split-Path -Parent $PSScriptRoot
$SevenZip = Join-Path $Root "Additions\add\7zr.exe"
$DownloadDir = Join-Path $Root "_download"
$Python = Join-Path $Root "system\python\python.exe"

if (Test-Path $Python) {
    Write-Host "Папка system уже установлена, пропускаю."
    exit 0
}

function Get-GitHubToken {
    if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN }
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $t = & gh auth token 2>$null
        if ($LASTEXITCODE -eq 0 -and $t) { return "$t".Trim() }
    }
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $out = "protocol=https`nhost=github.com`n`n" | & git credential fill 2>$null
        $line = $out | Where-Object { $_ -like "password=*" } | Select-Object -First 1
        if ($line) { return $line.Substring(9) }
    }
    $secure = Read-Host "Репозиторий приватный. Введите GitHub-токен с правом repo" -AsSecureString
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}

$token = Get-GitHubToken
$headers = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github+json"
    "User-Agent" = "forge-neo-installer"
}

Write-Host "Получаю список файлов релиза $Tag..."
$release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers $headers
$assets = @($release.assets | Where-Object { $_.name -like "system.7z.*" } | Sort-Object name)
if ($assets.Count -eq 0) { throw "В релизе $Tag нет файлов system.7z.*" }

New-Item -ItemType Directory -Force $DownloadDir | Out-Null
foreach ($a in $assets) {
    $dest = Join-Path $DownloadDir $a.name
    if ((Test-Path $dest) -and (Get-Item $dest).Length -eq $a.size) {
        Write-Host "$($a.name) уже скачан."
    } else {
        Write-Host ("Скачиваю {0} ({1:N0} МБ)..." -f $a.name, ($a.size / 1MB))
        # curl не передаёт Authorization на другой хост при редиректе
        & curl.exe -L --fail --retry 5 --retry-delay 5 -C - `
            -H "Authorization: Bearer $token" `
            -H "Accept: application/octet-stream" `
            -H "User-Agent: forge-neo-installer" `
            -o $dest $a.url
        if ($LASTEXITCODE -ne 0) { throw "Не удалось скачать $($a.name) (curl, код $LASTEXITCODE)" }
        if ((Get-Item $dest).Length -ne $a.size) { throw "Размер $($a.name) не совпадает с релизом" }
    }
    if ($a.digest -like "sha256:*") {
        $hash = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLower()
        if ("sha256:$hash" -ne $a.digest) {
            Remove-Item $dest
            throw "SHA256 $($a.name) не совпал — файл удалён, запустите установку ещё раз"
        }
    }
}

Write-Host "Распаковываю system..."
& $SevenZip x (Join-Path $DownloadDir $assets[0].name) "-o$Root" -y -bso0 -bsp1
if ($LASTEXITCODE -ne 0) { throw "7zr завершился с кодом $LASTEXITCODE" }
if (-not (Test-Path $Python)) { throw "После распаковки не найден $Python" }

if (-not $KeepArchives) { Remove-Item -Recurse -Force $DownloadDir }
Write-Host "Папка system установлена."
