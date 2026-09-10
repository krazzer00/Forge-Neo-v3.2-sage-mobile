/* ==========================================================================
   characters.js — референсные изображения для Klein / Kontext / Qwen-Edit
   и библиотека персонажей.

   Референсы уходят в Forge через alwayson-скрипт «ImageStitch Integrated»:
       args = [true, [base64, ...], maxSideLength]
   Для FLUX.2 Klein при включённой опции klein_do_reference это активирует
   режим Edit — изображения становятся ref_latents модели.

   Изображения, добавленные «на лету», живут только в памяти вкладки.
   Сохранённые персонажи хранятся на сервере (MobileUI/characters), поэтому
   их base64 подставляет сервер — телефон их не гоняет.
   ========================================================================== */
import {
  h, icon, I, API, toast, haptic, store, openSheet, closeSheet, confirmSheet,
  b64Only, fileToDataURL, shrinkDataURL, lightbox,
} from './core.js';
import { Slider, Switch, TextField } from './ui.js';
import { S } from './state.js';

/* Состояние референсов: общее для txt2img и img2img */
export const REF = {
  images: [],                                  // dataURL, только в памяти
  charId: store.get('ref.charId', null),       // выбранный персонаж
  charName: store.get('ref.charName', ''),
  maxSide: store.get('ref.maxSide', 1024),
  /* по умолчанию выключено: ключ v2, чтобы не подтягивать старое значение */
  enabled: store.get('ref.enabled2', false),
};

let charsCache = null;
const listeners = [];

export function onRefChange(fn) { listeners.push(fn); }
function fire() { listeners.forEach((f) => f()); }

export function refCount() {
  return REF.enabled ? (REF.images.length + (REF.charId ? 1 : 0)) : 0;
}

/** Аргументы alwayson для локальных изображений (персонаж добавляется сервером) */
export function stitchArgs() {
  if (!REF.enabled || !REF.images.length) return null;
  return [true, REF.images.map((d) => b64Only(d)), Math.round(REF.maxSide)];
}

/** Данные о персонаже для серверного эндпоинта генерации */
export function charPayload() {
  if (!REF.enabled || !REF.charId) return null;
  return { id: REF.charId, max_side: Math.round(REF.maxSide) };
}

export async function loadChars(force) {
  if (charsCache && !force) return charsCache;
  try {
    const r = await API.get('/api/characters');
    charsCache = r.characters || [];
  } catch (e) {
    charsCache = [];
    toast('Не удалось загрузить персонажей', 'err');
  }
  return charsCache;
}

function charThumb(c, ref, size) {
  return '/api/char-image?id=' + encodeURIComponent(c.id) +
    '&ref=' + encodeURIComponent(ref) + (size ? '&size=' + size : '');
}

