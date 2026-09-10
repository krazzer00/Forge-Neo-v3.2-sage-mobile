/* ==========================================================================
   ui.js — переиспользуемые элементы управления (мобильные, крупные тач-цели)
   ========================================================================== */
import { h, icon, I, pickSheet, haptic, fileToDataURL, shrinkDataURL, toast } from './core.js';

/* ------------------------------ Slider ---------------------------------- */
export function Slider({ label, min, max, step, value, onChange, hint, fmt }) {
  min = num(min, 0); max = num(max, 1); step = num(step, 0.01);
  let val = clamp(num(value, min), min, max);
  const dec = decimals(step);

  const input = h('input', {
    type: 'range', min, max, step, value: val,
    oninput: (e) => { set(parseFloat(e.target.value), true); },
    onchange: () => haptic(4),
  });
  const numBox = h('input', {
    type: 'number', class: 'sl-val', value: fmtVal(val), min, max, step,
    inputmode: step < 1 ? 'decimal' : 'numeric',
    onchange: (e) => { set(parseFloat(e.target.value), true); },
  });
  const wrap = h('div', { class: 'field' },
    h('div', { class: 'sl-head' },
      h('div', { class: 'label' }, label, hint ? h('span', { class: 'hint' }, hint) : null),
      numBox),
    input);

  function fmtVal(v) { return fmt ? fmt(v) : (dec ? v.toFixed(dec) : String(Math.round(v))); }
  function paint() {
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--pct', pct + '%');
  }
  function set(v, fire) {
    if (Number.isNaN(v)) v = min;
    val = clamp(v, min, max);
    input.value = val;
    numBox.value = fmtVal(val);
    paint();
    if (fire && onChange) onChange(val);
  }
  set(val, false);
  return { el: wrap, get: () => val, set: (v) => set(v, false), input };
}

/* ------------------------------ Select ---------------------------------- */
export function Select({ label, items, value, onChange, hint, placeholder, subOf }) {
  let val = value;
  const valEl = h('div', { class: 'val' }, '');
  const btn = h('button', {
    class: 'select',
    onclick: () => {
      haptic();
      pickSheet({
        title: label || 'Выбор',
        items: typeof items === 'function' ? items() : items,
        value: val,
        onPick: (v) => { set(v); if (onChange) onChange(v); },
      });
    },
  }, valEl, icon(I.chevronDown, 18));

  const wrap = label
    ? h('div', { class: 'field' },
      h('div', { class: 'label' }, label, hint ? h('span', { class: 'hint' }, hint) : null), btn)
    : h('div', { class: 'field' }, btn);

  function labelOf(v) {
    const arr = typeof items === 'function' ? items() : items;
    const it = arr.find((x) => (typeof x === 'string' ? x : x.value) === v);
    if (!it) return v;
    return typeof it === 'string' ? it : it.label;
  }
  function set(v) {
    val = v;
    const txt = (v === null || v === undefined || v === '') ? (placeholder || '—') : labelOf(v);
    valEl.textContent = subOf ? subOf(txt) : txt;
    valEl.classList.toggle('dim', !v);
  }
  set(val);
  return { el: wrap, get: () => val, set, btn };
}

/* ------------------------------ Switch ---------------------------------- */
export function Switch({ label, sub, value, onChange }) {
  let val = !!value;
  const btn = h('button', { class: 'switch' + (val ? ' on' : ''), onclick: () => { set(!val); if (onChange) onChange(val); haptic(); } },
    h('div', { class: 'txt' }, label, sub ? h('span', { class: 'sub' }, sub) : null),
    h('div', { class: 'sw' }));
  function set(v) { val = !!v; btn.classList.toggle('on', val); }
  return { el: btn, get: () => val, set };
}

/* ------------------------------ Segmented ------------------------------- */
export function Segmented({ label, items, value, onChange }) {
  let val = value;
  const norm = items.map((x) => (typeof x === 'string' ? { value: x, label: x } : x));
  const box = h('div', { class: 'seg' });
  const btns = norm.map((it) => {
    const b = h('button', {
      class: it.value === val ? 'on' : '',
      onclick: () => { set(it.value); if (onChange) onChange(it.value); haptic(); },
    }, it.label);
    box.append(b);
    return b;
  });
  function set(v) {
    val = v;
    btns.forEach((b, i) => b.classList.toggle('on', norm[i].value === v));
  }
  const wrap = label
    ? h('div', { class: 'field' }, h('div', { class: 'label' }, label), box)
    : h('div', { class: 'field' }, box);
  return { el: wrap, get: () => val, set };
}

/* ------------------------------ Text ------------------------------------ */
export function TextField({ label, value, onChange, placeholder, multiline, rows, hint, inputmode }) {
  const el = multiline
    ? h('textarea', { rows: rows || 3, placeholder: placeholder || '', oninput: (e) => onChange && onChange(e.target.value) })
    : h('input', { type: 'text', placeholder: placeholder || '', inputmode: inputmode || null, oninput: (e) => onChange && onChange(e.target.value) });
  el.value = value === undefined || value === null ? '' : value;
  const wrap = h('div', { class: 'field' },
    label ? h('div', { class: 'label' }, label, hint ? h('span', { class: 'hint' }, hint) : null) : null, el);
  return { el: wrap, get: () => el.value, set: (v) => { el.value = v === null || v === undefined ? '' : v; }, input: el };
}

