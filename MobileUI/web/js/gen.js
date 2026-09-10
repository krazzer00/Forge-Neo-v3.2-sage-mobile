/* ==========================================================================
   gen.js — общие блоки формы, сборка payload, запуск генерации и прогресс
   ========================================================================== */
import {
  h, $, icon, I, API, toast, haptic, store, openSheet, closeSheet, pickSheet,
  confirmSheet, lightbox, downloadDataURL, asDataURL,
} from './core.js';
import {
  Slider, Select, Switch, TextField, Accordion, CardTitle,
} from './ui.js';
import { S, saveParams, ensureLoras, ensureEmbeddings } from './state.js';
import { renderExtensions, renderScriptPanel, collectAlwayson, collectScript } from './extensions.js';
import { stitchArgs, charPayload } from './characters.js';

/* ======================================================================== */
/*  Блок промптов                                                            */
/* ======================================================================== */
export function promptBlock(params, key) {
  const pos = h('textarea', {
    class: 'prompt', placeholder: 'Промпт…', rows: 4,
    oninput: (e) => { params.prompt = e.target.value; count(); save(); },
  });
  pos.value = params.prompt || '';
  const neg = h('textarea', {
    class: 'neg', placeholder: 'Негативный промпт…', rows: 2,
    oninput: (e) => { params.negative_prompt = e.target.value; save(); },
  });
  neg.value = params.negative_prompt || '';

  const cnt = h('div', { class: 'tokcount' }, '0');
  const count = () => {
    const t = (params.prompt || '').trim();
    cnt.textContent = t ? String(t.split(/[\s,]+/).filter(Boolean).length) + ' тег.' : '0';
  };
  count();

  const save = () => saveParams(key, params);

  const insert = (txt) => {
    const el = document.activeElement === neg ? neg : pos;
    const start = el.selectionStart === null || el.selectionStart === undefined
      ? el.value.length : el.selectionStart;
    const before = el.value.slice(0, start);
    const after = el.value.slice(start);
    const sep = before && !/[\s,]$/.test(before) ? ', ' : '';
    el.value = before + sep + txt + after;
    el.dispatchEvent(new Event('input'));
    el.focus();
    el.selectionStart = (before + sep + txt).length;
    el.selectionEnd = el.selectionStart;
  };

  const stylesBtn = h('button', { class: 'ptool', onclick: () => stylesSheet(params, key, updStyles) },
    icon(I.star, 16), h('span', null, 'Стили'));
  const updStyles = () => {
    const n = (params.styles || []).length;
    stylesBtn.classList.toggle('accent', n > 0);
    stylesBtn.querySelector('span').textContent = n ? `Стили (${n})` : 'Стили';
  };
  updStyles();

  const refresh = () => {
    pos.value = params.prompt || '';
    neg.value = params.negative_prompt || '';
    count(); updStyles();
  };

  const tools = h('div', { class: 'prompt-tools' },
    h('button', { class: 'ptool', onclick: () => loraSheet(insert) }, icon(I.layers, 16), 'LoRA'),
    h('button', { class: 'ptool', onclick: () => embSheet(insert) }, icon(I.tag, 16), 'Embed'),
    stylesBtn,
    h('button', { class: 'ptool', onclick: () => historySheet(params, key, refresh) },
      icon(I.recycle, 16), 'История'),
    h('button', {
      class: 'ptool', onclick: () => {
        const t = params.prompt;
        params.prompt = params.negative_prompt;
        params.negative_prompt = t;
        refresh(); save(); haptic();
      },
    }, '⇅ Поменять'),
    h('button', {
      class: 'ptool', onclick: () => {
        params.prompt = ''; params.negative_prompt = '';
        refresh(); save(); haptic();
      },
    }, icon(I.trash, 16), 'Очистить'));

  const box = h('div', { class: 'card card-pad' },
    h('div', { class: 'prompt-wrap' }, pos, cnt),
    h('div', { style: { height: '8px' } }),
    neg, tools);
  box.refreshPrompt = refresh;
  return box;
}

function stylesSheet(params, key, upd) {
  const items = (S.boot.styles || []).map((s) => ({
    value: s.name, label: s.name,
    sub: (s.prompt || '').slice(0, 60) || (s.negative_prompt ? 'только негатив' : ''),
  }));
  pickSheet({
    title: 'Стили', items, multi: true, value: params.styles || [],
    onPick: (v) => { params.styles = v; saveParams(key, params); upd(); },
  });
}

