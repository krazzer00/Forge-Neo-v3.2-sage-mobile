/* ==========================================================================
   presets.js — «Config Presets» (расширение Config-Presets)
   Читает config-txt2img.json / config-img2img.json и применяет значения
   к параметрам мобильного интерфейса, включая ControlNet и ADetailer.
   ========================================================================== */
import {
  h, icon, I, API, toast, haptic, openSheet, closeSheet, pickSheet, confirmSheet, store,
} from './core.js';
import { S, saveParams, persistExt, clone } from './state.js';
import { refreshExtensions } from './extensions.js';

let CACHE = null;

export async function loadPresets(force) {
  if (CACHE && !force) return CACHE;
  try {
    CACHE = await API.get('/api/presets');
  } catch (e) {
    CACHE = { ok: false, txt2img: {}, img2img: {}, error: e.message };
  }
  return CACHE;
}

/* ------------------------------------------------------------------------ */
/*  Маппинг: ключ компонента Forge  ->  поле параметров мобильного UI        */
/* ------------------------------------------------------------------------ */
const COMMON = (p) => ({
  [p + '_sampling']: 'sampler_name',
  [p + '_scheduler']: 'scheduler',
  [p + '_steps']: 'steps',
  [p + '_width']: 'width',
  [p + '_height']: 'height',
  [p + '_batch_count']: 'n_iter',
  [p + '_batch_size']: 'batch_size',
  [p + '_cfg_scale']: 'cfg_scale',
  [p + '_distilled_cfg_scale']: 'distilled_cfg_scale',
  [p + '_prompt']: 'prompt',
  [p + '_neg_prompt']: 'negative_prompt',
  [p + '_styles']: 'styles',
  [p + '_seed']: 'seed',
  [p + '_subseed']: 'subseed',
  [p + '_subseed_strength']: 'subseed_strength',
  [p + '_seed_resize_from_w']: 'seed_resize_from_w',
  [p + '_seed_resize_from_h']: 'seed_resize_from_h',
  [p + '_tiling']: 'tiling',
});

const T2I_MAP = Object.assign(COMMON('txt2img'), {
  'txt2img_hr-checkbox': 'enable_hr',
  txt2img_hr_scale: 'hr_scale',
  txt2img_hr_upscaler: 'hr_upscaler',
  txt2img_hires_steps: 'hr_second_pass_steps',
  txt2img_denoising_strength: 'denoising_strength',
  txt2img_hr_resize_x: 'hr_resize_x',
  txt2img_hr_resize_y: 'hr_resize_y',
  hr_sampler: 'hr_sampler_name',
  hr_scheduler: 'hr_scheduler',
  hires_prompt: 'hr_prompt',
  hires_neg_prompt: 'hr_negative_prompt',
});

const I2I_MAP = Object.assign(COMMON('img2img'), {
  img2img_denoising_strength: 'i2i_denoise',
  resize_mode: 'resize_mode',
  img2img_scale: 'i2i_scale_by',
  img2img_mask_blur: 'mask_blur',
  img2img_inpainting_fill: 'inpainting_fill',
  img2img_inpaint_full_res: 'inpaint_full_res',
  img2img_inpaint_full_res_padding: 'inpaint_full_res_padding',
  img2img_mask_mode: 'inpainting_mask_invert',
});

/* ControlNet: суффикс ключа -> поле юнита */
const CN_MAP = {
  enable_checkbox: 'enabled',
  low_vram_checkbox: 'low_vram',
  pixel_perfect_checkbox: 'pixel_perfect',
  type_filter_radio: 'type_filter',
  preprocessor_dropdown: 'module',
  model_dropdown: 'model',
  control_weight_slider: 'weight',
  control_mode_radio: 'control_mode',
  resize_mode_radio: 'resize_mode',
  start_control_step_slider: 'guidance_start',
  ending_control_step_slider: 'guidance_end',
  preprocessor_resolution_slider: 'processor_res',
  threshold_a_slider: 'threshold_a',
  threshold_b_slider: 'threshold_b',
};