/* ======================================================================== */
/*  Блок «Референсы персонажа» для txt2img / img2img                        */
/* ======================================================================== */
export function ReferenceBlock() {
  const strip = h('div', { class: 'result-strip contain', style: { paddingTop: '4px' } });
  const info = h('div', { class: 'muted', style: { marginBottom: '8px' } }, '');
  const charRow = h('div', { class: 'muted', style: { marginBottom: '8px' } }, '');

  const enableSw = Switch({
    label: 'Использовать референсы',
    sub: 'Klein / Kontext / Qwen-Edit — режим Edit',
    value: REF.enabled,
    onChange: (v) => { REF.enabled = v; store.set('ref.enabled2', v); redraw(); fire(); },
  });

  const maxSide = Slider({
    label: 'Максимальная сторона референса', min: 256, max: 2048, step: 64,
    value: REF.maxSide, hint: 'меньше — быстрее',
    onChange: (v) => { REF.maxSide = v; store.set('ref.maxSide', v); },
  });

  const fileInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onchange: async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      for (const f of files) {
        try {
          const d = await shrinkDataURL(await fileToDataURL(f), 1536);
          REF.images.push(d);
        } catch (err) { toast('Не удалось прочитать файл', 'err'); }
      }
      redraw(); fire();
    },
  });

  const camInput = h('input', {
    type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      REF.images.push(await shrinkDataURL(await fileToDataURL(f), 1536));
      redraw(); fire();
    },
  });

  function redraw() {
    strip.textContent = '';
    REF.images.forEach((d, i) => {
      const im = h('img', {
        src: d, alt: '',
        onclick: () => lightbox(REF.images.map((x, n) => ({ url: x, name: 'ref' + (n + 1) })), i, {
          buttons: [{
            label: 'Убрать', icon: I.trash,
            run: (it, idx, ctx) => { REF.images.splice(idx, 1); ctx.close(); redraw(); fire(); },
          }],
        }),
      });
      strip.append(im);
    });
    const n = REF.images.length;
    info.textContent = n
      ? n + ' изображени' + (n === 1 ? 'е' : n < 5 ? 'я' : 'й') + ' в этой сессии'
      : 'Изображения не добавлены';
    charRow.textContent = REF.charId
      ? 'Персонаж: ' + (REF.charName || REF.charId)
      : 'Персонаж не выбран';
    strip.hidden = !n;
    maxSide.el.hidden = !REF.enabled;
  }

  const buttons = h('div', { class: 'picker-bar' },
    h('button', { class: 'btn', onclick: () => fileInput.click() }, icon(I.image, 18), 'Добавить'),
    h('button', { class: 'btn', onclick: () => camInput.click() }, icon(I.camera, 18), 'Камера'),
    h('button', {
      class: 'btn',
      onclick: () => window.dispatchEvent(new CustomEvent('fm:pickFromBrowser', {
        detail: { cb: (d) => { REF.images.push(d); redraw(); fire(); } },
      })),
    }, icon(I.folder, 18), 'Из папок'),
    h('button', { class: 'btn', onclick: () => charactersSheet(redraw) }, icon(I.star, 18), 'Персонажи'),
    h('button', {
      class: 'btn',
      onclick: () => {
        REF.images = []; REF.charId = null; REF.charName = '';
        store.del('ref.charId'); store.del('ref.charName');
        redraw(); fire(); haptic();
      },
    }, icon(I.trash, 18)));

  redraw();

  return h('div', { class: 'card card-pad' },
    h('div', { class: 'label' }, 'Референсы персонажа',
      h('span', { class: 'hint' }, 'ImageStitch')),
    enableSw.el, charRow, info, strip, buttons, maxSide.el, fileInput, camInput);
}

/* ======================================================================== */
/*  Библиотека персонажей                                                    */
/* ======================================================================== */
export async function charactersSheet(onPicked) {
  const body = h('div', null, h('div', { class: 'muted' }, 'Загрузка…'));
  openSheet({ title: 'Персонажи', body, full: true });
  await draw();

  async function draw() {
    const list = await loadChars(true);
    body.textContent = '';

    body.append(h('button', {
      class: 'btn primary wide', style: { marginBottom: '10px' },
      onclick: () => newCharacterSheet(async () => { await draw(); }),
    }, icon(I.plus, 18), 'Новый персонаж из карточки'));

    if (REF.charId) {
      body.append(h('button', {
        class: 'btn wide', style: { marginBottom: '10px' },
        onclick: () => {
          REF.charId = null; REF.charName = '';
          store.del('ref.charId'); store.del('ref.charName');
          if (onPicked) onPicked();
          fire(); closeSheet();
        },
      }, icon(I.close, 18), 'Не использовать персонажа'));
    }

    if (!list.length) {
      body.append(h('div', { class: 'muted', style: { padding: '18px', textAlign: 'center' } },
        'Пока пусто. Загрузите лист персонажа — он будет нарезан на панели, ' +
        'а выбранные виды станут референсами.'));
      return;
    }

    list.forEach((c) => {
      const thumbs = h('div', { class: 'result-strip contain' });
      (c.refs || []).slice(0, 8).forEach((r) => {
        thumbs.append(h('img', { src: charThumb(c, r, 160), alt: '', loading: 'lazy' }));
      });
      const active = REF.charId === c.id;
      body.append(h('div', {
        class: 'card card-pad',
        style: active ? { borderColor: 'var(--accent)' } : null,
      },
        h('div', { class: 'label' }, c.name || c.id,
          h('span', { class: 'hint' }, (c.refs || []).length + ' реф.')),
        thumbs,
        c.prompt ? h('div', { class: 'muted', style: { margin: '6px 0' } }, c.prompt.slice(0, 120)) : null,
        h('div', { class: 'result-actions' },
          h('button', {
            class: 'btn' + (active ? '' : ' primary'),
            onclick: () => {
              REF.charId = c.id; REF.charName = c.name || c.id;
              REF.enabled = true;
              store.set('ref.charId', c.id);
              store.set('ref.charName', REF.charName);
              store.set('ref.enabled2', true);
              if (onPicked) onPicked();
              fire();
              toast('Персонаж выбран: ' + REF.charName, 'ok');
              closeSheet();
            },
          }, icon(I.check, 18), active ? 'Выбран' : 'Использовать'),
          c.prompt ? h('button', {
            class: 'btn',
            onclick: () => {
              window.dispatchEvent(new CustomEvent('fm:appendPrompt', { detail: { text: c.prompt } }));
              toast('Описание добавлено в промпт', 'ok');
            },
          }, icon(I.copy, 18), 'Промпт') : null,
          h('button', {
            class: 'btn', onclick: () => editCharacterSheet(c, draw),
          }, icon(I.wand, 18), 'Правка'),
          h('button', {
            class: 'btn danger',
            onclick: async () => {
              const ok = await confirmSheet('Удалить персонажа?', c.name || c.id, 'Удалить');
              if (!ok) return;
              await API.post('/api/characters', { action: 'delete', id: c.id });
              if (REF.charId === c.id) {
                REF.charId = null; REF.charName = '';
                store.del('ref.charId'); store.del('ref.charName');
                if (onPicked) onPicked();
                fire();
              }
              await draw();
            },
          }, icon(I.trash, 18)))));
    });
  }
}

