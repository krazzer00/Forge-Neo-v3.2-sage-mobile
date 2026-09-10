#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Forge Neo MobileUI
==================
Лёгкий сервер-компаньон для Stable Diffusion WebUI Forge Neo.

* Отдаёт мобильное веб-приложение (PWA) на 0.0.0.0:9595
* Проксирует запросы к Forge API (по умолчанию http://127.0.0.1:7860)
* Агрегирует «тяжёлые» справочники в один компактный /api/bootstrap
* Не имеет внешних зависимостей (только стандартная библиотека Python)

Запуск:
    python server.py [--host 0.0.0.0] [--port 9595] [--forge http://127.0.0.1:7860]
"""

import argparse
import http.client
import json
import mimetypes
import os
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")
CACHE_DIR = os.path.join(ROOT, "cache")
CHARS_DIR = os.path.join(ROOT, "characters")
TMP_DIR = os.path.join(CACHE_DIR, "tmp")

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/svg+xml", ".svg")

CFG = {
    "forge": "http://127.0.0.1:7860",
    "host": "0.0.0.0",
    "port": 9595,
    "dev": False,
}


# --------------------------------------------------------------------------- #
#  HTTP-клиент к Forge
# --------------------------------------------------------------------------- #

def _forge_parts():
    u = urllib.parse.urlsplit(CFG["forge"])
    host = u.hostname or "127.0.0.1"
    port = u.port or (443 if u.scheme == "https" else 80)
    return u.scheme, host, port, (u.path.rstrip("/") or "")


def forge_request(method, path, body=None, headers=None, timeout=3600):
    """Выполняет запрос к Forge. Возвращает (status, headers, body)."""
    scheme, host, port, base = _forge_parts()
    conn_cls = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(host, port, timeout=timeout)
    hdrs = {"Accept": "*/*", "Connection": "close"}
    if headers:
        hdrs.update(headers)
    if body is not None and "Content-Type" not in hdrs:
        hdrs["Content-Type"] = "application/json"
    try:
        conn.request(method, base + path, body=body, headers=hdrs)
        resp = conn.getresponse()
        data = resp.read()
        return resp.status, resp.getheaders(), data
    finally:
        try:
            conn.close()
        except Exception:
            pass


def forge_json(path, method="GET", payload=None, timeout=120, default=None):
    try:
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
        st, _h, data = forge_request(method, path, body=body, timeout=timeout)
        if st >= 400 or not data:
            return default
        return json.loads(data.decode("utf-8", "replace"))
    except Exception:
        return default


# --------------------------------------------------------------------------- #
#  Кеш справочников
# --------------------------------------------------------------------------- #

class TTLCache:
    def __init__(self):
        self._d = {}
        self._lock = threading.Lock()

    def get(self, key, ttl):
        with self._lock:
            item = self._d.get(key)
            if not item:
                return None
            ts, val = item
            if ttl is not None and (time.time() - ts) > ttl:
                return None
            return val

    def set(self, key, val):
        with self._lock:
            self._d[key] = (time.time(), val)

    def drop(self, key=None):
        with self._lock:
            if key is None:
                self._d.clear()
            else:
                self._d.pop(key, None)


CACHE = TTLCache()

REMBG_MODELS = [
    "None", "isnet-general-use", "isnet-anime", "u2net", "u2netp",
    "u2net_human_seg", "u2net_cloth_seg", "silueta",
]


def _slim_script_info(info):
    """Компактное представление script-info, раздельно для txt2img/img2img."""
    out = {"txt2img": [], "img2img": []}
    for s in info or []:
        entry = {
            "name": s.get("name"),
            "is_alwayson": bool(s.get("is_alwayson")),
            "args": s.get("args") or [],
        }
        key = "img2img" if s.get("is_img2img") else "txt2img"
        out[key].append(entry)
    return out


def _abs_outdirs(gs):
    """Строит список корневых папок для галереи."""
    setting = (gs or {}).get("global_setting", {}) or {}
    sd_cwd = (gs or {}).get("sd_cwd") or ""
    folders = []
    seen = set()

    def add(title, raw, kind="out"):
        if not raw:
            return
        p = raw
        if not os.path.isabs(p):
            p = os.path.join(sd_cwd, p)
        p = os.path.normpath(p)
        low = p.lower()
        if low in seen:
            return
        seen.add(low)
        folders.append({"title": title, "path": p, "kind": kind,
                        "exists": os.path.isdir(p)})

    add("txt2img", setting.get("outdir_txt2img_samples"))
    add("img2img", setting.get("outdir_img2img_samples"))
    add("Extras", setting.get("outdir_extras_samples"))
    add("Сохранённые", setting.get("outdir_save"))
    add("Сетки txt2img", setting.get("outdir_txt2img_grids"), "grid")
    add("Сетки img2img", setting.get("outdir_img2img_grids"), "grid")
    add("Видео", setting.get("outdir_videos"), "video")
    add("Init-изображения", setting.get("outdir_init_images"), "init")
    for ep in (gs or {}).get("extra_paths") or []:
        p = ep.get("path") if isinstance(ep, dict) else ep
        if p:
            add(os.path.basename(os.path.normpath(p)) or p, p, "extra")
    return folders


BOOTSTRAP_JOBS = {
    "options": "/sdapi/v1/options",
    "sd_models": "/sdapi/v1/sd-models",
    "sd_modules": "/sdapi/v1/sd-modules",
    "samplers": "/sdapi/v1/samplers",
    "schedulers": "/sdapi/v1/schedulers",
    "upscalers": "/sdapi/v1/upscalers",
    "latent_modes": "/sdapi/v1/latent-upscale-modes",
    "styles": "/sdapi/v1/prompt-styles",
    "face_restorers": "/sdapi/v1/face-restorers",
    "scripts": "/sdapi/v1/scripts",
    "script_info": "/sdapi/v1/script-info",
    "adetailer": "/adetailer/v1/ad_model",
    "cn_modules": "/controlnet/module_list",
    "cn_models": "/controlnet/model_list",
    "cn_types": "/controlnet/control_types",
    "reactor_models": "/reactor/models",
    "reactor_upscalers": "/reactor/upscalers",
    "reactor_faces": "/reactor/facemodels",
    "interrogators": "/interrogator/models",
    "iib": "/infinite_image_browsing/global_setting",
    "memory": "/sdapi/v1/memory",
}


def build_bootstrap():
    """Собирает все справочники параллельно."""
    result = {}
    lock = threading.Lock()

    def run(key, path):
        val = forge_json(path, timeout=120)
        with lock:
            result[key] = val

    threads = [threading.Thread(target=run, args=(k, v), daemon=True)
               for k, v in BOOTSTRAP_JOBS.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=180)

    opts = result.get("options") or {}
    gs = result.get("iib") or {}
    iib_setting = gs.get("global_setting") or {}

    return {
        "ok": bool(result.get("samplers")),
        "options": opts,
        "checkpoints": [
            {"title": m.get("title"), "name": m.get("model_name"),
             "filename": m.get("filename"), "hash": m.get("hash")}
            for m in (result.get("sd_models") or [])
        ],
        "modules": [
            {"name": m.get("model_name"), "filename": m.get("filename")}
            for m in (result.get("sd_modules") or [])
        ],
        "samplers": [s.get("name") for s in (result.get("samplers") or [])],
        "schedulers": [s.get("label") or s.get("name")
                       for s in (result.get("schedulers") or [])],
        "upscalers": [u.get("name") for u in (result.get("upscalers") or [])],
        "latent_modes": result.get("latent_modes") or [],
        "styles": [
            {"name": s.get("name"), "prompt": s.get("prompt") or "",
             "negative_prompt": s.get("negative_prompt") or ""}
            for s in (result.get("styles") or []) if s.get("name")
        ],
        "face_restorers": [f.get("name") for f in (result.get("face_restorers") or [])],
        "scripts": result.get("scripts") or {},
        "script_info": _slim_script_info(result.get("script_info")),
        "adetailer_models": (result.get("adetailer") or {}).get("ad_model") or [],
        "controlnet": {
            "modules": (result.get("cn_modules") or {}).get("module_list") or [],
            "models": (result.get("cn_models") or {}).get("model_list") or [],
            "control_types": (result.get("cn_types") or {}).get("control_types") or {},
            "unit_count": iib_setting.get("control_net_unit_count") or 3,
        },
        "reactor": {
            "models": (result.get("reactor_models") or {}).get("models") or [],
            "upscalers": (result.get("reactor_upscalers") or {}).get("upscalers") or [],
            "faces": (result.get("reactor_faces") or {}).get("facemodels")
                     or (result.get("reactor_faces") or {}).get("models") or [],
        },
        "interrogators": result.get("interrogators") or [],
        "rembg_models": REMBG_MODELS,
        "presets": ["sd", "xl", "flux", "klein", "qwen", "lumina", "zit",
                    "wan", "anima", "ernie", "pid", "krea"],
        "unet_dtypes": ["Automatic", "Automatic (fp16 LoRA)", "float8-e4m3fn",
                        "float8-e4m3fn (fp16 LoRA)", "float8-e5m2",
                        "float8-e5m2 (fp16 LoRA)"],
        "folders": _abs_outdirs(gs),
        "sd_cwd": gs.get("sd_cwd") or "",
        "ad_max_models": iib_setting.get("ad_max_models") or 4,
        "memory": result.get("memory") or {},
        "ts": int(time.time()),
    }


# --------------------------------------------------------------------------- #
#  Библиотека персонажей (референсы для Klein / Kontext / Qwen-Edit)
#
#  Референсы подаются в Forge через alwayson-скрипт «ImageStitch Integrated»:
#      args = [enable(bool), [base64, ...], max_side_length(int)]
#  Для FLUX.2 Klein при включённой опции klein_do_reference это включает
#  режим Edit: изображения становятся ref_latents модели.
# --------------------------------------------------------------------------- #

def _char_dir(cid):
    return os.path.join(CHARS_DIR, cid)


def _safe_id(cid):
    cid = str(cid or "").strip()
    if not cid or not all(c.isalnum() or c in "-_" for c in cid):
        return None
    return cid


def _new_id():
    import uuid
    return uuid.uuid4().hex[:12]


def chars_list():
    out = []
    if not os.path.isdir(CHARS_DIR):
        return out
    for name in sorted(os.listdir(CHARS_DIR)):
        meta_path = os.path.join(CHARS_DIR, name, "meta.json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            continue
        meta["id"] = name
        meta["refs"] = [r for r in (meta.get("refs") or [])
                        if os.path.isfile(os.path.join(CHARS_DIR, name, r))]
        out.append(meta)
    out.sort(key=lambda m: m.get("created", 0), reverse=True)
    return out


def char_get(cid):
    cid = _safe_id(cid)
    if not cid:
        return None
    meta_path = os.path.join(_char_dir(cid), "meta.json")
    if not os.path.isfile(meta_path):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        return None
    meta["id"] = cid
    return meta


def char_write(cid, meta):
    d = _char_dir(cid)
    os.makedirs(d, exist_ok=True)
    tmp = os.path.join(d, "meta.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    os.replace(tmp, os.path.join(d, "meta.json"))


def _decode_image(b64):
    import base64
    import io
    from PIL import Image
    raw = b64
    if "," in raw[:64]:
        raw = raw.split(",", 1)[1]
    data = base64.b64decode(raw)
    return Image.open(io.BytesIO(data)).convert("RGB")


def char_save(req):
    """Создаёт или обновляет персонажа. Изображения приходят в base64."""
    cid = _safe_id(req.get("id")) or _new_id()
    meta = char_get(cid) or {"created": int(time.time()), "refs": []}
    if req.get("name") is not None:
        meta["name"] = str(req["name"])[:80] or "Без имени"
    if req.get("prompt") is not None:
        meta["prompt"] = str(req["prompt"])[:2000]
    meta.setdefault("name", "Без имени")
    meta.setdefault("prompt", "")
    meta.setdefault("refs", [])
    meta["updated"] = int(time.time())

    d = _char_dir(cid)
    os.makedirs(d, exist_ok=True)

    for b64 in req.get("images") or []:
        try:
            img = _decode_image(b64)
        except Exception:
            continue
        idx = 0
        while True:
            fn = "ref%02d.png" % idx
            if not os.path.isfile(os.path.join(d, fn)):
                break
            idx += 1
        img.save(os.path.join(d, fn))
        meta["refs"].append(fn)

    # добавление панелей из ранее нарезанного листа
    token = req.get("token")
    keep = req.get("keep")
    if token and keep:
        _append_from_sheet(d, meta, token, keep)

    meta["refs"] = [r for r in meta["refs"] if os.path.isfile(os.path.join(d, r))]
    char_write(cid, meta)
    meta["id"] = cid
    return {"ok": True, "character": meta}


def char_delete(cid, ref=None):
    cid = _safe_id(cid)
    if not cid:
        return {"ok": False, "error": "bad id"}
    d = _char_dir(cid)
    if ref:
        meta = char_get(cid)
        if not meta:
            return {"ok": False, "error": "not found"}
        if ref in (meta.get("refs") or []):
            meta["refs"].remove(ref)
            try:
                os.remove(os.path.join(d, ref))
            except OSError:
                pass
            char_write(cid, meta)
        return {"ok": True, "character": char_get(cid)}
    import shutil
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)
    return {"ok": True}


# ----------------------------- автонарезка листа --------------------------- #

def _content_mask(img, thr=238):
    """Булева маска «непустых» пикселей (тёмнее почти-белого)."""
    g = img.convert("L")
    w, h = g.size
    px = g.load()
    rows = [0] * h
    cols = [0] * w
    for y in range(h):
        r = 0
        for x in range(w):
            if px[x, y] < thr:
                r += 1
                cols[x] += 1
        rows[y] = r
    return rows, cols


def _split_runs(counts, min_gap, min_run, noise=0):
    """Находит участки с содержимым, разделённые пустыми промежутками."""
    spans = []
    start = None
    gap = 0
    for i, c in enumerate(counts):
        if c > noise:
            if start is None:
                start = i
            gap = 0
        else:
            if start is not None:
                gap += 1
                if gap >= min_gap:
                    end = i - gap + 1
                    if end - start >= min_run:
                        spans.append((start, end))
                    start = None
                    gap = 0
    if start is not None and len(counts) - start >= min_run:
        spans.append((start, len(counts)))
    return spans


def _dark_map(img, thr=225):
    """Матрица «тёмных» пикселей: [y][x] -> 0/1."""
    g = img.convert("L")
    w, h = g.size
    px = g.load()
    return [[1 if px[x, y] < thr else 0 for x in range(w)] for y in range(h)], w, h


def _profile(dark, x0, y0, x1, y1, axis):
    """Профиль плотности содержимого по оси ('v' — по столбцам, 'h' — по строкам)."""
    if axis == "v":
        return [sum(dark[y][x] for y in range(y0, y1)) for x in range(x0, x1)]
    return [sum(dark[y][x0:x1]) for y in range(y0, y1)]


def _cut_positions(prof, span, min_gap, min_run, noise_frac):
    """Границы фрагментов внутри профиля, разделённых «пустыми» промежутками."""
    noise = max(0, int(span * noise_frac))
    return _split_runs(prof, min_gap, min_run, noise=noise)


def slice_sheet(img, min_frac=0.008, max_panels=48):
    """
    Рекурсивное XY-разрезание листа персонажа на панели.
    Сначала пробуется вертикальный разрез (колонки), затем горизонтальный.
    """
    W, H = img.size
    scale = 1.0
    work = img
    if max(W, H) > 1400:
        scale = 1400.0 / max(W, H)
        work = img.resize((max(1, int(W * scale)), max(1, int(H * scale))))
    dark, w, h = _dark_map(work)

    min_gap = max(2, int(min(w, h) * 0.006))
    min_run = max(18, int(min(w, h) * 0.035))
    noise_frac = 0.02
    leaves = []

    def rec(x0, y0, x1, y1, depth, prefer):
        if depth > 6 or (x1 - x0) < min_run or (y1 - y0) < min_run:
            leaves.append((x0, y0, x1, y1))
            return
        order = ("v", "h") if prefer == "v" else ("h", "v")
        for axis in order:
            if axis == "v":
                prof = _profile(dark, x0, y0, x1, y1, "v")
                parts = _cut_positions(prof, y1 - y0, min_gap, min_run, noise_frac)
                if len(parts) > 1:
                    for (a, b) in parts:
                        rec(x0 + a, y0, x0 + b, y1, depth + 1, "h")
                    return
            else:
                prof = _profile(dark, x0, y0, x1, y1, "h")
                parts = _cut_positions(prof, x1 - x0, min_gap, min_run, noise_frac)
                if len(parts) > 1:
                    for (a, b) in parts:
                        rec(x0, y0 + a, x1, y0 + b, depth + 1, "v")
                    return
        leaves.append((x0, y0, x1, y1))

    rec(0, 0, w, h, 0, "v")

    area = w * h

    def keep(b):
        bw, bh = b[2] - b[0], b[3] - b[1]
        if bw * bh < area * min_frac:
            return False
        if bw < 40 or bh < 40:
            return False
        if bw > bh * 8:            # горизонтальные полосы-заголовки
            return False
        return bh <= bw * 9        # очень узкие вертикальные срезы

    boxes = [b for b in leaves if keep(b)]
    boxes.sort(key=lambda b: (b[1], b[0]))
    boxes = boxes[:max_panels]

    inv = 1.0 / scale
    pad = 2
    out = []
    for (x0, y0, x1, y1) in boxes:
        out.append((max(0, int(x0 * inv) - pad), max(0, int(y0 * inv) - pad),
                    min(W, int(x1 * inv) + pad), min(H, int(y1 * inv) + pad)))
    return out


def _thumb_b64(img, size=200):
    import base64
    import io
    im = img.copy()
    im.thumbnail((size, size))
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=80)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def sheet_slice(req):
    """Нарезает лист на панели, кладёт оригинал во временный файл."""
    try:
        img = _decode_image(req.get("image") or "")
    except Exception as exc:
        return {"ok": False, "error": "не удалось прочитать изображение: %s" % exc}
    os.makedirs(TMP_DIR, exist_ok=True)
    token = _new_id()
    path = os.path.join(TMP_DIR, token + ".png")
    img.save(path)
    _cleanup_tmp()
    boxes = slice_sheet(img)
    panels = [{"i": i, "box": list(b),
               "w": b[2] - b[0], "h": b[3] - b[1],
               "thumb": _thumb_b64(img.crop(b))}
              for i, b in enumerate(boxes)]
    return {"ok": True, "token": token, "size": list(img.size),
            "panels": panels, "whole": _thumb_b64(img, 320)}


def _append_from_sheet(d, meta, token, keep):
    token = _safe_id(token)
    if not token:
        return
    path = os.path.join(TMP_DIR, token + ".png")
    if not os.path.isfile(path):
        return
    from PIL import Image
    with Image.open(path) as img:
        img = img.convert("RGB")
        for item in keep:
            box = item.get("box") if isinstance(item, dict) else None
            if not box or len(box) != 4:
                continue
            crop = img.crop(tuple(int(v) for v in box))
            idx = 0
            while True:
                fn = "ref%02d.png" % idx
                if not os.path.isfile(os.path.join(d, fn)):
                    break
                idx += 1
            crop.save(os.path.join(d, fn))
            meta["refs"].append(fn)


def _cleanup_tmp(max_age=3600):
    try:
        now = time.time()
        for name in os.listdir(TMP_DIR):
            p = os.path.join(TMP_DIR, name)
            if os.path.isfile(p) and now - os.path.getmtime(p) > max_age:
                os.remove(p)
    except Exception:
        pass


def char_ref_b64(cid, max_side=1024):
    """Возвращает список base64 референсов персонажа для ImageStitch."""
    import base64
    import io
    from PIL import Image
    meta = char_get(cid)
    if not meta:
        return []
    d = _char_dir(cid)
    out = []
    for fn in meta.get("refs") or []:
        p = os.path.join(d, fn)
        if not os.path.isfile(p):
            continue
        try:
            with Image.open(p) as im:
                im = im.convert("RGB")
                if max_side and max(im.size) > max_side:
                    im.thumbnail((max_side, max_side))
                buf = io.BytesIO()
                im.save(buf, "PNG")
                out.append(base64.b64encode(buf.getvalue()).decode())
        except Exception:
            continue
    return out


# --------------------------------------------------------------------------- #
#  Config Presets (расширение Config-Presets)
# --------------------------------------------------------------------------- #

PRESET_FILES = {"txt2img": "config-txt2img.json", "img2img": "config-img2img.json"}


def presets_dir():
    """Ищет каталог расширения Config-Presets."""
    cached = CACHE.get("presets_dir", None)
    if cached:
        return cached
    candidates = []
    boot = CACHE.get("bootstrap", None)
    if boot and boot.get("sd_cwd"):
        candidates.append(os.path.join(boot["sd_cwd"], "extensions", "Config-Presets"))
    candidates.append(os.path.join(os.path.dirname(ROOT), "webui", "extensions",
                                   "Config-Presets"))
    candidates.append(os.path.join(os.path.dirname(ROOT), "extensions", "Config-Presets"))
    for c in candidates:
        if os.path.isdir(c):
            CACHE.set("presets_dir", c)
            return c
    return None


def load_presets():
    d = presets_dir()
    if not d:
        return {"ok": False, "error": "Config-Presets не найден", "txt2img": {}, "img2img": {}}
    out = {"ok": True, "dir": d}
    for mode, fname in PRESET_FILES.items():
        path = os.path.join(d, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                out[mode] = json.load(f)
        except Exception as exc:
            out[mode] = {}
            out.setdefault("errors", []).append("%s: %s" % (fname, exc))
    return out


def save_preset(mode, name, values, delete=False):
    if mode not in PRESET_FILES:
        return {"ok": False, "error": "bad mode"}
    if not name or not str(name).strip():
        return {"ok": False, "error": "empty name"}
    d = presets_dir()
    if not d:
        return {"ok": False, "error": "Config-Presets не найден"}
    path = os.path.join(d, PRESET_FILES[mode])
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    if delete:
        data.pop(name, None)
    else:
        data[name] = values or {}
    try:
        backup = path + ".mobileui.bak"
        if os.path.isfile(path) and not os.path.isfile(backup):
            import shutil
            shutil.copy2(path, backup)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        os.replace(tmp, path)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": True, "names": list(data.keys())}


PREVIEW_EXT = (".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
               ".png", ".jpg", ".jpeg", ".webp")


def _find_preview(path):
    if not path:
        return None
    base = os.path.splitext(path)[0]
    for ext in PREVIEW_EXT:
        cand = base + ext
        if os.path.isfile(cand):
            return cand
    return None


def build_loras():
    raw = forge_json("/sdapi/v1/loras", timeout=300, default=[]) or []
    out = []
    for l in raw:
        path = l.get("path") or ""
        meta = l.get("metadata") or {}
        act = l.get("activation_text") or meta.get("activation text") or ""
        out.append({
            "name": l.get("name"),
            "alias": l.get("alias") or l.get("name"),
            "path": path,
            "dir": os.path.basename(os.path.dirname(path)) if path else "",
            "act": act if isinstance(act, str) else "",
            "preview": _find_preview(path),
        })
    out.sort(key=lambda x: ((x.get("dir") or "").lower(), (x.get("name") or "").lower()))
    return out


def build_embeddings():
    raw = forge_json("/sdapi/v1/embeddings", timeout=180, default={}) or {}
    items = []
    for group in ("loaded", "skipped"):
        for name, info in (raw.get(group) or {}).items():
            items.append({"name": name, "loaded": group == "loaded",
                          "vectors": (info or {}).get("vectors")})
    items.sort(key=lambda x: x["name"].lower())
    return items


# --------------------------------------------------------------------------- #
#  Миниатюры превью LoRA
# --------------------------------------------------------------------------- #

def make_thumb(path, size=192):
    """Возвращает (bytes, content_type). Использует PIL, если он доступен."""
    try:
        import hashlib
        st = os.stat(path)
        key = hashlib.md5(("%s|%s|%s" % (path, st.st_mtime_ns, size)).encode("utf-8")).hexdigest()
        cache_file = os.path.join(CACHE_DIR, key + ".webp")
        if os.path.isfile(cache_file):
            with open(cache_file, "rb") as f:
                return f.read(), "image/webp"
        from PIL import Image
        os.makedirs(CACHE_DIR, exist_ok=True)
        with Image.open(path) as im:
            im = im.convert("RGB")
            im.thumbnail((size, size), Image.LANCZOS)
            im.save(cache_file, "WEBP", quality=82, method=4)
        with open(cache_file, "rb") as f:
            return f.read(), "image/webp"
    except Exception:
        try:
            with open(path, "rb") as f:
                data = f.read()
            return data, mimetypes.guess_type(path)[0] or "application/octet-stream"
        except Exception:
            return None, None


# --------------------------------------------------------------------------- #
#  HTTP-сервер
# --------------------------------------------------------------------------- #

HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "transfer-encoding",
              "proxy-authorization", "te", "trailers", "upgrade",
              "content-encoding", "content-length"}


class Handler(BaseHTTPRequestHandler):
    server_version = "ForgeMobileUI/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if CFG["dev"]:
            sys.stderr.write("[mobileui] %s\n" % (fmt % args))

    # ------------------------------------------------------------------ io
    def _send(self, code, body=b"", ctype="application/json; charset=utf-8",
              extra=None, head_only=False):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not head_only and body:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, obj, code=200, extra=None):
        self._send(code, json.dumps(obj, ensure_ascii=False), extra=extra)

    def _read_body(self):
        length = self.headers.get("Content-Length")
        if length:
            try:
                return self.rfile.read(int(length))
            except Exception:
                return b""
        if (self.headers.get("Transfer-Encoding") or "").lower() == "chunked":
            chunks = []
            while True:
                line = self.rfile.readline().strip()
                try:
                    size = int(line.split(b";")[0], 16)
                except Exception:
                    break
                if size == 0:
                    self.rfile.readline()
                    break
                chunks.append(self.rfile.read(size))
                self.rfile.readline()
            return b"".join(chunks)
        return b""

    # ------------------------------------------------------------- methods
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self._route(head_only=True)

    def do_GET(self):
        self._route()

    def do_POST(self):
        self._route()

    def do_PUT(self):
        self._route()

    def do_DELETE(self):
        self._route()

    # --------------------------------------------------------------- router
    def _route(self, head_only=False):
        try:
            parsed = urllib.parse.urlsplit(self.path)
            path = urllib.parse.unquote(parsed.path)
            query = parsed.query

            if path.startswith("/forge/"):
                return self._proxy("/" + path[len("/forge/"):], query)
            if path == "/forge":
                return self._proxy("/", query)
            if path.startswith("/api/"):
                return self._api(path[len("/api/"):], query)
            return self._static(path, head_only=head_only)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            try:
                self._json({"error": str(exc)}, 500)
            except Exception:
                pass

    # ---------------------------------------------------------------- proxy
    def _proxy(self, target_path, query):
        body = None
        if self.command in ("POST", "PUT", "PATCH", "DELETE"):
            body = self._read_body()
        headers = {}
        ct = self.headers.get("Content-Type")
        if ct:
            headers["Content-Type"] = ct
        rng = self.headers.get("Range")
        if rng:
            headers["Range"] = rng
        full = target_path
        if query:
            full += "?" + query
        try:
            st, hdrs, data = forge_request(self.command, full, body=body,
                                           headers=headers, timeout=3600)
        except (ConnectionRefusedError, socket.error, OSError) as exc:
            return self._json({"error": "forge_unreachable", "detail": str(exc)}, 503)
        extra = {}
        ctype = "application/octet-stream"
        for k, v in hdrs:
            lk = k.lower()
            if lk in HOP_BY_HOP:
                continue
            if lk == "content-type":
                ctype = v
            elif lk in ("cache-control", "etag", "expires", "last-modified",
                        "content-disposition", "content-range", "accept-ranges"):
                extra[k] = v
        self._send(st, data, ctype=ctype, extra=extra)

    # ------------------------------------------------------------------ api
    def _api(self, name, query):
        q = urllib.parse.parse_qs(query)
        refresh = q.get("refresh", ["0"])[0] not in ("0", "", "false")

        if name == "health":
            ok = forge_json("/infinite_image_browsing/hello", timeout=6) is not None
            if not ok:
                ok = forge_json("/sdapi/v1/samplers", timeout=6) is not None
            return self._json({"ok": bool(ok), "forge": CFG["forge"]})

        if name == "bootstrap":
            data = None if refresh else CACHE.get("bootstrap", 45)
            if data is None:
                data = build_bootstrap()
                if data.get("ok"):
                    CACHE.set("bootstrap", data)
            return self._json(data)

        # ------------------------- персонажи -------------------------
        if name == "characters":
            if self.command == "POST":
                try:
                    req = json.loads(self._read_body().decode("utf-8") or "{}")
                except ValueError:
                    return self._json({"error": "bad json"}, 400)
                action = req.get("action") or "save"
                if action == "save":
                    return self._json(char_save(req))
                if action == "delete":
                    return self._json(char_delete(req.get("id"), req.get("ref")))
                if action == "slice":
                    return self._json(sheet_slice(req))
                return self._json({"ok": False, "error": "unknown action"}, 400)
            return self._json({"ok": True, "characters": chars_list()})

        if name == "char-image":
            cid = _safe_id(q.get("id", [""])[0])
            ref = q.get("ref", [""])[0]
            try:
                size = int(q.get("size", ["0"])[0] or 0)
            except ValueError:
                size = 0
            if not cid or not ref or "/" in ref or "\\" in ref or ".." in ref:
                return self._send(404, b"", "text/plain")
            path = os.path.join(_char_dir(cid), ref)
            if not os.path.isfile(path):
                return self._send(404, b"", "text/plain")
            if size:
                data, ctype = make_thumb(path, size)
            else:
                with open(path, "rb") as f:
                    data, ctype = f.read(), "image/png"
            if data is None:
                return self._send(404, b"", "text/plain")
            return self._send(200, data, ctype,
                              extra={"Cache-Control": "public, max-age=86400"})

        # ---------- генерация с подстановкой референсов персонажа ----------
        if name in ("generate/txt2img", "generate/img2img"):
            if self.command != "POST":
                return self._json({"error": "POST only"}, 405)
            try:
                req = json.loads(self._read_body().decode("utf-8") or "{}")
            except ValueError:
                return self._json({"error": "bad json"}, 400)
            payload = req.get("payload") or {}
            char = req.get("character") or {}
            cid = _safe_id(char.get("id"))
            if cid:
                max_side = int(char.get("max_side") or 1024)
                refs = char_ref_b64(cid, max_side)
                if refs:
                    ao = payload.setdefault("alwayson_scripts", {})
                    ao["ImageStitch Integrated"] = {"args": [True, refs, max_side]}
            target = "/sdapi/v1/txt2img" if name.endswith("txt2img") else "/sdapi/v1/img2img"
            try:
                st, _h, data = forge_request(
                    "POST", target, body=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"}, timeout=3600)
            except (ConnectionRefusedError, socket.error, OSError) as exc:
                return self._json({"error": "forge_unreachable", "detail": str(exc)}, 503)
            return self._send(st, data, "application/json; charset=utf-8")

        if name == "presets":
            if self.command == "POST":
                try:
                    req = json.loads(self._read_body().decode("utf-8") or "{}")
                except ValueError:
                    return self._json({"error": "bad json"}, 400)
                return self._json(save_preset(req.get("mode"), req.get("name"),
                                              req.get("values"), req.get("delete")))
            return self._json(load_presets())

        if name == "loras":
            data = None if refresh else CACHE.get("loras", 1800)
            if data is None:
                if refresh:
                    forge_json("/sdapi/v1/refresh-loras", method="POST", timeout=300)
                data = build_loras()
                CACHE.set("loras", data)
            return self._json(data)

        if name == "embeddings":
            data = None if refresh else CACHE.get("embeddings", 1800)
            if data is None:
                data = build_embeddings()
                CACHE.set("embeddings", data)
            return self._json(data)

        if name == "refresh":
            CACHE.drop()
            for p in ("/sdapi/v1/refresh-checkpoints", "/sdapi/v1/refresh-vae",
                      "/sdapi/v1/refresh-loras", "/sdapi/v1/refresh-embeddings"):
                forge_json(p, method="POST", timeout=300)
            return self._json({"ok": True})

        if name == "thumb":
            path = q.get("path", [""])[0]
            try:
                size = int(q.get("size", ["192"])[0] or 192)
            except ValueError:
                size = 192
            if not path or not os.path.isfile(path):
                return self._send(404, b"", "text/plain")
            data, ctype = make_thumb(path, size)
            if data is None:
                return self._send(404, b"", "text/plain")
            return self._send(200, data, ctype,
                              extra={"Cache-Control": "public, max-age=604800"})

        if name == "folders":
            gs = forge_json("/infinite_image_browsing/global_setting", timeout=60,
                            default={})
            return self._json({"folders": _abs_outdirs(gs)})

        return self._json({"error": "unknown endpoint"}, 404)

    # --------------------------------------------------------------- static
    def _static(self, path, head_only=False):
        if path in ("/", ""):
            path = "/index.html"
        rel = path.lstrip("/").replace("\\", "/")
        target = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not target.startswith(WEB_DIR):
            return self._send(403, b"forbidden", "text/plain")
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        if not os.path.isfile(target):
            target = os.path.join(WEB_DIR, "index.html")
            if not os.path.isfile(target):
                return self._send(404, b"not found", "text/plain")
        try:
            st = os.stat(target)
            etag = '"%x-%x"' % (int(st.st_mtime), st.st_size)
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            with open(target, "rb") as f:
                data = f.read()
        except OSError:
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in (
                "application/javascript", "application/json",
                "application/manifest+json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        cache = "public, max-age=604800" if "/icons/" in target.replace("\\", "/") else "no-cache"
        self._send(200, data, ctype, extra={"ETag": etag, "Cache-Control": cache},
                   head_only=head_only)


def local_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    ips.discard("127.0.0.1")
    return sorted(ips)


def wait_for_forge():
    """Фоновая задача: дожидается запуска Forge и прогревает кеш."""
    while True:
        try:
            if forge_json("/infinite_image_browsing/hello", timeout=5) is not None or \
                    forge_json("/sdapi/v1/samplers", timeout=5) is not None:
                data = build_bootstrap()
                if data.get("ok"):
                    CACHE.set("bootstrap", data)
                    print("[MobileUI] Forge подключён, справочники загружены.")
                    return
        except Exception:
            pass
        time.sleep(4)


def main():
    ap = argparse.ArgumentParser(description="Forge Neo MobileUI server")
    ap.add_argument("--host", default=os.environ.get("MOBILEUI_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int,
                    default=int(os.environ.get("MOBILEUI_PORT", "9595")))
    ap.add_argument("--forge", default=os.environ.get("FORGE_URL", "http://127.0.0.1:7860"))
    ap.add_argument("--dev", action="store_true")
    args = ap.parse_args()

    CFG["host"], CFG["port"] = args.host, args.port
    CFG["forge"] = args.forge.rstrip("/")
    CFG["dev"] = args.dev

    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(CHARS_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as exc:
        if getattr(exc, "errno", None) in (48, 98, 10048):
            print("[MobileUI] Port %d is already in use - another instance is "
                  "probably running. Open http://127.0.0.1:%d/"
                  % (args.port, args.port))
            return
        raise
    httpd.daemon_threads = True
    threading.Thread(target=wait_for_forge, daemon=True).start()

    print("=" * 64)
    print("  Forge Neo - MobileUI")
    print("=" * 64)
    print("  Local   : http://127.0.0.1:%d/" % args.port)
    for ip in local_ips():
        print("  Network : http://%s:%d/" % (ip, args.port))
    print("  Forge   : %s" % CFG["forge"])
    print("=" * 64)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[MobileUI] Stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
