/* ==========================================================================
   extensions.js — динамический UI для расширений Forge (alwayson + скрипты)
   Панели строятся автоматически из /sdapi/v1/script-info, поэтому любые
   расширения, установленные в Forge, доступны в мобильном интерфейсе.
   ========================================================================== */
import { h, icon, I, toast, b64Only, haptic } from './core.js';
import { Slider, Select, Switch, TextField, NumField, Accordion, ImagePicker } from './ui.js';
import { S, clone, isPlainObject, persistExt } from './state.js';

/* Скрипты, которые не показываем: пустые, дублирующие основные поля,
   либо имеющие собственную панель (imagestitch — блок «Референсы»). */
const HIDDEN = new Set(['extra options', 'openoutpaint', 'sampler', 'seed',
  'imagestitch integrated']);

/* Порядок вывода — самые востребованные сверху */
const ORDER = [
  'adetailer', 'controlnet', 'regional prompter', 'detail daemon', 'teacache',
  'reactor', 'forge fluxkontext', 'soft inpainting', 'multidiffusion integrated',
  'imagestitch integrated', 'spectrum integrated', 'style selector for sdxl 1.0',
  'fooocus prompt expansion', 'lora keywords finder', 'never oom integrated',
  'torch compile integrated',
];

/* Человекочитаемые названия панелей */
const TITLES = {
  'adetailer': 'ADetailer — авто-детейлинг',
  'controlnet': 'ControlNet',
  'regional prompter': 'Regional Prompter',
  'detail daemon': 'Detail Daemon',
  'teacache': 'TeaCache (ускорение)',
  'reactor': 'ReActor — замена лиц',
  'forge fluxkontext': 'Forge FluxKontext',
  'soft inpainting': 'Soft Inpainting',
  'multidiffusion integrated': 'MultiDiffusion',
  'imagestitch integrated': 'ImageStitch',
  'spectrum integrated': 'Spectrum',
  'style selector for sdxl 1.0': 'SDXL Styles',
  'fooocus prompt expansion': 'Fooocus Expansion',
  'lora keywords finder': 'LoRA Keywords Finder',
  'never oom integrated': 'Never OOM',
  'torch compile integrated': 'Torch Compile',
  'x/y/z plot': 'X/Y/Z plot',
  'prompt matrix': 'Матрица промптов',
  'prompts from file or textbox': 'Промпты из файла/текста',
  'one button prompt': 'One Button Prompt',
  'sd upscale': 'SD Upscale',
  'ultimate sd upscale': 'Ultimate SD Upscale',
  'loopback': 'Loopback',
  'mosaic inpaint': 'Mosaic Inpaint',
  'differential regional prompter': 'Differential Regional Prompter',
};