async function loraSheet(insert) {
  const box = h('div', null,
    h('div', { class: 'muted', style: { padding: '20px', textAlign: 'center' } }, 'Загрузка…'));
  openSheet({ title: 'LoRA', body: box, full: true });
  const list = await ensureLoras();
  const grid = h('div', { class: 'lora-grid' });

  const draw = (q) => {
    grid.textContent = '';
    const src = q ? list.filter((l) => (l.name + ' ' + l.dir).toLowerCase().includes(q)) : list;
    const arr = src.slice(0, 300);
    if (!arr.length) { grid.append(h('div', { class: 'muted' }, 'Ничего не найдено')); return; }
    const frag = document.createDocumentFragment();
    arr.forEach((l) => {
      const im = l.preview
        ? h('img', { class: 'ph', loading: 'lazy', src: '/api/thumb?size=200&path=' + encodeURIComponent(l.preview) })
        : h('div', { class: 'ph' });
      frag.append(h('button', {
        class: 'lora-card',
        onclick: () => {
          insert('<lora:' + l.alias + ':1>' + (l.act ? ', ' + l.act : ''));
          haptic(); closeSheet();
        },
      }, im, h('div', { class: 'ln' }, l.name)));
    });
    grid.append(frag);
  };
  draw('');
  box.textContent = '';
  box.append(h('input', {
    type: 'search', placeholder: 'Поиск LoRA…', style: { marginBottom: '10px' },
    oninput: (e) => draw(e.target.value.trim().toLowerCase()),
  }), grid);
}

async function embSheet(insert) {
  const list = await ensureEmbeddings();
  pickSheet({
    title: 'Embeddings',
    items: list.map((e) => ({ value: e.name, label: e.name, sub: e.loaded ? 'загружен' : 'пропущен' })),
    onPick: (v) => { insert(v); haptic(); },
  });
}

function historySheet(params, key, apply) {
  const hist = store.get('history', []);
  if (!hist.length) { toast('История пуста'); return; }

  const list = h('div');
  const draw = () => {
    list.textContent = '';
    const cur = store.get('history', []);
    if (!cur.length) {
      list.append(h('div', { class: 'muted', style: { padding: '20px', textAlign: 'center' } },
        'История пуста'));
      return;
    }
    cur.forEach((x, i) => {
      list.append(h('div', { class: 'opt', style: { alignItems: 'flex-start' } },
        h('div', {
          class: 'oname', style: { whiteSpace: 'normal' },
          onclick: () => {
            params.prompt = x.p;
            params.negative_prompt = x.n || '';
            saveParams(key, params); apply(); haptic();
            closeSheet();
          },
        }, (x.p || '(пусто)').slice(0, 140), h('span', { class: 'osub' }, x.t)),
        h('button', {
          class: 'btn', style: { flex: '0 0 40px', padding: '8px' },
          onclick: () => {
            const arr = store.get('history', []);
            arr.splice(i, 1);
            store.set('history', arr);
            haptic(); draw();
          },
        }, icon(I.close, 16))));
    });
  };
  draw();

  const body = h('div', null,
    h('button', {
      class: 'btn danger wide', style: { marginBottom: '10px' },
      onclick: async () => {
        const ok = await confirmSheet('Очистить историю промптов?',
          'Будут удалены все ' + store.get('history', []).length + ' записей.', 'Очистить');
        if (!ok) return;
        store.set('history', []);
        toast('История очищена', 'ok');
        draw();
      },
    }, icon(I.trash, 18), 'Очистить историю'),
    list);

  openSheet({ title: 'История промптов', body, full: true });
}

export function pushHistory(params) {
  if (!params.prompt) return;
  const hist = store.get('history', []);
  if (hist[0] && hist[0].p === params.prompt) return;
  hist.unshift({ p: params.prompt, n: params.negative_prompt, t: new Date().toLocaleString('ru-RU') });
  store.set('history', hist.slice(0, 60));
}

/* ======================================================================== */
/*  Пресеты размера                                                          */
/* ======================================================================== */
const DEFAULT_SIZES = [
  { group: 'Square', items: [[1024, 1024]] },
  { group: 'Portrait', items: [[640, 1536], [768, 1344], [832, 1216], [896, 1152]] },
  { group: 'Landscape', items: [[1536, 640], [1344, 768], [1216, 832], [1152, 896]] },
];

function userSizes() { return store.get('sizePresets', []); }

/** Все пресеты: встроенные + пользовательские, сгруппированные, без дублей */
function allSizes() {
  const groups = DEFAULT_SIZES.map((g) => ({
    group: g.group, items: g.items.map((it) => it.slice()),
  }));
  const seen = new Set();
  groups.forEach((g) => g.items.forEach(([w, hh]) => seen.add(w + 'x' + hh)));

  userSizes().forEach((c) => {
    const kkey = c.w + 'x' + c.h;
    if (seen.has(kkey)) return;
    seen.add(kkey);
    const gname = c.group || 'Свои';
    const exist = groups.find((x) => x.group === gname);
    if (exist) exist.items.push([c.w, c.h]);
    else groups.push({ group: gname, items: [[c.w, c.h]] });
  });
  return groups;
}

