/* ==========================================================================
   core.js — DOM-утилиты, API-клиент, хранилище, тосты, шторки, лайтбокс
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'g', 'polyline', 'ellipse']);

export function h(tag, attrs, ...kids) {
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat(4)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ------------------------------ Иконки ---------------------------------- */
const P = (d) => ({ t: 'path', a: { d } });
const C = (cx, cy, r, fill) => ({ t: 'circle', a: { cx, cy, r, fill: fill || 'none' } });
const R = (x, y, w, ht, rx) => ({ t: 'rect', a: { x, y, width: w, height: ht, rx: rx || 0 } });

export const I = {
  chevron: [P('M9 5l7 7-7 7')],
  chevronDown: [P('M6 9l6 6 6-6')],
  close: [P('M18 6L6 18M6 6l12 12')],
  check: [P('M20 6L9 17l-5-5')],
  dice: [R(3, 3, 18, 18, 3), C(8.5, 8.5, 1.2, 'currentColor'), C(15.5, 15.5, 1.2, 'currentColor'), C(12, 12, 1.2, 'currentColor')],
  recycle: [P('M4 12a8 8 0 0113.7-5.7L20 8'), P('M20 4v4h-4'), P('M20 12a8 8 0 01-13.7 5.7L4 16'), P('M4 20v-4h4')],
  image: [R(3, 4, 18, 16, 2), C(8.5, 9.5, 1.8), P('M21 15l-5-5-9 9')],
  camera: [P('M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z'), C(12, 13, 3.5)],
  trash: [P('M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13')],
  download: [P('M12 3v12M7 11l5 5 5-5'), P('M4 20h16')],
  send: [P('M4 12l16-8-6 16-2.5-6L4 12z')],
  info: [C(12, 12, 9), P('M12 11v5M12 8h.01')],
  folder: [P('M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z')],
  search: [C(11, 11, 7), P('M20 20l-3.5-3.5')],
  refresh: [P('M20 11A8 8 0 106 6.3L4 8'), P('M4 4v4h4')],
  plus: [P('M12 5v14M5 12h14')],
  minus: [P('M5 12h14')],
  brush: [P('M4 20c2 0 3-1 3-3 0-1.5 1-2.5 2.5-2.5S12 15.5 12 17'), P('M8.5 14.5L18 5a2.1 2.1 0 013 3l-9.5 9.5')],
  eraser: [P('M7 21h12'), P('M15 4l5 5-9 9H6l-2-2 11-12z')],
  layers: [P('M12 3l9 5-9 5-9-5 9-5z'), P('M3 13l9 5 9-5')],
  star: [P('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z')],
  copy: [R(9, 9, 11, 11, 2), P('M5 15V5a2 2 0 012-2h8')],
  wand: [P('M15 4V2M15 10V8M12 6h2M17 6h2'), P('M4 20l9-9 2 2-9 9H4v-2z')],
  up: [P('M12 19V5M5 12l7-7 7 7')],
  grid: [R(3, 3, 7, 7, 1.5), R(14, 3, 7, 7, 1.5), R(3, 14, 7, 7, 1.5), R(14, 14, 7, 7, 1.5)],
  crop: [P('M6 2v14a2 2 0 002 2h14'), P('M2 6h14a2 2 0 012 2v14')],
  cpu: [R(6, 6, 12, 12, 2), P('M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3')],
  tag: [P('M3 12V5a2 2 0 012-2h7l9 9-9 9-9-9z'), C(8, 8, 1.4, 'currentColor')],
};

export function icon(def, size) {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  (def || []).forEach((n) => {
    const node = document.createElementNS(SVG_NS, n.t);
    for (const [k, v] of Object.entries(n.a)) node.setAttribute(k, v);
    el.append(node);
  });
  if (size) { el.style.width = size + 'px'; el.style.height = size + 'px'; }
  return el;
}

/* ------------------------------ Storage --------------------------------- */
const LS = 'fmui.';
export const store = {
  get(key, def) {
    try {
      const v = localStorage.getItem(LS + key);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  },
  set(key, val) { try { localStorage.setItem(LS + key, JSON.stringify(val)); } catch (e) {} },
  del(key) { try { localStorage.removeItem(LS + key); } catch (e) {} },
};

/* ------------------------------ API ------------------------------------- */
export const API = {
  async json(url, opts) {
    const r = await fetch(url, opts);
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { raw: txt }; }
    if (!r.ok) {
      const m = (data && (data.detail || data.error || data.msg)) || (r.status + ' ' + r.statusText);
      const err = new Error(typeof m === 'string' ? m : JSON.stringify(m));
      err.status = r.status; err.data = data;
      throw err;
    }
    return data;
  },
  get(p) { return API.json(p); },
  post(p, b) {
    return API.json(p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b || {}),
    });
  },
  fg(p) { return API.json('/forge' + p); },
  fpost(p, b) {
    return API.json('/forge' + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b || {}),
    });
  },
  fileUrl(path, t) {
    return '/forge/infinite_image_browsing/file?path=' + encodeURIComponent(path) +
      '&t=' + encodeURIComponent(t || '');
  },
  thumbUrl(path, t, size) {
    return '/forge/infinite_image_browsing/image-thumbnail?path=' + encodeURIComponent(path) +
      '&t=' + encodeURIComponent(t || '') + '&size=' + (size || '320x320');
  },
};