/* Русские подписи часто встречающихся полей */
const LABELS = {
  enabled: 'Включить', enable: 'Включить',
  weight: 'Вес', model: 'Модель', module: 'Препроцессор',
  prompt: 'Промпт', negative_prompt: 'Негативный промпт',
  resize_mode: 'Режим масштабирования', control_mode: 'Режим управления',
  guidance_start: 'Старт влияния', guidance_end: 'Конец влияния',
  processor_res: 'Разрешение препроцессора', threshold_a: 'Порог A',
  threshold_b: 'Порог B', pixel_perfect: 'Pixel Perfect', low_vram: 'Low VRAM',
  hr_option: 'Для Hires', type_filter: 'Тип управления',
  mask_image: 'Маска', image: 'Изображение',
  ad_controlnet_guidance_start_end: 'CN диапазон влияния',
  ad_model: 'Модель детекции', ad_model_classes: 'Классы модели',
  ad_tab_enable: 'Включить юнит', ad_prompt: 'Промпт', ad_negative_prompt: 'Негатив',
  ad_confidence: 'Порог уверенности', ad_mask_filter_method: 'Фильтр масок',
  ad_mask_k: 'Кол-во масок (k)', ad_mask_min_ratio: 'Мин. площадь маски',
  ad_mask_max_ratio: 'Макс. площадь маски', ad_x_offset: 'Смещение X',
  ad_y_offset: 'Смещение Y', ad_dilate_erode: 'Расширение/сжатие маски',
  ad_mask_merge_invert: 'Слияние/инверсия масок', ad_mask_blur: 'Размытие маски',
  ad_denoising_strength: 'Denoise', ad_inpaint_only_masked: 'Только маска',
  ad_inpaint_only_masked_padding: 'Отступ маски',
  ad_use_inpaint_width_height: 'Свои размеры', ad_inpaint_width: 'Ширина',
  ad_inpaint_height: 'Высота', ad_use_steps: 'Свои шаги', ad_steps: 'Шаги',
  ad_use_cfg_scale: 'Свой CFG', ad_cfg_scale: 'CFG',
  ad_use_checkpoint: 'Своя модель', ad_checkpoint: 'Чекпоинт',
  ad_use_vae: 'Свой VAE', ad_vae: 'VAE',
  ad_use_sampler: 'Свой сэмплер', ad_sampler: 'Сэмплер', ad_scheduler: 'Планировщик',
  ad_use_noise_multiplier: 'Множитель шума', ad_noise_multiplier: 'Шум',
  ad_use_clip_skip: 'Свой CLIP skip', ad_clip_skip: 'CLIP skip',
  ad_restore_face: 'Восстановление лица',
  ad_controlnet_model: 'ControlNet модель', ad_controlnet_module: 'ControlNet препроцессор',
  ad_controlnet_weight: 'ControlNet вес',
  ad_controlnet_guidance_start: 'CN старт', ad_controlnet_guidance_end: 'CN конец',
  source_image: 'Изображение-источник', target_image: 'Целевое изображение',
  upscaler: 'Апскейлер', scale: 'Масштаб', device: 'Устройство',
  face_restorer: 'Восстановление лиц', codeformer_weight: 'Вес CodeFormer',
  mask_blur: 'Размытие маски', denoising_strength: 'Denoise',
  steps: 'Шаги', cfg_scale: 'CFG', sampler: 'Сэмплер', scheduler: 'Планировщик',
  width: 'Ширина', height: 'Высота', seed: 'Seed',
};

/* Метаданные полей: выбор из справочников приложения */
function fieldMeta(key) {
  const B = S.boot || {};
  const cn = B.controlnet || {};
  switch (key) {
    case 'module':
    case 'ad_controlnet_module':
      return { choices: cn.modules };
    case 'model':
    case 'ad_controlnet_model':
      return { choices: cn.models };
    case 'resize_mode':
      return { choices: ['Just Resize', 'Crop and Resize', 'Resize and Fill'] };
    case 'control_mode':
      return { choices: ['Balanced', 'My prompt is more important', 'ControlNet is more important'] };
    case 'hr_option':
      return { choices: ['Both', 'Low res only', 'High res only'] };
    case 'ad_model':
      return { choices: ['None'].concat(B.adetailer_models || []) };
    case 'ad_checkpoint':
      return { choices: ['Use same checkpoint'].concat((B.checkpoints || []).map((c) => c.title)) };
    case 'ad_vae':
      return { choices: ['Use same VAE'].concat((B.modules || []).map((m) => m.name)) };
    case 'ad_sampler':
      return { choices: B.samplers || [] };
    case 'ad_scheduler':
      return { choices: ['Use same scheduler'].concat(B.schedulers || []) };
    case 'ad_mask_merge_invert':
      return { choices: ['None', 'Merge', 'Merge and Invert'] };
    case 'ad_mask_filter_method':
      return { choices: ['Area', 'Confidence'] };
    case 'upscaler':
      return { choices: B.upscalers || [] };
    case 'face_restorer':
      return { choices: ['None'].concat(B.face_restorers || []) };
    case 'device':
      return { choices: ['CPU', 'CUDA'] };
    case 'type_filter':
      return { choices: Object.keys(cn.control_types || { All: 1 }) };
    default:
      return null;
  }
}

const IMAGE_KEYS = new Set(['image', 'mask_image', 'image_fg', 'mask_image_fg',
  'generated_image', 'input_image', 'source_image', 'target_image']);
const SKIP_KEYS = new Set(['use_preview_as_input', 'generated_image', 'image_fg',
  'mask_image_fg', 'batch_images', 'batch_image_dir', 'batch_mask_dir',
  'batch_input_gallery', 'batch_mask_gallery', 'ipadapter_input',
  'save_detected_map', 'advanced_weighting', 'effective_region_mask',
  'pulid_mode', 'union_control_type', '_idx']);