/** Пользовательский пресет (можно удалить долгим нажатием) */
function isCustom(w, h) {
  const builtin = DEFAULT_SIZES.some((g) => g.items.some(([a, b]) => a === w && b === h));
  if (builtin) return false;
  return userSizes().some((c) => c.w === w && c.h === h);
}

/** Есть ли такой размер среди любых пресетов */
function isKnownSize(w, h) {
  return DEFAULT_SIZES.some((g) => g.items.some(([a, b]) => a === w && b === h))
    || userSizes().some((c) => c.w === w && c.h === h);
}

function sizeGroupOf(w, h) {
  if (w === h) return 'Square';
  return w < h ? 'Portrait' : 'Landscape';
}

function sizeSheet(params, onPick) {
  const body = h('div');

  const draw = () => {
    body.textContent = '';
    allSizes().forEach((g) => {
      body.append(h('div', { class: 'card-title' }, g.group));
      const box = h('div', { class: 'chips', style: { marginBottom: '6px' } });
      g.items.forEach(([w, hgt]) => {
        const on = Math.round(params.width) === w && Math.round(params.height) === hgt;
        const chip = h('button', {
          class: 'chip' + (on ? ' on' : ''),
          onclick: () => { onPick(w, hgt); haptic(); closeSheet(); },
        }, w + ' × ' + hgt);
        if (isCustom(w, hgt)) {
          chip.addEventListener('contextmenu', (e) => e.preventDefault());
          let timer = null;
          const start = () => {
            timer = setTimeout(async () => {
              const ok = await confirmSheet('Удалить пресет?', w + ' × ' + hgt, 'Удалить');
              if (!ok) return;
              store.set('sizePresets', userSizes().filter((c) => !(c.w === w && c.h === hgt)));
              draw();
            }, 600);
          };
          const stop = () => clearTimeout(timer);
          chip.addEventListener('touchstart', start, { passive: true });
          chip.addEventListener('touchend', stop);
          chip.addEventListener('touchmove', stop);
          chip.addEventListener('mousedown', start);
          chip.addEventListener('mouseup', stop);
          chip.addEventListener('mouseleave', stop);
        }
        box.append(chip);
      });
      body.append(box);
    });

    body.append(h('div', { class: 'divider' }),
      h('button', {
        class: 'btn primary wide', style: { marginBottom: '8px' },
        onclick: () => {
          const w = Math.round(params.width), hgt = Math.round(params.height);
          if (isKnownSize(w, hgt)) { toast('Такой пресет уже есть'); return; }
          const arr = userSizes();
          arr.push({ w, h: hgt, group: sizeGroupOf(w, hgt) });
          store.set('sizePresets', arr);
          toast('Добавлен пресет ' + w + ' × ' + hgt, 'ok');
          draw();
        },
      }, icon(I.plus, 18),
      'Добавить текущий: ' + Math.round(params.width) + ' × ' + Math.round(params.height)),
      h('div', { class: 'muted', style: { textAlign: 'center' } },
        'Свои пресеты удаляются долгим нажатием'));
  };
  draw();
  openSheet({ title: 'Размер изображения', body, full: true });
}

/* ======================================================================== */
/*  Основные параметры                                                       */
/* ======================================================================== */

