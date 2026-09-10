# Klein UI — Design Spec
**Date:** 2026-03-23
**Project:** Forge-Neo v3.2-sage
**Port:** 7861
**Launch:** отдельный `RUN-Klein.bat`, независим от основного webui

---

## 1. Цель

Параллельный Gradio-интерфейс поверх существующего Forge-Neo, оптимизированный под Flux.2-Klein img2img workflow. Запускается отдельно на порту 7861. Разделяет модели, расширения и конфигурацию с основным webui. Адаптирован под мобильные устройства (bottom-nav layout).

---

## 2. Архитектура

### Новые файлы (оригинальный код не трогается)

```
H:\Forge-Neo-v3.2-sage\
├── RUN-Klein.bat                        ← лаунчер (аналог RUN-Sage.bat)
└── webui\
    ├── webui-klein.bat                  ← аналог webui.bat, вызывает launch_klein.py
    ├── webui-user-klein.bat             ← устанавливает COMMANDLINE_ARGS (порт 7861)
    ├── launch_klein.py                  ← точка входа (аналог launch.py)
    ├── webui_klein.py                   ← worker (аналог webui.py)
    └── modules_klein\
        ├── __init__.py
        └── ui_klein.py                  ← Gradio UI: img2img + extras
```

### Цепочка запуска

```
RUN-Klein.bat
  → environment.bat            (существует: H:\Forge-Neo-v3.2-sage\environment.bat)
                                (устанавливает portable Python в PATH, SKIP_VENV=1)
  → cd webui
  → webui-user-klein.bat       (устанавливает COMMANDLINE_ARGS)
  → webui-klein.bat            (НЕ webui.bat! вызывает launch_klein.py напрямую)
  → python launch_klein.py     (полная инициализация Forge)
  → webui_klein.webui()        (Gradio app на 7861)
```

**Почему отдельный `webui-klein.bat`**: оригинальный `webui.bat` хардкодит `python launch.py`.
Создаём `webui-klein.bat` — копию с заменой `launch.py` → `launch_klein.py`.

### Содержимое файлов запуска

**RUN-Klein.bat:**
```bat
@echo off
call environment.bat
cd %~dp0webui
call webui-user-klein.bat
```

**webui-user-klein.bat:**
```bat
@echo off
set COMMANDLINE_ARGS=--sage --uv --pin-shared-memory --cuda-malloc --cuda-stream --listen --enable-insecure-extension-access --api --port 7861
call webui-klein.bat
```

**webui-klein.bat** — копия `webui.bat` с одной заменой: `launch.py` → `launch_klein.py`.

### Инициализация (launch_klein.py)

`launch_klein.py` идентичен `launch.py` с одной заменой импорта:
```python
# launch.py:    import webui; webui.webui()
# launch_klein: import webui_klein; webui_klein.webui()
```
Все остальные шаги (установка зависимостей, проверки, prepare_environment) идентичны.

---

## 3. Построение UI (ключевое архитектурное решение)

### Проблема
`modules/ui.py:create_ui()` возвращает `demo` (единый `gr.Blocks`) — все интерфейсы уже смонтированы внутри. `img2img_interface` и `extras_interface` — локальные переменные функции, недоступны снаружи.

### Решение: прямое построение блоков в ui_klein.py

`img2img_interface` и `extras_interface` — самостоятельные `gr.Blocks` контексты (строки 486 и 815 в `modules/ui.py`). Они независимы друг от друга и от `demo`.

`modules_klein/ui_klein.py` строит их напрямую, не вызывая `create_ui()`:

```python
# modules_klein/ui_klein.py

def initialize_scripts():
    """Инициализация скриптов только для img2img"""
    scripts.scripts_current = scripts.scripts_img2img
    scripts.scripts_img2img.initialize_scripts(is_img2img=True)
    scripts.scripts_current = None

def build_img2img_interface():
    """Строим img2img_interface так же как в modules/ui.py:486-813"""
    with gr.Blocks(analytics_enabled=False, head=canvas_head) as img2img_interface:
        # ... идентичный код из modules/ui.py lines 486-813
        # включая ui_extra_networks.create_ui() для LoRA (line 805)
    return img2img_interface

def build_extras_interface():
    """Строим extras_interface так же как в modules/ui.py:815-816"""
    with gr.Blocks(analytics_enabled=False) as extras_interface:
        ui_postprocessing.create_ui()
    return extras_interface

def create_klein_ui():
    """Финальная сборка Klein app"""
    initialize_scripts()
    img2img = build_img2img_interface()
    extras  = build_extras_interface()
    # собираем в gr.TabbedInterface с bottom-nav mobile CSS
    ...
```

**Следствие**: extension скрипты ориентированные на txt2img будут инициализированы через `modules.initialize`, но их UI не будет рендериться → их event callbacks просто не будут вызваны. Это приемлемо.

