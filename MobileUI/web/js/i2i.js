/* ==========================================================================
   i2i.js — вкладка img2img (скетч и inpaint с рисованием маски)
   ========================================================================== */
import { h, icon, I, toast, b64Only, loadImage, store } from './core.js';
import { Slider, Select, Switch, Segmented, Accordion, ImagePicker } from './ui.js';
import { S, saveParams } from './state.js';
import { MaskEditor } from './mask.js';
import {
  promptBlock, coreBlock, extensionsBlock, scriptBlock, resultBlock,
  basePayload, runGeneration, pushHistory, applyInfotext,
} from './gen.js';
import { PresetBlock } from './presets.js';
import { ReferenceBlock } from './characters.js';

let ui = null;

/* Бюджет пикселей для автоподбора размера при загрузке изображения.
   Фото с телефона (12 Мп) в исходном разрешении гарантированно кладут
   диффузию по VRAM, поэтому целевой размер приводится к разумному. */
const AUTO_MP = 1.15;            // ~1024×1120
const MAX_SIDE = 2048;
const WARN_MP = 2.4;             // порог предупреждения

export function mount(root) {
  if (ui) return ui;
  const params = S.i2i;
  const save = () => saveParams('i2i', params);

  const result = resultBlock('img2img');
  const prompt = promptBlock(params, 'i2i');
  const core = coreBlock(params, 'i2i');
  const mask = MaskEditor();

  /* ---------------- изображение-источник ---------------- */
  const fromGalleryBtn = h('button', {
    class: 'btn',
    onclick: () => window.dispatchEvent(new CustomEvent('fm:pickFromBrowser', {
      detail: { cb: (dataUrl) => setSource(dataUrl) },
    })),
  }, icon(I.folder, 18), 'Из папок');

  const picker = ImagePicker({
    label: 'Исходное изображение',
    extraButtons: [fromGalleryBtn],
    onChange: (d) => setSource(d, true),
  });

  let srcW = 0, srcH = 0;

  /** Вписывает исходные пропорции в бюджет пикселей, кратно 16 */
  function autoSize(w, hgt) {
    const budget = AUTO_MP * 1e6;
    let k = Math.sqrt(budget / (w * hgt));
    if (k > 1) k = 1;                       // не увеличиваем маленькие картинки
    let nw = w * k, nh = hgt * k;
    const m = Math.max(nw, nh);
    if (m > MAX_SIDE) { nw *= MAX_SIDE / m; nh *= MAX_SIDE / m; }
    return {
      w: Math.max(64, Math.round(nw / 16) * 16),
      h: Math.max(64, Math.round(nh / 16) * 16),
    };
  }

  async function setSource(dataUrl, skipPicker) {
    if (!skipPicker) picker.set(dataUrl);
    if (!dataUrl) { srcW = srcH = 0; mask.setImage(null); updSizeHint(); return; }
    const im = await loadImage(dataUrl);
    srcW = im.naturalWidth; srcH = im.naturalHeight;
    if (store.get('autoSize', true)) {
      const a = autoSize(srcW, srcH);
      params.width = a.w; params.height = a.h;
      core.refresh(); save();
    }
    await mask.setImage(dataUrl);
    updSizeHint();
  }

  /* ---------------- режим ---------------- */
  const modeSeg = Segmented({
    items: [
      { value: 'img2img', label: 'img2img' },
      { value: 'sketch', label: 'Скетч' },
      { value: 'inpaint', label: 'Inpaint' },
    ],
    value: params.i2i_mode,
    onChange: (v) => { params.i2i_mode = v; save(); mask.clear(); syncMode(); },
  });

  const inpaintBox = h('div');
  const maskAcc = Accordion({ title: 'Маска (рисуйте пальцем)', open: true });
  maskAcc.body.append(mask.el);

  function syncMode() {
    const m = params.i2i_mode;
    const draw = m === 'inpaint' || m === 'sketch';
    maskAcc.el.hidden = !draw;
    inpaintBox.hidden = m !== 'inpaint';
    mask.setSketch(m === 'sketch');
    maskAcc.setTitle(m === 'sketch' ? 'Рисование поверх изображения' : 'Маска (рисуйте пальцем)');
  }

  /* ---------------- параметры inpaint ---------------- */
  const maskBlur = Slider({
    label: 'Размытие маски', min: 0, max: 64, step: 1, value: params.mask_blur,
    onChange: (v) => { params.mask_blur = v; save(); },
  });
  const fillSel = Select({
    label: 'Содержимое под маской',
    items: [
      { value: 0, label: 'fill — заливка' },
      { value: 1, label: 'original — оригинал' },
      { value: 2, label: 'latent noise' },
      { value: 3, label: 'latent nothing' },
    ],
    value: params.inpainting_fill,
    onChange: (v) => { params.inpainting_fill = v; save(); },
  });
  const areaSel = Select({
    label: 'Область инпейнта',
    items: [
      { value: false, label: 'Всё изображение' },
      { value: true, label: 'Только маска' },
    ],
    value: params.inpaint_full_res,
    onChange: (v) => { params.inpaint_full_res = v; save(); },
  });
  const padding = Slider({
    label: 'Отступ «только маска»', min: 0, max: 256, step: 4,
    value: params.inpaint_full_res_padding,
    onChange: (v) => { params.inpaint_full_res_padding = v; save(); },
  });
  const invertSw = Switch({
    label: 'Инвертировать маску', value: !!params.inpainting_mask_invert,
    onChange: (v) => { params.inpainting_mask_invert = v ? 1 : 0; save(); },
  });
  inpaintBox.append(maskBlur.el, fillSel.el, areaSel.el, padding.el, invertSw.el);

  /* ---------------- общие параметры img2img ---------------- */
  const denoise = Slider({
    label: 'Denoising strength', min: 0, max: 1, step: 0.01, value: params.i2i_denoise,
    onChange: (v) => { params.i2i_denoise = v; save(); },
  });

  const resizeSel = Select({
    label: 'Режим масштабирования',
    items: [
      { value: 0, label: 'Just resize' },
      { value: 1, label: 'Crop and resize' },
      { value: 2, label: 'Resize and fill' },
      { value: 3, label: 'Just resize (latent)' },
    ],
    value: params.resize_mode,
    onChange: (v) => { params.resize_mode = v; save(); },
  });

  const scaleSeg = Segmented({
    label: 'Размер результата',
    items: [{ value: 'to', label: 'Указать W×H' }, { value: 'by', label: 'Множитель' }],
    value: params.i2i_scale_mode,
    onChange: (v) => { params.i2i_scale_mode = v; save(); syncScale(); },
  });

  const scaleBy = Slider({
    label: 'Множитель', min: 0.25, max: 4, step: 0.05, value: params.i2i_scale_by,
    onChange: (v) => { params.i2i_scale_by = v; save(); updSizeHint(); },
  });

  const autoSw = Switch({
    label: 'Подбирать размер автоматически',
    sub: 'Вписывать фото в ~1 Мп при загрузке',
    value: store.get('autoSize', true),
    onChange: (v) => store.set('autoSize', v),
  });

  const fitBtn = h('button', {
    class: 'btn wide', style: { marginBottom: '10px' },
    onclick: () => {
      if (!srcW) { toast('Сначала загрузите изображение'); return; }
      const a = autoSize(srcW, srcH);
      params.width = a.w; params.height = a.h;
      params.i2i_scale_mode = 'to';
      scaleSeg.set('to'); core.refresh(); save(); syncScale();
      toast('Размер: ' + a.w + '×' + a.h, 'ok');
    },
  }, icon(I.crop, 18), 'Подогнать под безопасный размер');

  const sizeHint = h('div', { class: 'muted', style: { marginBottom: '10px' } }, '');
  const sizeWarn = h('div', { class: 'warnbox', hidden: true }, '');

  function updSizeHint() {
    if (!srcW) { sizeHint.textContent = ''; sizeWarn.hidden = true; return; }
    const t = targetSize();
    const mp = (t.w * t.h) / 1e6;
    sizeHint.textContent =
      `Источник ${srcW}×${srcH} → результат ${t.w}×${t.h} (${mp.toFixed(1)} Мп)`;
    if (mp > WARN_MP) {
      sizeWarn.hidden = false;
      sizeWarn.textContent = 'Разрешение ' + t.w + '×' + t.h + ' (' + mp.toFixed(1) +
        ' Мп) велико для диффузии — вероятна нехватка VRAM и аварийное завершение Forge. ' +
        'Нажмите «Подогнать под безопасный размер».';
    } else {
      sizeWarn.hidden = true;
    }
  }

  function targetSize() {
    if (params.i2i_scale_mode === 'by' && srcW) {
      return {
        w: Math.round((srcW * params.i2i_scale_by) / 16) * 16,
        h: Math.round((srcH * params.i2i_scale_by) / 16) * 16,
      };
    }
    return { w: Math.round(params.width), h: Math.round(params.height) };
  }

  function syncScale() {
    scaleBy.el.hidden = params.i2i_scale_mode !== 'by';
    updSizeHint();
  }

  const refresh = () => {
    core.refresh(); prompt.refreshPrompt();
    denoise.set(params.i2i_denoise); resizeSel.set(params.resize_mode);
    scaleSeg.set(params.i2i_scale_mode); scaleBy.set(params.i2i_scale_by);
    maskBlur.set(params.mask_blur); fillSel.set(params.inpainting_fill);
    areaSel.set(!!params.inpaint_full_res); padding.set(params.inpaint_full_res_padding);
    invertSw.set(!!params.inpainting_mask_invert);
    modeSeg.set(params.i2i_mode);
    syncMode(); syncScale();
  };

  const imgCard = h('div', { class: 'card card-pad' },
    modeSeg.el, picker.el, maskAcc.el, denoise.el, resizeSel.el,
    scaleSeg.el, scaleBy.el, sizeHint, sizeWarn, fitBtn, autoSw.el, inpaintBox);

  root.textContent = '';
  root.append(
    result.el,
    prompt,
    ReferenceBlock(),
    PresetBlock('img2img', params, refresh),
    imgCard,
    core.el,
    scriptBlock('img2img', params),
    extensionsBlock('img2img'),
  );
  syncMode(); syncScale();

  ui = {
    params, result, refresh,
    async setImage(dataUrl, info) {
      await setSource(dataUrl);
      if (info) { applyInfotext(params, info); save(); }
      refresh();
    },
    async run() {
      const src = picker.get();
      if (!src) { toast('Загрузите исходное изображение', 'err'); return; }

      const t = targetSize();
      const mp = (t.w * t.h) / 1e6;
      if (mp > 4) {
        toast('Слишком большое разрешение (' + mp.toFixed(1) + ' Мп). Уменьшите размер.',
          'err', 5000);
        return;
      }
      pushHistory(params); save();

      const payload = basePayload(params, 'img2img');
      payload.width = t.w; payload.height = t.h;

      let initImage = src;
      if (params.i2i_mode === 'sketch' && !mask.isEmpty()) {
        initImage = mask.getComposite() || src;
      }
      payload.init_images = [b64Only(initImage)];
      payload.denoising_strength = params.i2i_denoise;
      payload.resize_mode = params.resize_mode;

      if (params.i2i_mode === 'inpaint') {
        const m = mask.getMask();
        if (!m) { toast('Нарисуйте маску', 'err'); return; }
        payload.mask = b64Only(m);
        payload.mask_blur = params.mask_blur;
        payload.inpainting_fill = params.inpainting_fill;
        payload.inpaint_full_res = !!params.inpaint_full_res;
        payload.inpaint_full_res_padding = params.inpaint_full_res_padding;
        payload.inpainting_mask_invert = params.inpainting_mask_invert ? 1 : 0;
      }
      await runGeneration({
        endpoint: '/sdapi/v1/img2img', payload, result, mode: 'img2img',
      });
    },
  };
  return ui;
}

export function get() { return ui; }