/* ------------------------------------------------------------------------ */
/*  Применение пресета                                                       */
/* ------------------------------------------------------------------------ */
export function applyPreset(mode, params, preset) {
  const map = mode === 'txt2img' ? T2I_MAP : I2I_MAP;
  const applied = [];

  for (const [key, raw] of Object.entries(preset || {})) {
    /* 1. обычные поля */
    if (map[key] !== undefined) {
      let v = raw;
      if (map[key] === 'hr_sampler_name' && /use same/i.test(String(v))) v = '';
      if (map[key] === 'hr_scheduler' && /use same/i.test(String(v))) v = '';
      if (map[key] === 'inpaint_full_res') v = !!v;
      if (map[key] === 'inpainting_mask_invert') v = Number(v) ? 1 : 0;
      params[map[key]] = v;
      applied.push(map[key]);
      continue;
    }
    /* 2. ControlNet */
    const cn = key.match(/^(?:txt2img|img2img)_controlnet_ControlNet-(\d+)_controlnet_(.+)$/);
    if (cn) { applyCN(mode, parseInt(cn[1], 10), cn[2], raw); continue; }

    /* 3. ADetailer */
    const ad = key.match(/^script_(?:txt2img|img2img)_adetailer_(.+)$/);
    if (ad) { applyAD(mode, ad[1], raw); continue; }
  }

  /* нормализация чисел */
  ['steps', 'width', 'height', 'n_iter', 'batch_size'].forEach((k) => {
    if (params[k] !== undefined) params[k] = Math.round(Number(params[k]) || 0) || 1;
  });
  return applied.length;
}

function unitsOf(mode, script) {
  const vals = S.ext[mode] && S.ext[mode][script];
  return vals || null;
}

function applyCN(mode, idx, field, raw) {
  const vals = unitsOf(mode, 'controlnet');
  if (!vals || !vals[idx] || typeof vals[idx] !== 'object') return;
  const unit = vals[idx];

  if (field === 'control_step_slider' && Array.isArray(raw)) {
    unit.guidance_start = raw[0];
    unit.guidance_end = raw[1];
    return;
  }
  const target = CN_MAP[field];
  if (!target || !(target in unit)) return;
  unit[target] = raw;
}

const AD_UNIT_SUFFIX = { '': 2, _2nd: 3, _3rd: 4, _4th: 5 };

function applyAD(mode, rest, raw) {
  const vals = unitsOf(mode, 'adetailer');
  if (!vals) return;

  if (rest === 'ad_main_accordion-checkbox') { vals[0] = !!raw; return; }

  let suffix = '';
  let field = rest;
  const m = rest.match(/^(.*?)(_2nd|_3rd|_4th)$/);
  if (m) { field = m[1]; suffix = m[2]; }
  const idx = AD_UNIT_SUFFIX[suffix];
  const unit = vals[idx];
  if (!unit || typeof unit !== 'object') return;

  /* start/end влияния ControlNet в API хранятся парой */
  if (field === 'ad_controlnet_guidance_start' || field === 'ad_controlnet_guidance_end') {
    const cur = Array.isArray(unit.ad_controlnet_guidance_start_end)
      ? unit.ad_controlnet_guidance_start_end.slice() : [0, 1];
    cur[field.endsWith('start') ? 0 : 1] = raw;
    unit.ad_controlnet_guidance_start_end = cur;
    return;
  }
  if (field in unit) {
    unit[field] = raw;
    if (field === 'ad_model' && raw && raw !== 'None') unit.ad_tab_enable = true;
  }
}