export function coreBlock(params, key) {
  const save = () => saveParams(key, params);
  const B = S.boot;

  const sampler = Select({
    label: 'Сэмплер', items: B.samplers, value: params.sampler_name,
    onChange: (v) => { params.sampler_name = v; save(); },
  });
  const sched = Select({
    label: 'Планировщик', items: B.schedulers, value: params.scheduler,
    onChange: (v) => { params.scheduler = v; save(); },
  });
  const steps = Slider({
    label: 'Шаги', min: 1, max: 150, step: 1, value: params.steps,
    onChange: (v) => { params.steps = v; save(); },
  });
  const cfg = Slider({
    label: 'CFG Scale', min: 1, max: 30, step: 0.5, value: params.cfg_scale,
    onChange: (v) => { params.cfg_scale = v; save(); },
  });
  const dcfg = Slider({
    label: 'Distilled CFG', min: 0, max: 30, step: 0.1, value: params.distilled_cfg_scale,
    hint: 'Flux / Klein / Z-Image',
    onChange: (v) => { params.distilled_cfg_scale = v; save(); },
  });

  const mpHint = h('div', { class: 'muted', style: { marginBottom: '10px' } }, '');
  const mpWarn = h('div', { class: 'warnbox', hidden: true }, '');
  let syncSizeLabel = () => {};
  const updMp = () => {
    syncSizeLabel();
    const mp = (params.width * params.height) / 1e6;
    mpHint.textContent = `${Math.round(params.width)}×${Math.round(params.height)} · ${mp.toFixed(2)} Мп`;
    const big = mp > 2.4;
    mpWarn.hidden = !big;
    if (big) {
      mpWarn.textContent = 'Большое разрешение — при нехватке VRAM Forge может ' +
        'аварийно завершиться. Уменьшите размер или включите Never OOM.';
    }
  };

  const wS = Slider({
    label: 'Ширина', min: 64, max: 4096, step: 8, value: params.width,
    onChange: (v) => { params.width = v; save(); updMp(); },
  });
  const hS = Slider({
    label: 'Высота', min: 64, max: 4096, step: 8, value: params.height,
    onChange: (v) => { params.height = v; save(); updMp(); },
  });

  const applySize = (w, hgt) => {
    params.width = w; params.height = hgt;
    wS.set(w); hS.set(hgt); save(); updMp();
  };

  const sizeVal = h('div', { class: 'val' }, '');
  const updSizeBtn = () => {
    sizeVal.textContent = Math.round(params.width) + ' × ' + Math.round(params.height);
  };
  syncSizeLabel = updSizeBtn;
  const sizeRow = h('div', { class: 'row', style: { marginBottom: '10px' } },
    h('button', {
      class: 'select',
      onclick: () => sizeSheet(params, (w, hgt) => { applySize(w, hgt); updSizeBtn(); }),
    }, sizeVal, icon(I.chevronDown, 18)),
    h('button', {
      class: 'btn', style: { flex: '0 0 46px' },
      onclick: () => {
        applySize(Math.round(params.height), Math.round(params.width));
        updSizeBtn(); haptic();
      },
    }, '⇄'),
    h('button', {
      class: 'btn', style: { flex: '0 0 46px' },
      onclick: () => {
        const w = Math.round(params.width), hgt = Math.round(params.height);
        if (isKnownSize(w, hgt)) { toast('Такой пресет уже есть'); return; }
        const arr = userSizes();
        arr.push({ w, h: hgt, group: sizeGroupOf(w, hgt) });
        store.set('sizePresets', arr);
        toast('Пресет ' + w + ' × ' + hgt + ' добавлен', 'ok'); haptic();
      },
    }, icon(I.plus, 18)));
  updSizeBtn();

  const nIter = Slider({
    label: 'Batch count', min: 1, max: 32, step: 1, value: params.n_iter,
    onChange: (v) => { params.n_iter = v; save(); },
  });
  const bSize = Slider({
    label: 'Batch size', min: 1, max: 16, step: 1, value: params.batch_size,
    onChange: (v) => { params.batch_size = v; save(); },
  });

  const seedInput = h('input', {
    type: 'number', value: params.seed, inputmode: 'numeric',
    oninput: (e) => { params.seed = parseInt(e.target.value, 10); save(); },
  });
  const seedRow = h('div', { class: 'row' },
    seedInput,
    h('button', {
      class: 'btn', style: { flex: '0 0 46px' },
      onclick: () => { params.seed = -1; seedInput.value = -1; save(); haptic(); },
    }, icon(I.dice, 18)),
    h('button', {
      class: 'btn', style: { flex: '0 0 46px' },
      onclick: () => {
        const last = S.results[key === 't2i' ? 'txt2img' : 'img2img'];
        const s = last && last.length ? last[0].seed : null;
        if (s === null || s === undefined) { toast('Нет предыдущего seed'); return; }
        params.seed = s; seedInput.value = s; save(); haptic();
      },
    }, icon(I.recycle, 18)));

  const varAcc = Accordion({ title: 'Вариации и разрешение seed', open: false });
  varAcc.body.append(
    Slider({
      label: 'Сила вариации', min: 0, max: 1, step: 0.01, value: params.subseed_strength,
      onChange: (v) => { params.subseed_strength = v; save(); },
    }).el,
    TextField({
      label: 'Subseed', value: params.subseed, inputmode: 'numeric',
      onChange: (v) => { params.subseed = parseInt(v, 10) || -1; save(); },
    }).el,
    h('div', { class: 'row' },
      TextField({
        label: 'Resize from W', value: params.seed_resize_from_w,
        onChange: (v) => { params.seed_resize_from_w = parseInt(v, 10) || -1; save(); },
      }).el,
      TextField({
        label: 'Resize from H', value: params.seed_resize_from_h,
        onChange: (v) => { params.seed_resize_from_h = parseInt(v, 10) || -1; save(); },
      }).el),
    Switch({
      label: 'Tiling', value: params.tiling,
      onChange: (v) => { params.tiling = v; save(); },
    }).el,
    Slider({
      label: 'CLIP skip', min: 1, max: 12, step: 1, value: params.clip_skip,
      onChange: (v) => { params.clip_skip = v; save(); },
    }).el);

  const box = h('div', { class: 'card card-pad' },
    h('div', { class: 'row' }, sampler.el, sched.el),
    steps.el, cfg.el, dcfg.el);

  const sizeBox = h('div', { class: 'card card-pad' },
    h('div', { class: 'label' }, 'Размер', h('span', { class: 'hint' }, 'пресеты')),
    sizeRow, wS.el, hS.el, mpHint, mpWarn,
    h('div', { class: 'row' }, nIter.el, bSize.el),
    h('div', { class: 'label' }, 'Seed'), seedRow,
    h('div', { style: { height: '10px' } }), varAcc.el);
  updMp();

  return {
    el: h('div', null, box, sizeBox),
    refresh() {
      sampler.set(params.sampler_name); sched.set(params.scheduler);
      steps.set(params.steps); cfg.set(params.cfg_scale); dcfg.set(params.distilled_cfg_scale);
      wS.set(params.width); hS.set(params.height);
      nIter.set(params.n_iter); bSize.set(params.batch_size);
      seedInput.value = params.seed;
      updMp(); updSizeBtn();
    },
  };
}

