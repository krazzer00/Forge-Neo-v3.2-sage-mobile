"""Скачивает модели Forge Neo по манифесту setup/models.json.

Запуск: download-models.bat [--verify] [--only ТЕКСТ] [--list]

  --verify  проверить SHA256 уже скачанных файлов (долго)
  --only    скачать только модели, в пути которых есть ТЕКСТ
  --list    показать, каких моделей не хватает, и выйти

Некоторые модели Civitai и HuggingFace отдаются только после входа.
Скрипт спросит ключ Civitai и сохранит его в civitai_token.txt (файл не попадает в git).
Токены можно задать и переменными окружения CIVITAI_TOKEN и HF_TOKEN.
"""

import argparse
import getpass
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "setup", "models.json")
DOWNLOAD_DIR = os.path.join(ROOT, "_download")
CIVITAI_TOKEN_FILE = os.path.join(ROOT, "civitai_token.txt")
CHUNK = 4 << 20
USER_AGENT = "Forge-Neo-portable"
GITHUB_REPO = "krazzer00/Forge-Neo-v3.2-sage-mobile"

_github_token = None
_release_assets = {}
_declined_tokens = set()

TOKEN_PROMPTS = {
    "civitai.com": ("CIVITAI_TOKEN", "API-ключ Civitai (civitai.com/user/account)"),
    "huggingface.co": ("HF_TOKEN", "токен HuggingFace (huggingface.co/settings/tokens)"),
}


def human(n):
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if n < 1024 or unit == "ГБ":
            return f"{n:.1f} {unit}"
        n /= 1024


def sha256_of(path, h=None):
    h = h or hashlib.sha256()
    with open(path, "rb") as f:
        for buf in iter(lambda: f.read(CHUNK), b""):
            h.update(buf)
    return h


def is_present(path, size, sha256, verify):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full) or os.path.getsize(full) != size:
        return False
    if not verify:
        return True
    print(f"Проверка {path}")
    if sha256_of(full).hexdigest() == sha256:
        return True
    print("  хеш не совпал — файл будет скачан заново")
    return False


def github_token():
    """Токен для приватного репозитория: GITHUB_TOKEN, gh или менеджер учётных данных git."""
    global _github_token
    if _github_token:
        return _github_token
    token = os.environ.get("GITHUB_TOKEN")
    if not token and shutil.which("gh"):
        r = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True)
        token = r.stdout.strip() if r.returncode == 0 else None
    if not token and shutil.which("git"):
        r = subprocess.run(["git", "credential", "fill"], input="protocol=https\nhost=github.com\n\n",
                           capture_output=True, text=True)
        token = next((ln[9:] for ln in r.stdout.splitlines() if ln.startswith("password=")), None)
    if not token:
        try:
            token = getpass.getpass("Введите GitHub-токен с правом repo: ").strip()
        except EOFError:  # нет консоли для ввода
            token = ""
    if not token:
        raise RuntimeError("нет GitHub-токена для скачивания из релиза")
    _github_token = token
    return token


def resolve_release_url(url):
    """github-release:ТЕГ/ИМЯ -> API-адрес файла релиза."""
    tag, name = url[len("github-release:"):].split("/", 1)
    if tag not in _release_assets:
        req = urllib.request.Request(f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{tag}",
                                     headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})
        req.add_unredirected_header("Authorization", "Bearer " + github_token())
        with urllib.request.urlopen(req, timeout=60) as resp:
            _release_assets[tag] = {a["name"]: a["url"] for a in json.load(resp)["assets"]}
    if name not in _release_assets[tag]:
        raise RuntimeError(f"в релизе {tag} нет файла {name}")
    return _release_assets[tag][name]


def ask_token(url):
    """После 401/403 один раз спрашивает токен сайта. True — токен получен, можно повторить."""
    host = urllib.parse.urlsplit(url).hostname or ""
    for suffix, (env, label) in TOKEN_PROMPTS.items():
        if host.endswith(suffix):
            if os.environ.get(env) or env in _declined_tokens:
                return False
            try:
                token = getpass.getpass(f"  Модель требует входа. Введите {label}, Enter — пропустить: ").strip()
            except EOFError:  # нет консоли для ввода
                token = ""
            if not token:
                _declined_tokens.add(env)
                return False
            os.environ[env] = token
            if env == "CIVITAI_TOKEN":
                with open(CIVITAI_TOKEN_FILE, "w", encoding="utf-8") as f:
                    f.write(token + "\n")
                print("  Ключ сохранён в civitai_token.txt")
            return True
    return False


def build_request(url, start):
    if url.startswith("github-release:"):
        req = urllib.request.Request(resolve_release_url(url),
                                     headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"})
        # Не пересылается при редиректе на хранилище GitHub
        req.add_unredirected_header("Authorization", "Bearer " + github_token())
        if start:
            req.add_header("Range", f"bytes={start}-")
        return req
    host = urllib.parse.urlsplit(url).hostname or ""
    if host.endswith("civitai.com") and os.environ.get("CIVITAI_TOKEN"):
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}token={urllib.parse.quote(os.environ['CIVITAI_TOKEN'])}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    if start:
        req.add_header("Range", f"bytes={start}-")
    if host.endswith("huggingface.co") and os.environ.get("HF_TOKEN"):
        # Не пересылается при редиректе на CDN
        req.add_unredirected_header("Authorization", "Bearer " + os.environ["HF_TOKEN"])
    return req


