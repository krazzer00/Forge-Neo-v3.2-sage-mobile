/* ==========================================================================
   mask.js — рисование маски пальцем поверх изображения (для inpaint)
   ========================================================================== */
import { h, icon, I, haptic, loadImage } from './core.js';
import { Slider } from './ui.js';

export function MaskEditor(opts) {
  opts = opts || {};
  let img = null;              // HTMLImageElement
  let W = 0, H = 0;            // натуральные размеры
  let brush = 48;
  let mode = 'draw';           // draw | erase
  let color = '#ff2d55';       // цвет для режима «скетч»
  let sketch = false;          // true = рисуем цветом поверх картинки
  const undoStack = [];

  const imgEl = h('img', { alt: '' });
  const canvas = h('canvas');
  const wrap = h('div', { class: 'maskwrap', hidden: true }, imgEl, canvas);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const brushSlider = Slider({
    label: 'Кисть', min: 4, max: 220, step: 2, value: brush,
    onChange: (v) => { brush = v; },
  });

  const btnDraw = h('button', { class: 'chip on', onclick: () => setMode('draw') }, 'Кисть');
  const btnErase = h('button', { class: 'chip', onclick: () => setMode('erase') }, 'Ластик');
  const colorInput = h('input', {
    type: 'color', value: color, hidden: true,
    style: { width: '44px', height: '34px', padding: '0', border: '0', background: 'none' },
    oninput: (e) => { color = e.target.value; },
  });
  const btnInvert = h('button', { class: 'chip', onclick: () => invert() }, 'Инвертировать');
  const btnFill = h('button', { class: 'chip', onclick: () => fillAll() }, 'Всё');
  const tools = h('div', { class: 'masktools' },
    btnDraw, btnErase,
    h('button', { class: 'chip', onclick: () => undo() }, 'Отменить'),
    h('button', { class: 'chip', onclick: () => clear() }, 'Очистить'),
    btnInvert, btnFill, colorInput);

  const el = h('div', { class: 'field' }, wrap, tools, brushSlider.el);

  /** Переключение между режимом маски и режимом рисования цветом */
  function setSketch(on) {
    sketch = !!on;
    colorInput.hidden = !sketch;
    btnInvert.hidden = sketch;
    btnFill.hidden = sketch;
    canvas.style.opacity = sketch ? '1' : '';
  }

  function setMode(m) {
    mode = m;
    btnDraw.classList.toggle('on', m === 'draw');
    btnErase.classList.toggle('on', m === 'erase');
    haptic();
  }

  async function setImage(dataUrl) {
    if (!dataUrl) { wrap.hidden = true; img = null; return; }
    img = await loadImage(dataUrl);
    W = img.naturalWidth; H = img.naturalHeight;
    canvas.width = W; canvas.height = H;
    imgEl.src = dataUrl;
    clear();
    wrap.hidden = false;
  }

  function snapshot() {
    try {
      if (undoStack.length > 12) undoStack.shift();
      undoStack.push(ctx.getImageData(0, 0, W, H));
    } catch (e) { /* ignore */ }
  }

  function undo() {
    const s = undoStack.pop();
    if (s) ctx.putImageData(s, 0, 0);
  }

  function clear() {
    undoStack.length = 0;
    ctx.clearRect(0, 0, W, H);
  }

  function fillAll() {
    snapshot();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
  }

  function invert() {
    snapshot();
    const d = ctx.getImageData(0, 0, W, H);
    const a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const on = a[i + 3] > 10;
      a[i] = 255; a[i + 1] = 255; a[i + 2] = 255;
      a[i + 3] = on ? 0 : 255;
    }
    ctx.putImageData(d, 0, 0);
  }

  /* ------------------------- рисование ------------------------- */
  let drawing = false, last = null;

  const toCanvas = (t) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((t.clientX - r.left) / r.width) * W,
      y: ((t.clientY - r.top) / r.height) * H,
    };
  };

  const stroke = (a, b) => {
    ctx.globalCompositeOperation = mode === 'draw' ? 'source-over' : 'destination-out';
    const paint = sketch ? color : '#ffffff';
    ctx.strokeStyle = paint;
    ctx.fillStyle = paint;
    const r = canvas.getBoundingClientRect();
    const k = r.width ? W / r.width : 1;
    ctx.lineWidth = brush * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (!b) {
      ctx.arc(a.x, a.y, (brush * k) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  };

  wrap.addEventListener('touchstart', (e) => {
    if (!img || e.touches.length !== 1) return;
    e.preventDefault();
    snapshot();
    drawing = true;
    last = toCanvas(e.touches[0]);
    stroke(last, null);
  }, { passive: false });

  wrap.addEventListener('touchmove', (e) => {
    if (!drawing || e.touches.length !== 1) return;
    e.preventDefault();
    const p = toCanvas(e.touches[0]);
    stroke(last, p);
    last = p;
  }, { passive: false });

  wrap.addEventListener('touchend', () => { drawing = false; last = null; });

  wrap.addEventListener('mousedown', (e) => {
    if (!img) return;
    snapshot(); drawing = true; last = toCanvas(e); stroke(last, null);
  });
  wrap.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const p = toCanvas(e); stroke(last, p); last = p;
  });
  window.addEventListener('mouseup', () => { drawing = false; last = null; });

  /** Возвращает маску (белое = область инпейнта) или null, если пусто */
  function getMask() {
    if (!img) return null;
    const d = ctx.getImageData(0, 0, W, H).data;
    let any = false;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 10) { any = true; break; } }
    if (!any) return null;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d');
    octx.fillStyle = '#000000';
    octx.fillRect(0, 0, W, H);
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL('image/png');
  }

  /** Композит исходника и нарисованного слоя (режим «скетч») */
  function getComposite() {
    if (!img) return null;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const octx = out.getContext('2d');
    octx.drawImage(img, 0, 0, W, H);
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL('image/png');
  }

  function isEmpty() {
    if (!img) return true;
    const d = ctx.getImageData(0, 0, W, H).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) return false;
    return true;
  }

  setSketch(!!opts.sketch);
  return { el, setImage, getMask, getComposite, clear, setSketch, isEmpty,
    hasImage: () => !!img };
}