/* ======================================================================== */
/*  Hires.fix                                                                */
/* ======================================================================== */
export function hiresBlock(params, key) {
  const save = () => saveParams(key, params);
  const B = S.boot;
  const acc = Accordion({ title: 'Hires. fix', indicator: true, open: false });
  const sw = Switch({
    label: 'Включить Hires. fix', value: params.enable_hr,
    onChange: (v) => { params.enable_hr = v; acc.setActive(v); save(); },
  });
  acc.setActive(params.enable_hr);

  const upsc = ['Latent', 'Latent (antialiased)', 'Latent (bicubic)',
    'Latent (bicubic antialiased)', 'Latent (nearest)', 'Latent (nearest-exact)']
    .concat(B.upscalers || []);

  const upscaler = Select({
    label: 'Апскейлер', items: upsc, value: params.hr_upscaler,
    onChange: (v) => { params.hr_upscaler = v; save(); },
  });
  const scale = Slider({
    label: 'Множитель', min: 1, max: 4, step: 0.05, value: params.hr_scale,
    onChange: (v) => { params.hr_scale = v; save(); },
  });
  const denoise = Slider({
    label: 'Denoising strength', min: 0, max: 1, step: 0.01, value: params.denoising_strength,
    onChange: (v) => { params.denoising_strength = v; save(); },
  });
  const hrSteps = Slider({
    label: 'Шаги Hires', min: 0, max: 150, step: 1, value: params.hr_second_pass_steps,
    hint: '0 = как основные', onChange: (v) => { params.hr_second_pass_steps = v; save(); },
  });
  const rx = Slider({
    label: 'Resize X', min: 0, max: 4096, step: 8, value: params.hr_resize_x,
    onChange: (v) => { params.hr_resize_x = v; save(); },
  });
  const ry = Slider({
    label: 'Resize Y', min: 0, max: 4096, step: 8, value: params.hr_resize_y,
    onChange: (v) => { params.hr_resize_y = v; save(); },
  });
  const hcfg = Slider({
    label: 'Hires CFG', min: 0, max: 30, step: 0.1, value: params.hr_cfg,
    onChange: (v) => { params.hr_cfg = v; save(); },
  });
  const hdcfg = Slider({
    label: 'Hires Distilled CFG', min: 0, max: 30, step: 0.1, value: params.hr_distilled_cfg,
    onChange: (v) => { params.hr_distilled_cfg = v; save(); },
  });
  const hsampler = Select({
    label: 'Сэмплер Hires', items: ['', ...(B.samplers || [])],
    value: params.hr_sampler_name, placeholder: 'Как основной',
    onChange: (v) => { params.hr_sampler_name = v; save(); },
  });
  const hsched = Select({
    label: 'Планировщик Hires', items: ['', ...(B.schedulers || [])],
    value: params.hr_scheduler, placeholder: 'Как основной',
    onChange: (v) => { params.hr_scheduler = v; save(); },
  });
  const hprompt = TextField({
    label: 'Промпт Hires', value: params.hr_prompt, multiline: true, rows: 2,
    placeholder: 'пусто = как основной',
    onChange: (v) => { params.hr_prompt = v; save(); },
  });
  const hneg = TextField({
    label: 'Негатив Hires', value: params.hr_negative_prompt, multiline: true, rows: 2,
    placeholder: 'пусто = как основной',
    onChange: (v) => { params.hr_negative_prompt = v; save(); },
  });

  acc.body.append(sw.el, upscaler.el, scale.el, denoise.el, hrSteps.el,
    h('div', { class: 'row' }, rx.el, ry.el),
    hcfg.el, hdcfg.el, hsampler.el, hsched.el, hprompt.el, hneg.el);

  return {
    el: acc.el,
    refresh() {
      sw.set(params.enable_hr); acc.setActive(params.enable_hr);
      upscaler.set(params.hr_upscaler); scale.set(params.hr_scale);
      denoise.set(params.denoising_strength); hrSteps.set(params.hr_second_pass_steps);
      rx.set(params.hr_resize_x); ry.set(params.hr_resize_y);
      hcfg.set(params.hr_cfg); hdcfg.set(params.hr_distilled_cfg);
      hsampler.set(params.hr_sampler_name); hsched.set(params.hr_scheduler);
      hprompt.set(params.hr_prompt); hneg.set(params.hr_negative_prompt);
    },
  };
}