/* ---------------------- создание персонажа из листа --------------------- */
function newCharacterSheet(done) {
  const nameField = TextField({ label: 'Имя', value: '', placeholder: 'Например: Аврора' });
  const promptField = TextField({
    label: 'Описание (подставляется в промпт)', value: '', multiline: true, rows: 2,
    placeholder: 'silver bob hair with blue tips, blue eyes, grey jacket…',
  });
  const status = h('div', { class: 'muted', style: { margin: '8px 0' } },
    'Загрузите лист персонажа — он будет автоматически нарезан на панели.');
  const grid = h('div', { class: 'gal-grid', style: { marginBottom: '10px' } });
  const saveBtn = h('button', { class: 'btn primary wide', hidden: true }, icon(I.download, 18), 'Сохранить персонажа');

  let token = null;
  let panels = [];
  const selected = new Set();
  let wholeImage = null;

  const fileInput = h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      await handle(await fileToDataURL(f));
    },
  });

  async function handle(dataUrl) {
    status.textContent = 'Разбираю лист…';
    grid.textContent = '';
    selected.clear();
    try {
      const big = await shrinkDataURL(dataUrl, 3000);
      wholeImage = big;
      const r = await API.post('/api/characters', { action: 'slice', image: b64Only(big) });
      if (!r.ok) throw new Error(r.error || 'ошибка');
      token = r.token;
      panels = r.panels || [];
      status.textContent = panels.length
        ? 'Найдено панелей: ' + panels.length + '. Отметьте те, что станут референсами (2–4 достаточно).'
        : 'Панели не найдены — будет использовано изображение целиком.';
      drawPanels();
      saveBtn.hidden = false;
    } catch (err) {
      status.textContent = 'Ошибка: ' + err.message;
    }
  }

  function drawPanels() {
    grid.textContent = '';
    panels.forEach((p) => {
      const im = h('img', { src: p.thumb, alt: '' });
      im.classList.add('ready');
      const cell = h('div', {
        class: 'gal-cell',
        onclick: () => {
          if (selected.has(p.i)) selected.delete(p.i); else selected.add(p.i);
          cell.classList.toggle('sel', selected.has(p.i));
          haptic();
        },
      }, im, h('div', { class: 'badge' }, p.w + '×' + p.h));
      grid.append(cell);
    });
  }

  saveBtn.addEventListener('click', async () => {
    const name = nameField.get().trim() || 'Персонаж';
    saveBtn.disabled = true;
    status.textContent = 'Сохраняю…';
    try {
      const req = {
        action: 'save', name, prompt: promptField.get().trim(),
      };
      if (selected.size) {
        req.token = token;
        req.keep = panels.filter((p) => selected.has(p.i)).map((p) => ({ box: p.box }));
      } else if (wholeImage) {
        req.images = [b64Only(wholeImage)];
      }
      const r = await API.post('/api/characters', req);
      if (!r.ok) throw new Error(r.error || 'ошибка');
      charsCache = null;
      toast('Персонаж сохранён', 'ok');
      closeSheet();
      if (done) await done();
    } catch (err) {
      status.textContent = 'Ошибка: ' + err.message;
      saveBtn.disabled = false;
    }
  });

  const body = h('div', null,
    nameField.el, promptField.el,
    h('div', { class: 'picker-bar', style: { marginBottom: '10px' } },
      h('button', { class: 'btn', onclick: () => fileInput.click() }, icon(I.image, 18), 'Выбрать лист'),
      h('button', {
        class: 'btn',
        onclick: () => window.dispatchEvent(new CustomEvent('fm:pickFromBrowser', {
          detail: { cb: (d) => handle(d) },
        })),
      }, icon(I.folder, 18), 'Из папок')),
    status, grid, saveBtn, fileInput);

  openSheet({ title: 'Новый персонаж', body, full: true });
}