/* ------------------------------------------------------------------------ */
/*  Сбор текущих значений в формат пресета                                   */
/* ------------------------------------------------------------------------ */
export function collectPreset(mode, params) {
  const map = mode === 'txt2img' ? T2I_MAP : I2I_MAP;
  const out = {};
  for (const [key, field] of Object.entries(map)) {
    let v = params[field];
    if (v === undefined) continue;
    if (field === 'hr_sampler_name' && !v) v = 'Use same sampler';
    if (field === 'hr_scheduler' && !v) v = 'Use same scheduler';
    if (field === 'inpaint_full_res') v = v ? 1 : 0;
    out[key] = v;
  }
  /* ControlNet */
  const cn = unitsOf(mode, 'controlnet');
  if (cn) {
    cn.forEach((unit, i) => {
      if (!unit || typeof unit !== 'object') return;
      const pre = mode + '_controlnet_ControlNet-' + i + '_controlnet_';
      for (const [suffix, field] of Object.entries(CN_MAP)) {
        if (field in unit) out[pre + suffix] = unit[field];
      }
      out[pre + 'control_step_slider'] = [unit.guidance_start, unit.guidance_end];
    });
  }
  /* ADetailer */
  const ad = unitsOf(mode, 'adetailer');
  if (ad) {
    out['script_' + mode + '_adetailer_ad_main_accordion-checkbox'] = !!ad[0];
    for (const [suffix, idx] of Object.entries(AD_UNIT_SUFFIX)) {
      const unit = ad[idx];
      if (!unit || typeof unit !== 'object') continue;
      for (const [k, v] of Object.entries(unit)) {
        if (k === 'ad_controlnet_guidance_start_end' && Array.isArray(v)) {
          out['script_' + mode + '_adetailer_ad_controlnet_guidance_start' + suffix] = v[0];
          out['script_' + mode + '_adetailer_ad_controlnet_guidance_end' + suffix] = v[1];
          continue;
        }
        if (typeof v === 'object' && v !== null) continue;
        out['script_' + mode + '_adetailer_' + k + suffix] = v;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/*  UI-блок                                                                  */
/* ------------------------------------------------------------------------ */
export function PresetBlock(mode, params, onApplied) {
  const key = mode === 'txt2img' ? 't2i' : 'i2i';
  const valEl = h('div', { class: 'val dim' }, 'Не выбран');
  let names = [];

  const selectBtn = h('button', {
    class: 'select',
    onclick: async () => {
      haptic();
      const data = await loadPresets();
      names = Object.keys(data[mode] || {});
      if (!names.length) {
        toast(data.error || 'Пресеты не найдены', 'err');
        return;
      }
      pickSheet({
        title: 'Config Presets',
        items: names.map((n) => ({ value: n, label: n })),
        value: store.get('preset.' + mode, ''),
        onPick: (n) => apply(n),
      });
    },
  }, valEl, icon(I.chevronDown, 18));

  async function apply(name) {
    const data = await loadPresets();
    const preset = (data[mode] || {})[name];
    if (!preset) { toast('Пресет не найден', 'err'); return; }
    const n = applyPreset(mode, params, preset);
    saveParams(key, params);
    persistExt(mode);
    refreshExtensions(mode);
    store.set('preset.' + mode, name);
    valEl.textContent = name;
    valEl.classList.remove('dim');
    if (onApplied) onApplied();
    toast('Пресет применён: ' + name + (n ? '' : ' (нет полей)'), 'ok');
    haptic(15);
  }

  const saved = store.get('preset.' + mode, '');
  if (saved) { valEl.textContent = saved; valEl.classList.remove('dim'); }

  const saveBtn = h('button', {
    class: 'btn', style: { flex: '0 0 46px' },
    onclick: () => saveSheet(),
  }, icon(I.download, 18));

  const delBtn = h('button', {
    class: 'btn', style: { flex: '0 0 46px' },
    onclick: async () => {
      const cur = store.get('preset.' + mode, '');
      if (!cur) { toast('Пресет не выбран'); return; }
      const ok = await confirmSheet('Удалить пресет?', cur, 'Удалить');
      if (!ok) return;
      try {
        const r = await API.post('/api/presets', { mode, name: cur, delete: true });
        if (!r.ok) throw new Error(r.error || 'ошибка');
        CACHE = null;
        store.del('preset.' + mode);
        valEl.textContent = 'Не выбран';
        valEl.classList.add('dim');
        toast('Удалён', 'ok');
      } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
    },
  }, icon(I.trash, 18));

  function saveSheet() {
    const input = h('input', {
      type: 'text', placeholder: 'Имя пресета',
      value: store.get('preset.' + mode, ''),
    });
    const go = async () => {
      const name = input.value.trim();
      if (!name) { toast('Введите имя', 'err'); return; }
      try {
        const r = await API.post('/api/presets', {
          mode, name, values: collectPreset(mode, params),
        });
        if (!r.ok) throw new Error(r.error || 'ошибка');
        CACHE = null;
        store.set('preset.' + mode, name);
        valEl.textContent = name;
        valEl.classList.remove('dim');
        closeSheet();
        toast('Сохранён: ' + name, 'ok');
      } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
    };
    openSheet({
      title: 'Сохранить пресет',
      body: h('div', null,
        h('div', { class: 'muted', style: { marginBottom: '10px' } },
          'Текущие параметры, ControlNet и ADetailer будут записаны в конфиг расширения Config-Presets. Существующий пресет с тем же именем будет перезаписан.'),
        input,
        h('button', { class: 'btn primary wide', style: { marginTop: '10px' }, onclick: go },
          icon(I.download, 18), 'Сохранить')),
    });
    setTimeout(() => input.focus(), 320);
  }

  return h('div', { class: 'card card-pad' },
    h('div', { class: 'label' }, 'Config Presets',
      h('span', { class: 'hint' }, 'из расширения Forge')),
    h('div', { class: 'row' }, selectBtn, saveBtn, delBtn));
}
