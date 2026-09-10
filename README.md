# Forge Neo v3.2 — Sage + MobileUI

Портативная сборка [Stable Diffusion WebUI Forge Neo](https://github.com/Haoming02/sd-webui-forge-classic/tree/neo)
для Windows: SageAttention, 30 расширений, настроенный интерфейс и мобильный веб-интерфейс **MobileUI**.
После установки сборка работает в том же виде, в каком лежит у автора.

## Установка

1. Склонируйте репозиторий (он приватный — нужен доступ к нему):
   ```bat
   git clone https://github.com/krazzer00/Forge-Neo-v3.2-sage-mobile.git
   ```
2. Запустите **`install.bat`**. Он:
   - скачивает из [Releases](https://github.com/krazzer00/Forge-Neo-v3.2-sage-mobile/releases) архив
     портативного окружения `system` (Python 3.13 + torch, git, ffmpeg — 3,8 ГБ, распаковывается в ~7,3 ГБ);
   - скачивает модели (~83 ГБ) по манифесту `setup/models.json` с проверкой SHA256.
3. Запустите **`RUN-Sage.bat`**. Forge откроется на `http://127.0.0.1:7860`,
   MobileUI — на `http://<ip-компьютера>:9595`.

Доступ к приватному репозиторию `install.bat` берёт сам: из переменной `GITHUB_TOKEN`,
`gh auth token` или менеджера учётных данных git. Если ничего нет, спросит токен.

### Ключ Civitai

13 моделей (57 ГБ: ControlNet Illustrious/NoobAI, `flux-2-klein-9b-fp8`, `moodyDesireMix_v30`,
VAE `illustriousXLV20_v10`) есть только на Civitai, а он отдаёт файлы только после входа.
Скрипт спросит API-ключ при первой такой модели и сохранит его в `civitai_token.txt`
в корне сборки, чтобы больше не спрашивать. Этот файл есть в `.gitignore` и в репозиторий не попадает.
Ключ создаётся на [civitai.com/user/account](https://civitai.com/user/account) (раздел API Keys).
Вместо этого можно создать `civitai_token.txt` вручную или задать `set CIVITAI_TOKEN=ключ`.

## Скрипты

| Файл | Что делает |
|------|------------|
| `install.bat` | Первая установка: `system` из Releases + модели |
| `download-models.bat` | Докачать недостающие модели. Ключи: `--list` — показать, чего не хватает; `--verify` — проверить SHA256 скачанного; `--only ТЕКСТ` — только модели с ТЕКСТ в пути |
| `update.bat` | `git pull` всей сборки и докачка новых моделей |
| `RUN-Sage.bat` | Forge с `--sage` + MobileUI |
| `RUN.bat`, `RUN-reserve-vram2gb.bat` | Другие варианты запуска |
| `update-requirements.bat` | `pip install -r webui/requirements.txt` |
| `Additions/Install_Triton_&_Sage.bat` | Установка Triton и SageAttention (см. `Additions/For Triton Install/Инструкция.txt`) |

## Где что лежит

| Что | Где хранится |
|-----|--------------|
| Forge (`webui/`), расширения, настройки, стили, MobileUI, лаунчеры | в git |
| `system/` — Python, torch, git, ffmpeg, кэш HuggingFace | архив `system.7z.001–003` в релизе `system-v1` |
| Модели и веса расширений | скачиваются по `setup/models.json` с HuggingFace, GitHub, Google Storage и Civitai |
| `webui/models/LDSR/model.ckpt` | в релизе `system-v1` (публичного источника у этого файла нет) |
| `webui/models/dreambooth/` | не входит в репозиторий |

Пути всех скачиваемых моделей перечислены в `.gitignore`, поэтому каждый файл сборки
либо лежит в git, либо скачивается — третьего не бывает.

## Как добавить модель

1. Положите файл в `webui/models/...` и посчитайте хеш:
   `system\python\python.exe -c "import hashlib,sys;print(hashlib.file_digest(open(sys.argv[1],'rb'),'sha256').hexdigest())" ПУТЬ`
2. Добавьте в `setup/models.json` запись с `path`, `size` (в байтах), `sha256` и `urls`.
3. Добавьте путь в конец `.gitignore` и закоммитьте.

## Как обновить `system`

1. Упакуйте папку тома по 1900 МБ: `7z a -t7z -mx5 -v1900m system.7z system`.
2. Создайте новый релиз (например, `system-v2`) и загрузите в него `system.7z.*` и `LDSR-model.ckpt`.
3. Поменяйте `$Tag` в `setup/install.ps1` и тег в `setup/models.json`.

## Безопасность

`RUN-Sage.bat` запускает Forge с `--listen --api --enable-insecure-extension-access`,
а MobileUI слушает `0.0.0.0:9595` без авторизации. Любой, у кого есть сетевой доступ
к компьютеру, может генерировать, удалять изображения и ставить расширения.
Используйте сборку только в доверенной локальной сети и не пробрасывайте эти порты в интернет.

## Проверенная конфигурация

Windows 10, RTX 3090 Ti 24 ГБ, 128 ГБ RAM; Python 3.13.12, torch 2.10.0+cu130,
triton-windows 3.6.0, SageAttention 2.2.0 (cu130).

## Благодарности и лицензии

- Forge Neo — [Haoming02/sd-webui-forge-classic](https://github.com/Haoming02/sd-webui-forge-classic), AGPL-3.0.
- Расширения — у каждого своя лицензия, см. `webui/extensions/*/LICENSE`.
- Исходная портативная сборка и скрипты в `Additions` — OreX ([stabledif.ru](https://stabledif.ru)).
- [SageAttention](https://github.com/thu-ml/SageAttention), [triton-windows](https://github.com/woct0rdho/triton-windows).
- Модели принадлежат их авторам; ссылки на страницы моделей — в `setup/models.json`.