/* ======================================================================== */
/*  Блоки расширений и скриптов                                              */
/* ======================================================================== */
export function extensionsBlock(mode) {
  const box = h('div');
  renderExtensions(mode, box);
  return h('div', null, CardTitle('Расширения Forge'), box);
}

export function scriptBlock(mode, params) {
  const acc = Accordion({ title: 'Скрипт', open: false });
  acc.body.append(renderScriptPanel(mode, params));
  return acc.el;
}

/* ======================================================================== */
/*  Результаты                                                               */
/* ======================================================================== */
export function resultBlock(mode) {
  const stage = h('div', { class: 'result-stage' });
  const strip = h('div', { class: 'result-strip' });
  const actions = h('div', { class: 'result-actions' });
  const wrap = h('div', { class: 'result' }, stage, strip, actions);
  let items = [];
  let idx = 0;

  const empty = () => {
    stage.textContent = '';
    stage.append(h('div', { class: 'result-empty' }, icon(I.image, 38),
      h('div', null, 'Результат появится здесь')));
    strip.textContent = '';
    actions.textContent = '';
  };

  const showLive = (b64) => {
    stage.textContent = '';
    stage.append(h('img', { src: asDataURL(b64, 'image/jpeg'), alt: '' }),
      h('div', { class: 'livebadge' }, h('i'), 'ПРЕДПРОСМОТР'));
  };

  const openViewer = () => {
    lightbox(items.map((x) => ({ url: x.url, name: x.name })), idx, {
      buttons: [
        { label: 'Сохранить', icon: I.download, run: (it) => downloadDataURL(it.url, it.name) },
        {
          label: 'В img2img', icon: I.send,
          run: (it, i, ctx) => {
            ctx.close();
            window.dispatchEvent(new CustomEvent('fm:send',
              { detail: { to: 'img2img', url: it.url, info: items[i].info } }));
          },
        },
        {
          label: 'В Extras', icon: I.wand,
          run: (it, i, ctx) => {
            ctx.close();
            window.dispatchEvent(new CustomEvent('fm:send',
              { detail: { to: 'extras', url: it.url, info: items[i].info } }));
          },
        },
        {
          label: 'Параметры', icon: I.info,
          run: (it, i, ctx) => {
            ctx.infoBox.textContent = items[i].info || 'нет данных';
            ctx.infoBox.hidden = !ctx.infoBox.hidden;
          },
        },
      ],
    });
  };

  const select = (i) => {
    idx = i;
    stage.textContent = '';
    stage.append(h('img', { src: items[i].url, alt: '', onclick: openViewer }));
    Array.from(strip.children).forEach((c, n) => c.classList.toggle('on', n === i));
  };

  const set = (list) => {
    items = list;
    S.results[mode] = list;
    if (!list.length) { empty(); return; }
    strip.textContent = '';
    list.forEach((it, i) => strip.append(h('img', { src: it.url, alt: '', onclick: () => select(i) })));
    strip.hidden = list.length < 2;
    actions.textContent = '';
    actions.append(
      h('button', { class: 'btn', onclick: () => downloadDataURL(items[idx].url, items[idx].name) },
        icon(I.download, 18), 'Сохранить'),
      h('button', {
        class: 'btn', onclick: () => window.dispatchEvent(new CustomEvent('fm:send',
          { detail: { to: 'img2img', url: items[idx].url, info: items[idx].info } })),
      }, icon(I.send, 18), 'В img2img'),
      h('button', {
        class: 'btn', onclick: () => window.dispatchEvent(new CustomEvent('fm:send',
          { detail: { to: 'extras', url: items[idx].url, info: items[idx].info } })),
      }, icon(I.wand, 18), 'В Extras'),
      h('button', { class: 'btn', onclick: openViewer }, icon(I.search, 18), 'Просмотр'));
    select(0);
  };

  empty();
  return { el: wrap, set, showLive, clear: empty, get items() { return items; } };
}