### LoRA Panel
Реализуется через стандартный `ui_extra_networks.create_ui(img2img_interface, [img2img_generation_tab], "img2img")` — строка 805 оригинала. Никакого нового кода не нужно, extra networks UI подтягивает LoRA, Textual Inversion, Hypernetworks автоматически.

---

## 4. Config Presets — механизм применения

### Источник данных
`extensions/Config-Presets/config-img2img.json` — маппинг `element_id → value`.

### Как работает
Config-Presets расширение загружается как обычное extension через `modules.initialize`. Его `javascript/` и `preload.py` монтируются в Gradio app.

**Гарантия совместимости**: `ui_klein.py` строит img2img блок тем же кодом что и оригинальный `modules/ui.py`, поэтому все `elem_id` компонентов (напр. `img2img_sampling`, `img2img_steps`, `img2img_cfg_scale`) совпадают с ключами в `config-img2img.json`. Config Presets JS будет работать без изменений.

В Klein UI добавляется строка Config Presets под Model Bar — это просто визуальный ярлык текущего пресета, сам механизм применения — в JS расширения.

---

## 5. UI Layout

### Mobile (< 768px) — Bottom Navigation

```
┌─────────────────────────────┐
│  MODEL BAR (collapsible)    │
│  CONFIG PRESET · STYLES     │
│  SUB-TABS (scroll horiz.)   │
│  CANVAS                     │
│  PROMPT / NEGATIVE          │
│  EXTRA NETWORKS (LoRA)      │
│  Sampling Method / Schedule │
│  Steps / CFG / Denoising    │
│  W / H / ⊞ PRESETS / BATCH  │
│  Resize to·by / Mode / Soft │
│  SEED row                   │
│  ▶ GENERATE (sticky)        │
│  SEND TO / ACTIONS          │
│  EXTENSIONS (collapsed)     │
├─────────────────────────────┤
│  🖼 img2img │✨ Extras│🎛│⚙  │  ← bottom nav (56px)
└─────────────────────────────┘
```

Sticky Generate: `position: sticky; bottom: calc(56px + env(safe-area-inset-bottom, 0px))`

### Desktop (≥ 768px) — Two Column

```
┌────────────────────────────────────────────────────┐
│  MODEL BAR (full row)                              │
│  CONFIG PRESET · STYLES tags + 🎨                  │
├──────────────────────┬─────────────────────────────┤
│  SUB-TABS            │  OUTPUT IMAGE               │
│  CANVAS              │  IMAGE ACTIONS              │
│  PROMPT / NEG        │  ─────────────────          │
│  EXTRA NETWORKS      │  EXTENSIONS (inline)        │
│  PARAMS              │  · ControlNet / Balance     │
│  W/H/⊞/BATCH         │  · ADetailer                │
│  RESIZE + SEED       │  · ImageStitch              │
│  ▶ GENERATE          │  · Reactor / Regional...    │
└──────────────────────┴─────────────────────────────┘
│  🖼 img2img │ ✨ Extras │ 🎛 Extensions │ ⚙ Settings │
└────────────────────────────────────────────────────┘
```

---

## 6. Компоненты UI

### 6.1 Model Bar
| Элемент | Реализация |
|---|---|
| UI Preset dropdown | `shared.opts` |
| Checkpoint dropdown + 🔄 | `modules/sd_models.py` |
| VAE / Text Encoder (multi-tag) | `modules/sd_vae.py` |
| Diffusion in Low Bits | `modules_forge/shared_options.py` |
| Clip Skip | `shared.opts.CLIP_stop_at_last_layers` |
| Noise Multiplier for img2img | `shared.opts` |
| Tiling checkbox | `shared.opts` |

На мобильном: первая строка = Preset + Checkpoint (collapsed), тап → разворачивает полный bar.

### 6.2 Config Presets + Styles Bar
| Элемент | Файл-источник |
|---|---|
| Config Preset dropdown | `extensions/Config-Presets/config-img2img.json` |
| 📋 copy / ✏ edit | работают с выбранным пресетом |
| Styles теги (multi-select) | `styles.csv` (`name,prompt,negative_prompt`) |
| 🎨 кнопка | открывает панель мультиселекта стилей |

Styles: выбранные отображаются тегами над промптом. Применяются инъекцией в prompt/negative_prompt при Generate.

### 6.3 img2img Sub-tabs
Все 6 вкладок: img2img / Sketch / Inpaint / Inpaint Sketch / Inpaint Upload / Batch.
На мобильном — горизонтальный scroll без wrap.

### 6.4 Canvas
`ForgeCanvas` из `modules_forge/forge_canvas/` — без изменений.

### 6.5 Extra Networks (LoRA)
`ui_extra_networks.create_ui(img2img_interface, [img2img_generation_tab], "img2img")` — строка 805 оригинала. Никаких изменений, стандартный механизм.