def fetch(url, part, size):
    """Качает url в part с докачкой. Возвращает sha256 скачанного файла."""
    start = os.path.getsize(part) if os.path.exists(part) else 0
    if start >= size:
        os.remove(part)
        start = 0
    with urllib.request.urlopen(build_request(url, start), timeout=60) as resp:
        if start and resp.status != 206:
            start = 0  # сервер не поддерживает докачку
        h = sha256_of(part) if start else hashlib.sha256()
        done, shown = start, 0.0
        t0 = time.time()
        with open(part, "ab" if start else "wb") as f:
            while True:
                buf = resp.read(CHUNK)
                if not buf:
                    break
                f.write(buf)
                h.update(buf)
                done += len(buf)
                now = time.time()
                if now - shown > 1:
                    speed = (done - start) / max(now - t0, 1e-6)
                    print(f"\r  {human(done)} / {human(size)}  {human(speed)}/с   ", end="", flush=True)
                    shown = now
        if shown:
            print()
    return h.hexdigest()


def download(urls, dest, size, sha256=None):
    """Скачивает первый рабочий url в dest. sha256=None — проверяется только размер."""
    part = dest + ".part"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    last_err = "нет ссылок для скачивания"
    for url in urls:
        for attempt in range(1, 4):
            try:
                digest = fetch(url, part, size)
                if os.path.getsize(part) != size:
                    last_err = f"размер {os.path.getsize(part)} вместо {size}"
                    continue
                if sha256 and digest != sha256:
                    os.remove(part)
                    last_err = "SHA256 не совпал"
                    break
                os.replace(part, dest)
                return
            except urllib.error.HTTPError as e:
                last_err = f"HTTP {e.code} ({url})"
                if e.code in (401, 403):
                    if ask_token(url):
                        continue
                    last_err += " — нужен токен CIVITAI_TOKEN или HF_TOKEN"
                    break
                if e.code == 404:
                    break
                if e.code == 416 and os.path.exists(part):
                    os.remove(part)
            except Exception as e:  # noqa: BLE001 — сеть, таймауты, диск
                last_err = f"{e!r} ({url})"
            print(f"  попытка {attempt} не удалась: {last_err}")
            time.sleep(3 * attempt)
    raise RuntimeError(last_err)


def extract_members(archive, members):
    with zipfile.ZipFile(archive) as zf:
        for m in members:
            dest = os.path.join(ROOT, m["path"])
            part = dest + ".part"
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            h = hashlib.sha256()
            with zf.open(m["name"]) as src, open(part, "wb") as out:
                for buf in iter(lambda: src.read(CHUNK), b""):
                    out.write(buf)
                    h.update(buf)
            if h.hexdigest() != m["sha256"]:
                os.remove(part)
                raise RuntimeError(f"SHA256 {m['name']} в архиве не совпал")
            os.replace(part, dest)
            print(f"  распакован {m['path']}")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    if not os.environ.get("CIVITAI_TOKEN") and os.path.exists(CIVITAI_TOKEN_FILE):
        with open(CIVITAI_TOKEN_FILE, encoding="utf-8") as f:
            os.environ["CIVITAI_TOKEN"] = f.read().strip()
    ap = argparse.ArgumentParser(description="Скачивание моделей Forge Neo")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    only = args.only.lower()

    jobs = []  # (описание, размер, функция)
    for m in manifest["models"]:
        if only in m["path"].lower() and not is_present(m["path"], m["size"], m["sha256"], args.verify):
            jobs.append((m["path"], m["size"], m,
                         lambda m=m: download(m["urls"], os.path.join(ROOT, m["path"]), m["size"], m["sha256"])))

    for a in manifest.get("archives", []):
        members = [x for x in a["members"] if only in x["path"].lower()
                   and not is_present(x["path"], x["size"], x["sha256"], args.verify)]
        if not members:
            continue

        def run(a=a, members=members):
            archive = os.path.join(DOWNLOAD_DIR, a["name"])
            if not (os.path.exists(archive) and os.path.getsize(archive) == a["size"]):
                download(a["urls"], archive, a["size"])
            extract_members(archive, members)
            os.remove(archive)

        jobs.append((f"{a['name']} → {len(members)} файлов", a["size"], a, run))

    total = sum(j[1] for j in jobs)
    print(f"Нужно скачать: {len(jobs)} ({human(total)})")
    if args.list:
        for name, size, _, _ in jobs:
            print(f"  {human(size):>10}  {name}")
        return 0

    failed = []
    for i, (name, size, item, run) in enumerate(jobs, 1):
        print(f"[{i}/{len(jobs)}] {name} ({human(size)})")
        try:
            run()
        except (RuntimeError, OSError, zipfile.BadZipFile) as e:
            print(f"  ОШИБКА: {e}")
            failed.append((name, item, str(e)))

    if os.path.isdir(DOWNLOAD_DIR) and not os.listdir(DOWNLOAD_DIR):
        shutil.rmtree(DOWNLOAD_DIR, ignore_errors=True)

    if failed:
        print(f"\nНе скачано: {len(failed)}")
        for name, item, err in failed:
            print(f"  {name}: {err}")
            if item.get("page"):
                print(f"    страница модели: {item['page']}")
        return 1
    print("\nВсе модели на месте.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