/* ======================================================================== */
/*  Сборка payload                                                           */
/* ======================================================================== */
export function basePayload(params, mode) {
  const p = {
    prompt: params.prompt || '',
    negative_prompt: params.negative_prompt || '',
    styles: params.styles || [],
    sampler_name: params.sampler_name,
    scheduler: params.scheduler,
    steps: Math.round(params.steps),
    cfg_scale: params.cfg_scale,
    distilled_cfg_scale: params.distilled_cfg_scale,
    width: Math.round(params.width),
    height: Math.round(params.height),
    n_iter: Math.round(params.n_iter),
    batch_size: Math.round(params.batch_size),
    seed: Number.isFinite(params.seed) ? params.seed : -1,
    subseed: Number.isFinite(params.subseed) ? params.subseed : -1,
    subseed_strength: params.subseed_strength || 0,
    seed_resize_from_w: params.seed_resize_from_w === undefined ? -1 : params.seed_resize_from_w,
    seed_resize_from_h: params.seed_resize_from_h === undefined ? -1 : params.seed_resize_from_h,
    tiling: !!params.tiling,
    restore_faces: !!params.restore_faces,
    send_images: true,
    save_images: params.save_images !== false,
    override_settings: { CLIP_stop_at_last_layers: Math.round(params.clip_skip || 1) },
    override_settings_restore_afterwards: false,
    alwayson_scripts: collectAlwayson(mode),
  };
  const stitch = stitchArgs();
  if (stitch) p.alwayson_scripts['ImageStitch Integrated'] = { args: stitch };
  Object.assign(p, collectScript(params));
  return p;
}

export function txt2imgPayload(params) {
  const p = basePayload(params, 'txt2img');
  p.enable_hr = !!params.enable_hr;
  if (p.enable_hr) {
    p.hr_scale = params.hr_scale;
    p.hr_upscaler = params.hr_upscaler;
    p.hr_second_pass_steps = Math.round(params.hr_second_pass_steps || 0);
    p.hr_resize_x = Math.round(params.hr_resize_x || 0);
    p.hr_resize_y = Math.round(params.hr_resize_y || 0);
    p.hr_cfg = params.hr_cfg;
    p.hr_distilled_cfg = params.hr_distilled_cfg;
    p.denoising_strength = params.denoising_strength;
    if (params.hr_sampler_name) p.hr_sampler_name = params.hr_sampler_name;
    if (params.hr_scheduler) p.hr_scheduler = params.hr_scheduler;
    if (params.hr_prompt) p.hr_prompt = params.hr_prompt;
    if (params.hr_negative_prompt) p.hr_negative_prompt = params.hr_negative_prompt;
  }
  return p;
}

/* ======================================================================== */
/*  Запуск генерации + прогресс                                              */
/* ======================================================================== */
let pollTimer = null;

function newTaskId(kind) {
  let s = '';
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < 7; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return 'task(' + kind + '-' + s + ')';
}

export async function runGeneration({ endpoint, payload, result, mode }) {
  if (S.busy) { toast('Уже идёт генерация'); return null; }
  S.busy = true;
  setRunning(true);
  const started = Date.now();
  S.taskId = newTaskId(mode === 'img2img' ? 'i2i' : 't2i');
  payload.force_task_id = S.taskId;
  startPolling(result);
  try {
    /* Если выбран сохранённый персонаж, генерация идёт через собственный
       эндпоинт: сервер сам подставит его референсы, не гоняя их на телефон. */
    const char = charPayload();
    const resp = char
      ? await API.post('/api/generate/' + (mode === 'img2img' ? 'img2img' : 'txt2img'),
        { payload, character: char })
      : await API.fpost(endpoint, payload);
    const infos = parseInfos(resp);
    const items = (resp.images || []).map((b64, i) => ({
      url: asDataURL(b64, 'image/png'),
      name: 'forge-' + Date.now() + '-' + i + '.png',
      info: infos[i] || infos[0] || '',
      seed: extractSeed(infos[i] || infos[0] || ''),
    }));
    result.set(items);
    toast('Готово за ' + ((Date.now() - started) / 1000).toFixed(1) + ' с', 'ok');
    haptic(20);
    return resp;
  } catch (e) {
    toast('Ошибка: ' + e.message, 'err', 5000);
    return null;
  } finally {
    S.busy = false;
    S.taskId = null;
    setRunning(false);
    stopPolling();
    $('#barSub').textContent = shortModel();
  }
}

function shortModel() {
  const o = (S.boot && S.boot.options) || {};
  const m = o.sd_model_checkpoint || '';
  return m.split(/[\\/]/).pop() || '—';
}

function parseInfos(resp) {
  try {
    const info = JSON.parse(resp.info || '{}');
    return info.infotexts || [];
  } catch (e) { return []; }
}