### 6.6 Параметры генерации
- Sampling Method dropdown + Schedule Type dropdown
- Sampling Steps slider
- CFG Scale + Denoising Strength sliders
- Width / Height sliders
- **⊞ Resolution Presets** попап (Gradio `gr.Popover` или `gr.Column` overlay):
  - Square: `1024×1024`
  - Portrait: `640×1536`, `768×1344`, `832×1216`, `896×1152`
  - Landscape: `1536×640`, `1344×768`, `1216×832`, `1152×896`
  - Клик → устанавливает Width/Height через `gr.update`
- Batch Count / Batch Size
- Resize to / Resize by toggle
- Resize mode: Just resize / Crop and resize / Resize and fill / Latent upscale
- Soft inpainting checkbox
- Seed + 🎲 reroll + ♻ reuse last + Extra seed options

### 6.7 Generate + Actions
- ▶ Generate (sticky на мобильном, см. выше)
- Send to img2img / Extras · 💾 Save · 🗑 Delete · стандартные кнопки из оригинала

### 6.8 Extensions
Рендерятся через стандартные `scripts_img2img` hooks.
CSS: `contain: layout style` на каждом extension контейнере.
Мобильный: collapsed по умолчанию.
Десктоп: inline справа.
Порядок в списке: ControlNet/Balance → ADetailer → ImageStitch → Reactor → Regional Prompter → остальные.

### 6.9 Extras Tab
`modules/ui_postprocessing.create_ui()` — без изменений.

---

## 7. Mobile CSS

- CSS containment extensions: `contain: layout style`
- Mobile-first base + `@media (min-width: 768px)` desktop overrides
- High specificity scope: `.klein-ui .gradio-container` перекрывает extension стили
- Sticky generate: `position: sticky; bottom: calc(56px + env(safe-area-inset-bottom, 0px))`
- Bottom nav: `height: 56px; position: fixed; bottom: 0`
- Main content: `padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px))`

---

## 8. Файлы и пути

| Ресурс | Путь |
|---|---|
| Styles CSV | `webui/styles.csv` |
| Config Presets (img2img) | `webui/extensions/Config-Presets/config-img2img.json` |
| Models | `webui/models/` |
| Extensions | `webui/extensions/` |
| Output | `webui/output/` |
| environment.bat | `H:\Forge-Neo-v3.2-sage\environment.bat` |

---

## 9. Дизайн-система

### Цветовые токены
| Токен | Значение | Назначение |
|---|---|---|
| `--accent-primary` | `#6366f1` (Indigo) | Кнопки, активные элементы, акценты |
| `--accent-secondary` | `#8b5cf6` (Violet) | Градиенты, hover, LoRA panel |
| `--accent-gradient` | `linear-gradient(135deg, #6366f1, #8b5cf6)` | Generate button, ⊞ кнопка |
| `--surface` | `#0f0f1a` | Основной фон |
| `--surface-2` | `rgba(255,255,255,0.03)` | Карточки параметров |
| `--surface-accent` | `rgba(99,102,241,0.08)` | Model bar, акцентные поверхности |
| `--border` | `rgba(255,255,255,0.06)` | Базовые границы |
| `--border-accent` | `rgba(99,102,241,0.2)` | Границы акцентных элементов |
| `--text-primary` | `#e0e0e0` | Основной текст |
| `--text-muted` | `#555` | Лейблы, плейсхолдеры |
| `--success` | `#10b981` (Emerald) | ADetailer dot, success states |
| `--warning` | `#f59e0b` | ImageStitch dot |
| `--nav-glass` | `rgba(0,0,0,0.6)` + `blur(20px)` | Bottom nav фон |

### Компоненты
- **Generate button**: градиент accent-gradient, `border-radius: 8px`, `box-shadow: 0 4px 20px rgba(99,102,241,0.4)`
- **Param cards**: `background: surface-2`, `border: 1px solid border`, `border-radius: 6px`
- **Слайдеры**: градиентный трек, custom thumb 12px круглый
- **Bottom nav**: glassmorphism, `backdrop-filter: blur(20px)`
- **Active tab**: цвет accent-primary, `border-bottom: 2px solid accent-primary`
- **Preset badge**: градиент accent-gradient, `font-weight: 600`
- **Extension dots**: цветные индикаторы (indigo/emerald/amber) по типу расширения

### Принципы
- Mobile-first: все компоненты проектируются для `390px`, затем адаптируются для `768px+`
- Touch targets: минимум `44px` по высоте для кликабельных элементов
- Glassmorphism только для навигационных слоёв (bottom nav, popover)
- Параметры в карточках — избегаем голых слайдеров без контейнера
- CSS custom properties для всех токенов — легко менять тему

---

## 10. Что НЕ входит в v1
- txt2img вкладка
- Gallery / история генераций
- PNG Info tab
- Checkpoint Merger
- Settings tab (только быстрые через Model Bar)
- Собственные пути моделей (используем shared)