/* --------------------------- правка персонажа --------------------------- */
function editCharacterSheet(c, done) {
  const nameField = TextField({ label: 'Имя', value: c.name || '' });
  const promptField = TextField({
    label: 'Описание', value: c.prompt || '', multiline: true, rows: 3,
  });
  const grid = h('div', { class: 'gal-grid', style: { marginBottom: '10px' } });

  const addInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onchange: async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      const images = [];
      for (const f of files) images.push(b64Only(await shrinkDataURL(await fileToDataURL(f), 1536)));
      await API.post('/api/characters', { action: 'save', id: c.id, images });
      charsCache = null;
      const list = await loadChars(true);
      const fresh = list.find((x) => x.id === c.id);
      if (fresh) { c.refs = fresh.refs; drawRefs(); }
    },
  });

  function drawRefs() {
    grid.textContent = '';
    (c.refs || []).forEach((r) => {
      const im = h('img', { src: charThumb(c, r, 200), alt: '' });
      im.classList.add('ready');
      grid.append(h('div', {
        class: 'gal-cell',
        onclick: async () => {
          const ok = await confirmSheet('Удалить референс?', r, 'Удалить');
          if (!ok) return;
          await API.post('/api/characters', { action: 'delete', id: c.id, ref: r });
          c.refs = (c.refs || []).filter((x) => x !== r);
          charsCache = null;
          drawRefs();
        },
      }, im));
    });
  }
  drawRefs();

  const body = h('div', null,
    nameField.el, promptField.el,
    h('div', { class: 'label' }, 'Референсы (нажмите, чтобы удалить)'),
    grid,
    h('div', { class: 'picker-bar', style: { marginBottom: '10px' } },
      h('button', { class: 'btn', onclick: () => addInput.click() }, icon(I.plus, 18), 'Добавить'),
      h('button', {
        class: 'btn',
        onclick: () => window.dispatchEvent(new CustomEvent('fm:pickFromBrowser', {
          detail: {
            cb: async (d) => {
              await API.post('/api/characters', { action: 'save', id: c.id, images: [b64Only(d)] });
              charsCache = null;
              const list = await loadChars(true);
              const fresh = list.find((x) => x.id === c.id);
              if (fresh) { c.refs = fresh.refs; drawRefs(); }
            },
          },
        })),
      }, icon(I.folder, 18), 'Из папок')),
    h('button', {
      class: 'btn primary wide',
      onclick: async () => {
        await API.post('/api/characters', {
          action: 'save', id: c.id,
          name: nameField.get(), prompt: promptField.get(),
        });
        charsCache = null;
        if (REF.charId === c.id) {
          REF.charName = nameField.get();
          store.set('ref.charName', REF.charName);
          fire();
        }
        toast('Сохранено', 'ok');
        closeSheet();
        if (done) await done();
      },
    }, icon(I.download, 18), 'Сохранить'),
    addInput);

  openSheet({ title: 'Правка персонажа', body, full: true });
}
