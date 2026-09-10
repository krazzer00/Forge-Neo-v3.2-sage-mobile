/* ==========================================================================
   state.js — глобальное состояние приложения
   ========================================================================== */
import { API, store, toast } from './core.js';

export const S = {
  boot: null,          // ответ /api/bootstrap
  loras: null,
  embeddings: null,
  ready: false,
  busy: false,         // идёт генерация
  taskId: null,        // id текущей задачи Forge (force_task_id)
  progress: null,      // последний ответ /internal/progress
  tab: 'txt2img',
  /* Параметры вкладок */
  t2i: null,
  i2i: null,
  /* значения расширений: ext[mode][scriptName] = [...args] */
  ext: { txt2img: {}, img2img: {} },
  extDefaults: { txt2img: {}, img2img: {} },
  /* изображения расширений: extImages[mode][scriptName][argIndex] = base64.
     Хранятся только в памяти — в localStorage они не помещаются. */
  extImages: { txt2img: {}, img2img: {} },
  /* последние результаты */
  results: { txt2img: [], img2img: [], extras: [] },
  /* буфер обмена изображений между вкладками */
  transfer: null,
};

export const DEFAULT_PARAMS = () => ({
  prompt: '',
  negative_prompt: '',
  styles: [],
  sampler_name: 'Euler',
  scheduler: 'Automatic',
  steps: 20,
  cfg_scale: 7,
  distilled_cfg_scale: 3.5,
  width: 1024,
  height: 1024,
  n_iter: 1,
  batch_size: 1,
  seed: -1,
  subseed: -1,
  subseed_strength: 0,
  seed_resize_from_w: -1,
  seed_resize_from_h: -1,
  restore_faces: false,
  tiling: false,
  clip_skip: 1,
  /* hires */
  enable_hr: false,
  hr_scale: 2,
  hr_upscaler: 'Latent',
  hr_second_pass_steps: 0,
  hr_resize_x: 0,
  hr_resize_y: 0,
  hr_cfg: 1,
  hr_distilled_cfg: 3.5,
  hr_sampler_name: '',
  hr_scheduler: '',
  hr_prompt: '',
  hr_negative_prompt: '',
  denoising_strength: 0.7,
  /* img2img */
  resize_mode: 0,
  i2i_denoise: 0.75,
  mask_blur: 4,
  inpainting_fill: 1,
  inpaint_full_res: true,
  inpaint_full_res_padding: 32,
  inpainting_mask_invert: 0,
  i2i_mode: 'img2img',        // img2img | inpaint
  i2i_scale_mode: 'to',       // to | by
  i2i_scale_by: 1,
  /* сервис */
  save_images: true,
  script_name: '',
  script_args: {},
});

export function loadParams(key) {
  const saved = store.get('params.' + key, null);
  const def = DEFAULT_PARAMS();
  return saved ? Object.assign(def, saved) : def;
}

export function saveParams(key, params) {
  const copy = Object.assign({}, params);
  store.set('params.' + key, copy);
}

/* ------------------------- загрузка справочников ------------------------ */
export async function bootstrap(onStatus) {
  const say = onStatus || (() => {});
  say('Подключение к Forge…');
  let data = null;
  for (let i = 0; i < 120; i++) {
    try {
      data = await API.get('/api/bootstrap');
      if (data && data.ok) break;
    } catch (e) { /* ignore */ }
    say('Ожидание запуска Forge… (' + (i + 1) + ')');
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (!data || !data.ok) throw new Error('Forge недоступен');
  S.boot = data;

  /* значения расширений по умолчанию */
  for (const mode of ['txt2img', 'img2img']) {
    const map = {};
    (data.script_info[mode] || []).forEach((s) => {
      map[s.name] = (s.args || []).map((a) => clone(a.value));
    });
    S.extDefaults[mode] = map;
    const savedExt = store.get('ext.' + mode, null);
    S.ext[mode] = {};
    for (const [name, def] of Object.entries(map)) {
      const prev = savedExt && savedExt[name];
      S.ext[mode][name] = prev && prev.length === def.length ? mergeArgs(def, prev) : clone(def);
    }
  }

  S.t2i = loadParams('t2i');
  S.i2i = loadParams('i2i');
  applyPresetDefaults();
  S.ready = true;
  return data;
}

/** Слияние сохранённых значений с дефолтами (защита от смены версии расширения) */
function mergeArgs(def, prev) {
  return def.map((d, i) => {
    const p = prev[i];
    if (p === undefined) return clone(d);
    if (isPlainObject(d) && isPlainObject(p)) {
      const out = clone(d);
      for (const k of Object.keys(out)) if (k in p) out[k] = clone(p[k]);
      return out;
    }
    if (typeof d === typeof p || d === null) return clone(p);
    return clone(d);
  });
}

export function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Значения по умолчанию из forge_preset (шаги / cfg / сэмплер) */
export function applyPresetDefaults(force) {
  const o = (S.boot && S.boot.options) || {};
  const p = o.forge_preset || 'sd';
  const t = S.t2i, i = S.i2i;
  const g = (k, d) => (o[k] !== undefined && o[k] !== null ? o[k] : d);
  if (force || !store.get('params.t2i', null)) {
    t.sampler_name = g(p + '_t2i_sampler', t.sampler_name);
    t.scheduler = g(p + '_t2i_scheduler', t.scheduler);
    t.steps = g(p + '_t2i_step', t.steps);
    t.cfg_scale = g(p + '_t2i_cfg', t.cfg_scale);
    t.distilled_cfg_scale = g(p + '_t2i_dcfg', t.distilled_cfg_scale);
    t.hr_second_pass_steps = g(p + '_t2i_hr_step', t.hr_second_pass_steps);
    t.hr_cfg = g(p + '_t2i_hr_cfg', t.hr_cfg);
    t.hr_distilled_cfg = g(p + '_t2i_hr_dcfg', t.hr_distilled_cfg);
    const w = g(p + '_t2i_width', 0), hgt = g(p + '_t2i_height', 0);
    if (w) t.width = w;
    if (hgt) t.height = hgt;
    t.clip_skip = g('CLIP_stop_at_last_layers', t.clip_skip);
  }
  if (force || !store.get('params.i2i', null)) {
    i.sampler_name = g(p + '_i2i_sampler', i.sampler_name);
    i.scheduler = g(p + '_i2i_scheduler', i.scheduler);
    i.steps = g(p + '_i2i_step', i.steps);
    i.cfg_scale = g(p + '_i2i_cfg', i.cfg_scale);
    i.distilled_cfg_scale = g(p + '_i2i_dcfg', i.distilled_cfg_scale);
    i.clip_skip = g('CLIP_stop_at_last_layers', i.clip_skip);
  }
}

export function persistExt(mode) {
  store.set('ext.' + mode, S.ext[mode]);
}

export async function ensureLoras(force) {
  if (S.loras && !force) return S.loras;
  try {
    S.loras = await API.get('/api/loras' + (force ? '?refresh=1' : ''));
  } catch (e) {
    toast('Не удалось получить список LoRA', 'err');
    S.loras = [];
  }
  return S.loras;
}

export async function ensureEmbeddings(force) {
  if (S.embeddings && !force) return S.embeddings;
  try {
    S.embeddings = await API.get('/api/embeddings' + (force ? '?refresh=1' : ''));
  } catch (e) { S.embeddings = []; }
  return S.embeddings;
}

export function currentCheckpoint() {
  const o = (S.boot && S.boot.options) || {};
  return o.sd_model_checkpoint || '—';
}

export function currentModules() {
  const o = (S.boot && S.boot.options) || {};
  return o.forge_additional_modules || [];
}