/* ------------------------------ Toast ----------------------------------- */
export function toast(msg, kind, ms) {
  const root = $('#toastRoot');
  const el = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, msg);
  root.append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, ms || 2600);
}

export function haptic(ms) {
  try { navigator.vibrate && navigator.vibrate(ms || 8); } catch (e) {}
}

/* ------------------------------ Sheet ----------------------------------- */
const sheetStack = [];

export function openSheet({ title, body, search, onClose, full }) {
  const root = $('#sheetRoot');
  const back = h('div', { class: 'sheet-back', onclick: () => closeSheet() });
  const bodyEl = h('div', { class: 'sheet-body' });
  if (body) bodyEl.append(body);
  const searchWrap = search
    ? h('div', { class: 'sheet-search' },
      h('input', {
        type: 'search', placeholder: search.placeholder || 'Поиск…',
        autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
        oninput: (e) => search.oninput(e.target.value.trim().toLowerCase(), bodyEl),
      }))
    : null;
  const sheet = h('div', { class: 'sheet', style: full ? { height: '88dvh' } : null },
    h('div', { class: 'sheet-grab' }),
    h('div', { class: 'sheet-head' },
      h('b', null, title || ''),
      h('button', { class: 'sheet-close', onclick: () => closeSheet() }, icon(I.close, 18))),
    searchWrap, bodyEl);

  const wrap = h('div', { style: { position: 'absolute', inset: '0' } }, back, sheet);
  root.append(wrap);
  sheetStack.push({ wrap, onClose });
  requestAnimationFrame(() => root.classList.add('open'));

  let sy = 0, dy = 0, dragging = false;
  const grab = sheet.querySelector('.sheet-grab');
  const head = sheet.querySelector('.sheet-head');
  const start = (e) => { dragging = true; sy = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; };
  const move = (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - sy);
    sheet.style.transform = 'translateY(' + dy + 'px)';
  };
  const end = () => {
    if (!dragging) return;
    dragging = false; sheet.style.transition = '';
    if (dy > 90) closeSheet(); else sheet.style.transform = '';
  };
  [grab, head].forEach((n) => {
    n.addEventListener('touchstart', start, { passive: true });
    n.addEventListener('touchmove', move, { passive: true });
    n.addEventListener('touchend', end);
  });
  return { sheet, bodyEl, close: closeSheet };
}

export function closeSheet() {
  const root = $('#sheetRoot');
  const top = sheetStack.pop();
  if (!top) return;
  if (sheetStack.length === 0) root.classList.remove('open');
  const delay = sheetStack.length === 0 ? 280 : 0;
  setTimeout(() => { top.wrap.remove(); if (top.onClose) top.onClose(); }, delay);
}

/* ---------------------- Список-выбор в шторке ---------------------------- */
export function pickSheet({ title, items, value, onPick, multi, placeholder }) {
  const norm = items.map((it) => (typeof it === 'string' ? { value: it, label: it } : it));
  const selected = new Set(multi ? (Array.isArray(value) ? value : []) : [value]);
  const list = h('div');

  const render = (q) => {
    list.textContent = '';
    const arr = q ? norm.filter((it) =>
      String(it.label || '').toLowerCase().includes(q) ||
      String(it.sub || '').toLowerCase().includes(q)) : norm;
    if (!arr.length) {
      list.append(h('div', { class: 'muted', style: { padding: '20px', textAlign: 'center' } }, 'Ничего не найдено'));
      return;
    }
    const frag = document.createDocumentFragment();
    arr.forEach((it) => {
      const mark = icon(I.check, 18);
      mark.classList.add('ock');
      const row = h('button', {
        class: 'opt' + (selected.has(it.value) ? ' on' : ''),
        onclick: () => {
          haptic();
          if (multi) {
            if (selected.has(it.value)) selected.delete(it.value); else selected.add(it.value);
            row.classList.toggle('on');
            onPick(Array.from(selected));
          } else { onPick(it.value); closeSheet(); }
        },
      },
        h('div', { class: 'oname' }, it.label, it.sub ? h('span', { class: 'osub' }, it.sub) : null),
        mark);
      frag.append(row);
    });
    list.append(frag);
  };
  render('');
  return openSheet({
    title, body: list, full: norm.length > 12,
    search: norm.length > 8 ? { placeholder: placeholder || 'Поиск…', oninput: render } : null,
  });
}