function extractSeed(info) {
  const m = String(info || '').match(/Seed:\s*(-?\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function setRunning(on) {
  const run = $('#btnRun');
  const stop = $('#btnStop');
  const skip = $('#btnSkip');
  const label = run.dataset.label || 'Генерация';
  run.classList.toggle('is-busy', on);
  run.querySelector('span').textContent = on ? label + '…' : label;
  stop.hidden = !on;
  skip.hidden = !on;
  if (!on) $('#runProgress').style.width = '0%';
}

/**
 * Опрос прогресса через /internal/progress — тот же путь, которым пользуется
 * штатный интерфейс Forge.
 *
 * ВАЖНО: /sdapi/v1/progress использовать нельзя. Его обработчик безусловно
 * вызывает shared.state.set_current_image(), то есть выполняет VAE-декод
 * латента прямо в HTTP-потоке — параллельно с сэмплингом и (при --cuda-stream)
 * с асинхронным переносом весов. Это приводит к гонке на уровне CUDA и
 * аварийному завершению процесса (access violation в c10.dll).
 * Флаг skip_current_image от декода не спасает: он влияет только на то,
 * попадёт ли картинка в ответ, а декод к тому моменту уже выполнен.
 *
 * /internal/progress вызывает set_current_image() только при live_preview=true,
 * поэтому в безопасном режиме тяжёлых операций в чужом потоке не происходит.
 */
function startPolling(result) {
  stopPolling();
  const usePreview = store.get('livePreview', false);
  let idLive = -1;
  pollTimer = setInterval(async () => {
    if (!S.taskId) return;
    try {
      const p = await API.fpost('/internal/progress', {
        id_task: S.taskId,
        id_live_preview: idLive,
        live_preview: usePreview,
      });
      S.progress = p;
      const pct = Math.max(0, Math.min(1, p.progress || 0));
      $('#runProgress').style.width = (pct * 100).toFixed(1) + '%';

      let sub;
      if (p.queued) sub = 'в очереди…';
      else if (!p.active) sub = 'подготовка…';
      else {
        sub = (pct * 100).toFixed(0) + '%';
        if (p.eta) sub += ' · ~' + Math.max(0, p.eta).toFixed(0) + 'с';
        const steps = String(p.textinfo || '').match(/(\d+)\s*\/\s*(\d+)/);
        if (steps) sub = steps[1] + '/' + steps[2] + ' · ' + sub;
      }
      $('#barSub').textContent = sub;

      if (usePreview && p.live_preview && result && result.showLive) {
        result.showLive(p.live_preview);
        if (p.id_live_preview !== undefined && p.id_live_preview !== null) {
          idLive = p.id_live_preview;
        }
      }
    } catch (e) { /* тихо */ }
  }, 1200);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export async function interrupt() {
  try { await API.fpost('/sdapi/v1/interrupt', {}); toast('Прерывание…'); } catch (e) {}
}

export async function skipCurrent() {
  try { await API.fpost('/sdapi/v1/skip', {}); toast('Пропуск…'); } catch (e) {}
}

/* ======================================================================== */
/*  Парсер infotext                                                          */
/* ======================================================================== */
export function parseInfotext(text) {
  if (!text) return null;
  const out = {};
  const lines = String(text).split('\n');
  const negIdx = lines.findIndex((l) => l.startsWith('Negative prompt:'));
  let paramIdx = lines.length - 1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/(^|,\s)Steps:\s*\d+/.test(lines[i])) { paramIdx = i; break; }
  }
  out.prompt = lines.slice(0, negIdx >= 0 ? negIdx : paramIdx).join('\n').trim();
  out.negative_prompt = negIdx >= 0
    ? lines.slice(negIdx, paramIdx).join('\n').replace(/^Negative prompt:\s*/, '').trim()
    : '';

  const tail = lines[paramIdx] || '';
  const pairs = tail.matchAll(/([\w \-/+]+):\s*("[^"]*"|[^,]*)(?:,|$)/g);
  for (const m of pairs) {
    const k = m[1].trim();
    const v = m[2].trim().replace(/^"|"$/g, '');
    switch (k) {
      case 'Steps': out.steps = +v; break;
      case 'Sampler': out.sampler_name = v; break;
      case 'Schedule type': out.scheduler = v; break;
      case 'CFG scale': out.cfg_scale = +v; break;
      case 'Distilled CFG Scale': out.distilled_cfg_scale = +v; break;
      case 'Seed': out.seed = +v; break;
      case 'Size': {
        const parts = v.split('x').map(Number);
        if (parts[0]) out.width = parts[0];
        if (parts[1]) out.height = parts[1];
        break;
      }
      case 'Denoising strength': out.denoising_strength = +v; break;
      case 'Clip skip': out.clip_skip = +v; break;
      case 'Hires upscale': out.hr_scale = +v; out.enable_hr = true; break;
      case 'Hires upscaler': out.hr_upscaler = v; break;
      case 'Hires steps': out.hr_second_pass_steps = +v; break;
      case 'Variation seed': out.subseed = +v; break;
      case 'Variation seed strength': out.subseed_strength = +v; break;
      default: break;
    }
  }
  return out;
}

export function applyInfotext(params, info) {
  const p = parseInfotext(info);
  if (!p) return false;
  Object.keys(p).forEach((k) => {
    const v = p[k];
    if (v !== undefined && v !== null && !(typeof v === 'number' && Number.isNaN(v))) {
      params[k] = v;
    }
  });
  return true;
}