export function NumField({ label, value, onChange, min, max, step, hint }) {
  const el = h('input', {
    type: 'number', min, max, step, inputmode: 'decimal',
    oninput: (e) => onChange && onChange(parseFloat(e.target.value)),
  });
  el.value = value;
  return {
    el: h('div', { class: 'field' },
      h('div', { class: 'label' }, label, hint ? h('span', { class: 'hint' }, hint) : null), el),
    get: () => parseFloat(el.value),
    set: (v) => { el.value = v; },
  };
}

/* ------------------------------ Accordion ------------------------------- */
export function Accordion({ title, badge, open, body, onToggle, indicator }) {
  const chev = icon(I.chevron, 18);
  chev.classList.add('chev');
  const dot = indicator ? h('div', { class: 'acc-dot' }) : null;
  const bodyEl = h('div', { class: 'acc-body' });
  if (body) bodyEl.append(body);
  const badgeEl = badge ? h('span', { class: 'acc-badge' }, badge) : null;
  const titleEl = h('span', null, title);
  const head = h('button', { class: 'acc-head' }, dot, titleEl, badgeEl, chev);
  const acc = h('div', { class: 'acc' + (open ? ' open' : '') }, head, bodyEl);
  head.addEventListener('click', () => {
    acc.classList.toggle('open');
    haptic(5);
    if (onToggle) onToggle(acc.classList.contains('open'));
  });
  return {
    el: acc, body: bodyEl,
    setActive: (on) => acc.classList.toggle('on', !!on),
    setBadge: (t) => { if (badgeEl) badgeEl.textContent = t; },
    setTitle: (t) => { titleEl.textContent = t; },
    open: () => acc.classList.add('open'),
  };
}

/* ------------------------------ Chips ----------------------------------- */
export function Chips({ label, items, values, onChange, single }) {
  const sel = new Set(values || []);
  const box = h('div', { class: 'chips' });
  const norm = items.map((x) => (typeof x === 'string' ? { value: x, label: x } : x));
  const btns = norm.map((it) => {
    const b = h('button', {
      class: 'chip' + (sel.has(it.value) ? ' on' : ''),
      onclick: () => {
        haptic();
        if (single) { sel.clear(); sel.add(it.value); }
        else if (sel.has(it.value)) sel.delete(it.value);
        else sel.add(it.value);
        btns.forEach((bb, i) => bb.classList.toggle('on', sel.has(norm[i].value)));
        if (onChange) onChange(Array.from(sel));
      },
    }, it.label);
    box.append(b);
    return b;
  });
  return {
    el: h('div', { class: 'field' }, label ? h('div', { class: 'label' }, label) : null, box),
    get: () => Array.from(sel),
    set: (vals) => {
      sel.clear(); (vals || []).forEach((v) => sel.add(v));
      btns.forEach((bb, i) => bb.classList.toggle('on', sel.has(norm[i].value)));
    },
  };
}

/* --------------------------- Image picker ------------------------------- */
/**
 * Универсальный выбор изображения: галерея / камера / из результата / из браузера.
 * Возвращает { el, get() -> dataURL|null, set(dataURL) }
 */
export function ImagePicker({ label, onChange, extraButtons, height }) {
  let data = null;
  const img = h('img', { alt: '', hidden: true });
  const hint = h('div', { class: 'picker-hint' },
    icon(I.image, 32), h('div', null, 'Нажмите, чтобы выбрать изображение'));
  const box = h('div', { class: 'picker', style: height ? { minHeight: height } : null }, img, hint);

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: pick });
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: pick });

  async function pick(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      let d = await fileToDataURL(f);
      d = await shrinkDataURL(d, 2048);
      set(d);
      if (onChange) onChange(d);
    } catch (err) { toast('Не удалось прочитать файл', 'err'); }
  }

  box.addEventListener('click', () => fileInput.click());

  const bar = h('div', { class: 'picker-bar' },
    h('button', { class: 'btn', onclick: () => fileInput.click() }, icon(I.image, 18), 'Галерея'),
    h('button', { class: 'btn', onclick: () => camInput.click() }, icon(I.camera, 18), 'Камера'),
    ...(extraButtons || []),
    h('button', {
      class: 'btn', onclick: () => { set(null); if (onChange) onChange(null); },
    }, icon(I.trash, 18)));

  function set(d) {
    data = d || null;
    img.hidden = !data;
    hint.hidden = !!data;
    box.classList.toggle('has', !!data);
    if (data) img.src = data;
  }

  const wrap = h('div', { class: 'field' },
    label ? h('div', { class: 'label' }, label) : null, box, bar, fileInput, camInput);
  return { el: wrap, get: () => data, set, imgEl: img };
}

/* ------------------------------ helpers --------------------------------- */
function num(v, d) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function decimals(step) {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}

export function Field(label, control, hint) {
  return h('div', { class: 'field' },
    h('div', { class: 'label' }, label, hint ? h('span', { class: 'hint' }, hint) : null), control);
}

export function Card(...kids) { return h('div', { class: 'card card-pad' }, kids); }
export function CardTitle(t) { return h('div', { class: 'card-title' }, t); }
export function Row(...kids) { return h('div', { class: 'row' }, kids); }