export function confirmSheet(title, text, okLabel) {
  return new Promise((resolve) => {
    let done = false;
    const body = h('div', null,
      h('div', { class: 'muted', style: { marginBottom: '14px', fontSize: '14px' } }, text),
      h('button', {
        class: 'btn danger wide', style: { marginBottom: '8px' },
        onclick: () => { done = true; resolve(true); closeSheet(); },
      }, okLabel || 'Подтвердить'),
      h('button', { class: 'btn wide', onclick: () => closeSheet() }, 'Отмена'));
    openSheet({ title, body, onClose: () => { if (!done) resolve(false); } });
  });
}

/* ------------------------------ Lightbox -------------------------------- */
export function lightbox(items, index, actions) {
  const box = $('#lightbox');
  let i = index || 0;
  let scale = 1, tx = 0, ty = 0;

  const img = h('img', { src: items[i].url, alt: '' });
  const stage = h('div', { class: 'lb-stage' }, img);
  const title = h('div', { class: 't' }, items[i].name || '');
  const counter = h('span', { class: 't', style: { flex: '0 0 auto' } }, `${i + 1}/${items.length}`);
  const infoBox = h('div', { class: 'lb-info', hidden: true });

  const applyT = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  const close = () => { box.hidden = true; box.textContent = ''; document.body.style.overflow = ''; };

  const setIdx = (n) => {
    if (n < 0 || n >= items.length) return;
    i = n; scale = 1; tx = 0; ty = 0; applyT();
    img.src = items[i].url;
    title.textContent = items[i].name || '';
    counter.textContent = `${i + 1}/${items.length}`;
    infoBox.hidden = true;
    if (actions && actions.onIndex) actions.onIndex(i, items[i]);
  };

  const ctx = { infoBox, close, setIdx, get index() { return i; } };
  const btns = (actions && actions.buttons ? actions.buttons : []).map((b) =>
    h('button', {
      class: 'lb-btn',
      onclick: () => b.run(items[i], i, ctx),
    }, b.icon ? icon(b.icon, 17) : null, b.label));

  box.textContent = '';
  box.append(
    h('div', { class: 'lb-top' },
      h('button', { class: 'lb-btn', style: { padding: '8px 10px' }, onclick: close }, icon(I.close, 18)),
      title, counter),
    stage, infoBox,
    h('div', { class: 'lb-bottom' }, btns));
  box.hidden = false;
  document.body.style.overflow = 'hidden';

  let sx = 0, sy0 = 0, startDist = 0, startScale = 1, sTx = 0, sTy = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { startDist = dist(e.touches); startScale = scale; }
    else { sx = e.touches[0].clientX; sy0 = e.touches[0].clientY; sTx = tx; sTy = ty; }
  }, { passive: true });

  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      scale = Math.min(6, Math.max(1, startScale * (dist(e.touches) / startDist)));
      applyT();
    } else if (scale > 1) {
      e.preventDefault();
      tx = sTx + (e.touches[0].clientX - sx);
      ty = sTy + (e.touches[0].clientY - sy0);
      applyT();
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    if (scale > 1) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) setIdx(dx < 0 ? i + 1 : i - 1);
    else if (dy > 100) close();
  });

  stage.addEventListener('dblclick', () => {
    scale = scale > 1 ? 1 : 2.5; tx = 0; ty = 0; applyT();
  });

  return { close, setIdx };
}

/* ------------------------------ Утилиты --------------------------------- */
export function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

export function b64Only(dataUrl) {
  if (!dataUrl) return '';
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export function asDataURL(b64, mime) {
  if (!b64) return '';
  return b64.startsWith('data:') ? b64 : `data:${mime || 'image/png'};base64,${b64}`;
}

export async function urlToDataURL(url) {
  const r = await fetch(url);
  const blob = await r.blob();
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

export async function shrinkDataURL(dataUrl, limit) {
  limit = limit || 2048;
  const img = await loadImage(dataUrl);
  if (Math.max(img.width, img.height) <= limit) return dataUrl;
  const k = limit / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

export function downloadDataURL(dataUrl, name) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name || ('forge-' + Date.now() + '.png');
  document.body.append(a); a.click(); a.remove();
}

export function fmtBytes(n) {
  if (n === null || n === undefined) return '';
  const u = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function baseName(p) {
  if (!p) return '';
  const s = String(p).replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1);
}

export function parentDir(p) {
  const s = String(p || '').replace(/\//g, '\\').replace(/\\+$/, '');
  const i = s.lastIndexOf('\\');
  return i > 2 ? s.slice(0, i) : s;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms || 250); };
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