function pretty(key) {
  if (LABELS[key]) return LABELS[key];
  return String(key)
    .replace(/^ad_/, '')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------------ */
/*  Рендер одного значения                                                   */
/* ------------------------------------------------------------------------ */
function buildControl(label, key, value, defValue, onSet, forcedChoices) {
  const meta = fieldMeta(key) || {};
  const choices = forcedChoices || meta.choices;

  if (typeof value === 'boolean') {
    return Switch({ label, value, onChange: onSet }).el;
  }
  if (choices && choices.length) {
    return Select({
      label, items: choices, value,
      onChange: onSet,
      placeholder: '—',
    }).el;
  }
  if (typeof value === 'number') {
    const rng = guessRange(key, value, defValue);
    if (rng) {
      return Slider({
        label, min: rng.min, max: rng.max, step: rng.step, value,
        onChange: onSet,
      }).el;
    }
    return NumField({ label, value, onChange: onSet }).el;
  }
  if (typeof value === 'string') {
    const multi = /prompt|text|tags|keyword|wildcard/i.test(key) || value.length > 48;
    return TextField({ label, value, multiline: multi, rows: 2, onChange: onSet }).el;
  }
  return null;
}

function guessRange(key, v, def) {
  const base = Number.isFinite(def) ? def : v;
  if (/weight|strength|ratio|confidence|visibility|threshold_?$|denois|_start$|_end$|alpha|bias|scale_factor/i.test(key)
      && Math.abs(base) <= 1.001) {
    return { min: 0, max: 1, step: 0.01 };
  }
  if (/steps?$/i.test(key)) return { min: 0, max: 150, step: 1 };
  if (/cfg/i.test(key)) return { min: 0, max: 30, step: 0.1 };
  if (/width|height|resolution|_res$|padding|size/i.test(key)) return { min: 0, max: 2048, step: 8 };
  if (/blur/i.test(key)) return { min: 0, max: 64, step: 1 };
  if (/dilate|erode|offset/i.test(key)) return { min: -256, max: 256, step: 1 };
  if (Number.isInteger(base) && Math.abs(base) <= 100) return { min: 0, max: 100, step: 1 };
  if (Math.abs(base) <= 1.001 && !Number.isInteger(base)) return { min: 0, max: 1, step: 0.01 };
  return null;
}

/* ------------------------------------------------------------------------ */
/*  Рендер словаря (юнит ControlNet / ADetailer и т.п.)                      */
/* ------------------------------------------------------------------------ */
function buildDict(obj, defObj, onChange) {
  const box = h('div');
  const keys = Object.keys(obj);
  /* сперва enable-подобные, затем остальные */
  keys.sort((a, b) => rank(a) - rank(b));
  for (const k of keys) {
    if (SKIP_KEYS.has(k)) continue;
    const v = obj[k];
    if (IMAGE_KEYS.has(k)) {
      const picker = ImagePicker({
        label: pretty(k),
        height: '150px',
        onChange: (d) => { obj[k] = d ? b64Only(d) : null; onChange(); },
      });
      if (typeof v === 'string' && v) picker.set('data:image/png;base64,' + v);
      box.append(picker.el);
      continue;
    }
    if (v === null || v === undefined) continue;
    if (isPlainObject(v) || Array.isArray(v)) continue;
    const ctl = buildControl(pretty(k), k, v, defObj ? defObj[k] : undefined, (nv) => {
      obj[k] = nv; onChange();
    });
    if (ctl) box.append(ctl);
  }
  return box;
}

function rank(k) {
  if (/^(enabled|enable|ad_tab_enable)$/.test(k)) return 0;
  if (/model|module/.test(k)) return 1;
  if (/prompt/.test(k)) return 2;
  return 5;
}

/* ------------------------------------------------------------------------ */
/*  Панели alwayson-скриптов                                                 */
/* ------------------------------------------------------------------------ */
const CONTAINERS = {};

/** Перерисовать панели расширений (после применения пресета и т.п.) */
export function refreshExtensions(mode) {
  const root = CONTAINERS[mode];
  if (root) rerender(mode, root);
}

export function renderExtensions(mode, root) {
  CONTAINERS[mode] = root;
  const info = (S.boot.script_info[mode] || []).filter((s) => s.is_alwayson && !HIDDEN.has(s.name));
  info.sort((a, b) => {
    const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  info.forEach((script) => {
    const vals = S.ext[mode][script.name];
    const defs = S.extDefaults[mode][script.name];
    if (!vals) return;

    const title = TITLES[script.name] || pretty(script.name);
    const acc = Accordion({ title, indicator: true, open: false });

    const markActive = () => {
      const active = JSON.stringify(vals) !== JSON.stringify(defs)
        || hasExtImages(mode, script.name);
      acc.setActive(active);
    };
    const changed = () => { markActive(); persistExt(mode); };

    const body = h('div');
    if (HINTS[script.name]) {
      body.append(h('div', { class: 'muted', style: { marginBottom: '10px' } },
        HINTS[script.name]));
    }
    (script.args || []).forEach((arg, idx) => {
      const v = vals[idx];
      const label = (arg.label || '').trim();

      if (isPlainObject(v)) {
        const sub = Accordion({
          title: label || unitName(script.name, idx),
          indicator: true, open: false,
        });
        sub.body.append(buildDict(v, defs[idx], () => {
          changed();
          sub.setActive(JSON.stringify(v) !== JSON.stringify(defs[idx]));
        }));
        sub.setActive(JSON.stringify(v) !== JSON.stringify(defs[idx]));
        body.append(sub.el);
        return;
      }
      /* аргумент-изображение: value = null, распознаётся по подписи */
      if (v === null || v === undefined) {
        const imgLabel = imageArgLabel(script.name, idx, label);
        if (!imgLabel) return;
        const picker = ImagePicker({
          label: imgLabel,
          height: '160px',
          extraButtons: [h('button', {
            class: 'btn',
            onclick: () => window.dispatchEvent(new CustomEvent('fm:pickFromBrowser', {
              detail: {
                cb: (d) => { picker.set(d); setExtImage(mode, script.name, idx, d); changed(); },
              },
            })),
          }, icon(I.folder, 18), 'Из папок')],
          onChange: (d) => { setExtImage(mode, script.name, idx, d); changed(); },
        });
        const prev = extImage(mode, script.name, idx);
        if (prev) picker.set(prev);
        body.append(picker.el);
        return;
      }
      if (Array.isArray(v) || argHidden(script.name, idx)) return;

      const ctl = buildControl(
        argLabel(script.name, idx, label) || pretty('arg_' + idx),
        labelKey(label, idx),
        v, defs[idx],
        (nv) => { vals[idx] = nv; changed(); },
        indexChoices(script.name, idx)
          || (arg.choices && arg.choices.length
            ? arg.choices.map((c) => (Array.isArray(c) ? c[0] : c)) : null),
      );
      if (ctl) body.append(ctl);
    });

    body.append(h('button', {
      class: 'btn wide', style: { marginTop: '8px' },
      onclick: () => {
        S.ext[mode][script.name] = clone(defs);
        if (S.extImages[mode]) delete S.extImages[mode][script.name];
        persistExt(mode);
        toast('Сброшено: ' + title);
        rerender(mode, root);
      },
    }, icon(I.refresh, 18), 'Сбросить'));

    acc.body.append(body);
    markActive();
    root.append(acc.el);
  });
}

function labelKey(label, idx) {
  return String(label || ('arg' + idx)).toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/* ------------------------------------------------------------------------ */
/*  Аргументы-изображения расширений                                         */
/*                                                                           */
/*  В script-info у таких аргументов value = null, поэтому распознать их      */
/*  можно только по названию скрипта и подписи. Значения хранятся отдельно    */
/*  (S.extImages) и подставляются при сборке payload — в localStorage         */
/*  картинки не помещаются.                                                  */
/* ------------------------------------------------------------------------ */
const IMAGE_ARGS = {
  'reactor': { 0: 'Лицо-источник' },
  'forge fluxkontext': { 1: 'Референс 1', 2: 'Референс 2' },
};

/* Аргументы, которые выглядят как изображения, но через API не работают */
const IMAGE_ARG_SKIP = {
  'reactor': [25],              // gr.Files — список файлов, не base64
  'regional prompter': [16],    // polymask, помечен в расширении как нерабочий
};

/* ------------------------------------------------------------------------ */
/*  Понятные подписи и скрытие служебных аргументов                          */
/* ------------------------------------------------------------------------ */
const ARG_LABELS = {
  'reactor': {
    2: 'Лица в источнике · 0 = первое',
    3: 'Лица в результате · 0 = первое',
    4: 'Модель замены',
    5: 'Восстановление лица',
    6: 'Сила восстановления',
    7: 'Сначала восстановить лицо, потом апскейл',
    8: 'Апскейлер',
    9: 'Масштаб',
    10: 'Видимость апскейла (при масштабе 1)',
    11: 'Заменять в исходном изображении',
    12: 'Заменять в результате',
    13: 'Уровень лога в консоли',
    14: 'Определение пола (источник)',
    15: 'Определение пола (цель)',
    16: 'Сохранять оригинал',
    17: 'Вес CodeFormer',
    18: 'Кэш по хэшу источника',
    19: 'Кэш по хэшу цели',
    20: 'Устройство',
    21: 'Коррекция маски лица',
    22: 'Откуда брать лицо',
    23: 'Модель лица',
    24: 'Папка с лицами',
    26: 'Случайное лицо из папки',
    27: 'Апскейл даже без лиц',
    28: 'Порог детекции',
    29: 'Макс. лиц · 0 = все',
  },
  'forge fluxkontext': {
    3: 'Размер / кроп референсов',
    4: 'Уменьшить референсы вдвое',
  },
};

/* Служебные аргументы: уходят в Forge как есть, но в интерфейсе не нужны */
const ARG_HIDDEN = {
  'reactor': [30],              // selected_tab = "tab_single"
};

/* Короткие памятки в начале панели */
const HINTS = {
  'reactor': 'Чтобы сработало: загрузите лицо-источник, включите ReActor и '
    + 'оставьте оба поля с номерами лиц равными 0 (0 — первое найденное лицо). '
    + '«Заменять в результате» должно быть включено.',
  'forge fluxkontext': 'Работает только с моделями Flux.1-Kontext. Для FLUX.2 '
    + 'Klein используйте блок «Референсы персонажа» выше.',
};

function argLabel(scriptName, idx, label) {
  const map = ARG_LABELS[scriptName];
  if (map && map[idx]) return map[idx];
  return label;
}

function argHidden(scriptName, idx) {
  const list = ARG_HIDDEN[scriptName];
  return !!(list && list.includes(idx));
}

function imageArgLabel(scriptName, idx, label) {
  const skip = IMAGE_ARG_SKIP[scriptName];
  if (skip && skip.includes(idx)) return null;
  const known = IMAGE_ARGS[scriptName];
  if (known && known[idx]) return known[idx];
  const l = String(label || '');
  if (/multiple|folder|files/i.test(l)) return null;
  if (/\b(image|img|mask|source|face)\b/i.test(l)) return l;
  return null;
}

/* ------------------------------------------------------------------------ */
/*  Аргументы gradio с type="index"                                          */
/*                                                                           */
/*  Такие Radio/Dropdown отдают скрипту НОМЕР варианта, а не его текст.       */
/*  В script-info приходит текст, поэтому при отправке его нужно превратить   */
/*  обратно в индекс — иначе расширение молча не срабатывает (например,       */
/*  ReActor сравнивает select_source == 0 и при строке "Image(s)" пропускает  */
/*  замену лица).                                                            */
/* ------------------------------------------------------------------------ */
const GENDER = ['No', 'Female Only', 'Male Only'];

export const INDEX_ARGS = {
  'reactor': {
    13: ['No log', 'Minimum', 'Default'],   // Console Log Level
    14: GENDER,                             // Gender Detection (Source)
    15: GENDER,                             // Gender Detection (Target)
    22: ['Image(s)', 'Face Model', 'Folder'], // Select Source
  },
  'ultimate sd upscale': {
    8: null,                                 // Upscaler — список берётся из bootstrap
    10: ['Linear', 'Chess', 'None'],         // Redraw type
    13: ['None', 'Band pass', 'Half tile offset pass',
      'Half tile offset pass + intersections'], // Seams fix type
    14: ['From img2img2 settings', 'Custom size', 'Scale from image size'],
  },
};

function indexChoices(scriptName, idx) {
  const map = INDEX_ARGS[scriptName];
  if (!map || !(idx in map)) return null;
  const list = map[idx];
  if (list) return list;
  /* null означает «взять из справочников Forge» (сейчас только апскейлеры) */
  return (S.boot && S.boot.upscalers) || null;
}

/** Заменяет текстовые значения на индексы там, где gradio ждёт номер */
function applyIndexArgs(scriptName, args) {
  const map = INDEX_ARGS[scriptName];
  if (!map) return args;
  Object.keys(map).forEach((k) => {
    const idx = Number(k);
    const choices = indexChoices(scriptName, idx);
    if (!choices) return;
    const v = args[idx];
    if (typeof v !== 'string') return;
    const pos = choices.indexOf(v);
    if (pos >= 0) args[idx] = pos;
  });
  return args;
}

export function extImage(mode, name, idx) {
  const m = S.extImages[mode] && S.extImages[mode][name];
  return m ? m[idx] : null;
}

export function setExtImage(mode, name, idx, dataUrl) {
  S.extImages[mode] = S.extImages[mode] || {};
  S.extImages[mode][name] = S.extImages[mode][name] || {};
  if (dataUrl) S.extImages[mode][name][idx] = dataUrl;
  else delete S.extImages[mode][name][idx];
}

function hasExtImages(mode, name) {
  const m = S.extImages[mode] && S.extImages[mode][name];
  return !!(m && Object.keys(m).length);
}

function unitName(scriptName, idx) {
  if (scriptName === 'adetailer') return 'Юнит ' + (idx - 1);
  if (scriptName === 'controlnet') return 'Юнит ' + (idx + 1);
  return 'Группа ' + (idx + 1);
}

function rerender(mode, root) {
  root.textContent = '';
  renderExtensions(mode, root);
}

/* ------------------------------------------------------------------------ */
/*  Сборка alwayson_scripts для payload                                      */
/* ------------------------------------------------------------------------ */
export function collectAlwayson(mode) {
  const out = {};
  const info = S.boot.script_info[mode] || [];
  info.forEach((s) => {
    if (!s.is_alwayson || HIDDEN.has(s.name)) return;
    const vals = S.ext[mode][s.name];
    const defs = S.extDefaults[mode][s.name];
    if (!vals) return;

    const args = clone(vals);
    const imgs = S.extImages[mode] && S.extImages[mode][s.name];
    if (imgs) {
      for (const [idx, dataUrl] of Object.entries(imgs)) {
        if (dataUrl) args[Number(idx)] = b64Only(dataUrl);
      }
    }
    if (JSON.stringify(args) === JSON.stringify(defs)) return; // не трогаем дефолт
    out[s.name] = { args: applyIndexArgs(s.name, args) };
  });
  return out;
}

export function activeExtensionNames(mode) {
  return Object.keys(collectAlwayson(mode)).map((n) => TITLES[n] || n);
}

/* ------------------------------------------------------------------------ */
/*  Обычные (не alwayson) скрипты                                            */
/* ------------------------------------------------------------------------ */
export function renderScriptPanel(mode, params) {
  const list = (S.boot.script_info[mode] || []).filter((s) => !s.is_alwayson);
  const box = h('div');
  const argsBox = h('div');
  const names = ['', ...list.map((s) => s.name)];

  const sel = Select({
    label: 'Скрипт',
    items: names.map((n) => ({ value: n, label: n ? (TITLES[n] || pretty(n)) : 'Нет' })),
    value: params.script_name || '',
    onChange: (v) => { params.script_name = v; drawArgs(); },
  });

  function drawArgs() {
    argsBox.textContent = '';
    const s = list.find((x) => x.name === params.script_name);
    if (!s) return;
    if (!params.script_args || params.script_args.__name !== s.name) {
      params.script_args = { __name: s.name, vals: (s.args || []).map((a) => clone(a.value)) };
    }
    const vals = params.script_args.vals;
    (s.args || []).forEach((arg, i) => {
      const v = vals[i];
      if (v === null || v === undefined || isPlainObject(v) || Array.isArray(v)) return;
      const ctl = buildControl(
        arg.label || ('Параметр ' + (i + 1)),
        labelKey(arg.label, i), v, arg.value,
        (nv) => { vals[i] = nv; },
        indexChoices(s.name, i)
          || (arg.choices && arg.choices.length
            ? arg.choices.map((c) => (Array.isArray(c) ? c[0] : c)) : null),
      );
      if (ctl) argsBox.append(ctl);
    });
  }
  drawArgs();
  box.append(sel.el, argsBox);
  return box;
}

export function collectScript(params) {
  if (!params.script_name) return {};
  const a = params.script_args;
  return {
    script_name: params.script_name,
    script_args: a && a.__name === params.script_name
      ? applyIndexArgs(params.script_name, clone(a.vals)) : [],
  };
}
