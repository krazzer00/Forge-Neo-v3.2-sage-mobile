/* ==========================================================================
   extras.js — вкладка Extras: апскейл, удаление фона, ReActor,
   реставрация старых фото, интеррогатор, PNG Info
   ========================================================================== */
import {
  h, icon, I, API, toast, b64Only, asDataURL, downloadDataURL, haptic, lightbox,
  fileToDataURL, shrinkDataURL,
} from './core.js';
import { Slider, Select, Switch, Segmented, TextField, ImagePicker, Accordion } from './ui.js';
import { S } from './state.js';
import { setRunning } from './gen.js';
import { store as ST } from './core.js';

let ui = null;

const OPS = [
  { value: 'upscale', label: 'Апскейл' },
  { value: 'rembg', label: 'Фон' },
  { value: 'reactor', label: 'Лица' },
  { value: 'restore', label: 'Ретушь' },
  { value: 'interrogate', label: 'CLIP' },
  { value: 'pnginfo', label: 'PNG Info' },
];

export function mount(root) {
  if (ui) return ui;
  const B = S.boot;
  const st = ST.get('extras', {
    op: 'upscale',
    resize_mode: 0, upscaling_resize: 2, upscaling_resize_w: 1024, upscaling_resize_h: 1024,
    upscaling_crop: true, upscaler_1: '4x-UltraSharp', upscaler_2: 'None',
    extras_upscaler_2_visibility: 0, gfpgan_visibility: 0, codeformer_visibility: 0,
    codeformer_weight: 0, upscale_first: false,
    rembg_model: 'isnet-general-use', rembg_mask: false, rembg_alpha: false,
    rembg_fg: 240, rembg_bg: 10, rembg_erode: 10,
    re_model: 'inswapper_128.onnx', re_src_idx: '0', re_dst_idx: '0',
    re_upscaler: 'None', re_scale: 1, re_vis: 1, re_restorer: 'CodeFormer',
    re_rest_vis: 1, re_cf_weight: 0.5, re_restore_first: true, re_device: 'CUDA',
    re_gender_src: 0, re_gender_dst: 0, re_mask_face: false, re_det_thresh: 0.5, re_det_max: 0,
    op_scratch: false, op_hr: false, op_face: false, op_cpu: false,
    clip_model: 'ViT-L-14/openai', clip_mode: 'fast',
  });
  const save = () => ST.set('extras', st);

  /* --------------------------- источник --------------------------- */
  const fromBrowser = h('button', {
    class: 'btn',
    onclick: () => window.dispatchEvent(new CustomEvent('fm:pickFromBrowser', {
      detail: { cb: (d) => picker.set(d) },
    })),
  }, icon(I.folder, 18), 'Из папок');

  /* пакетная обработка (только апскейл) */
  let batchFiles = [];
  const batchInfo = h('div', { class: 'muted' }, '');
  const batchInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onchange: async (e) => {
      const fl = Array.from(e.target.files || []);
      e.target.value = '';
      batchFiles = [];
      for (const f of fl) {
        const d = await fileToDataURL(f);
        batchFiles.push({ name: f.name, data: await shrinkDataURL(d, 4096) });
      }
      updBatch();
    },
  });
  const batchBtn = h('button', { class: 'btn', onclick: () => batchInput.click() },
    icon(I.layers, 18), 'Пакет');
  const batchClear = h('button', {
    class: 'btn', onclick: () => { batchFiles = []; updBatch(); },
  }, icon(I.trash, 18));
  function updBatch() {
    batchInfo.textContent = batchFiles.length
      ? 'В пакете: ' + batchFiles.length + ' файл(ов) — источник выше игнорируется'
      : '';
    batchClear.hidden = !batchFiles.length;
  }

  const picker = ImagePicker({
    label: 'Изображение',
    extraButtons: [fromBrowser, batchBtn, batchClear],
  });
  const srcPicker = ImagePicker({ label: 'Лицо-источник (ReActor)' });
  updBatch();

  /* --------------------------- результат --------------------------- */
  const outStage = h('div', { class: 'result-stage auto' },
    h('div', { class: 'result-empty' }, icon(I.wand, 38), h('div', null, 'Результат появится здесь')));
  const outActions = h('div', { class: 'result-actions' });
  const textOut = h('div', {
    class: 'lb-info', hidden: true,
    style: { borderRadius: '12px', marginTop: '8px', maxHeight: '40vh' },
  });

  let outData = null;
  function showResult(dataUrl) {
    outData = dataUrl;
    batchGrid.hidden = true;
    outStage.textContent = '';
    outStage.append(h('img', {
      src: dataUrl, alt: '',
      onclick: () => lightbox([{ url: dataUrl, name: 'extras.png' }], 0, {
        buttons: [{ label: 'Сохранить', icon: I.download, run: () => downloadDataURL(dataUrl, 'extras.png') }],
      }),
    }));
    outActions.textContent = '';
    outActions.append(
      h('button', { class: 'btn', onclick: () => downloadDataURL(dataUrl, 'extras-' + Date.now() + '.png') },
        icon(I.download, 18), 'Сохранить'),
      h('button', { class: 'btn', onclick: () => picker.set(dataUrl) }, icon(I.recycle, 18), 'В источник'),
      h('button', {
        class: 'btn',
        onclick: () => window.dispatchEvent(new CustomEvent('fm:send',
          { detail: { to: 'img2img', url: dataUrl } })),
      }, icon(I.send, 18), 'В img2img'));
  }

  function showText(txt) {
    textOut.hidden = false;
    textOut.textContent = txt;
  }

  function showBatch(items) {
    outStage.textContent = '';
    outStage.append(h('div', { class: 'result-empty' },
      h('div', null, 'Пакет: ' + items.length + ' изображений')));
    outActions.textContent = '';
    outActions.append(h('button', {
      class: 'btn',
      onclick: () => items.forEach((it, i) => setTimeout(() => downloadDataURL(it.url, it.name), i * 300)),
    }, icon(I.download, 18), 'Скачать все'));
    batchGrid.hidden = false;
    batchGrid.textContent = '';
    items.forEach((it, i) => {
      const im = h('img', { src: it.url, alt: '' });
      im.classList.add('ready');
      batchGrid.append(h('div', {
        class: 'gal-cell',
        onclick: () => lightbox(items, i, {
          buttons: [{ label: 'Сохранить', icon: I.download, run: (x) => downloadDataURL(x.url, x.name) }],
        }),
      }, im));
    });
  }

  /* --------------------------- панели --------------------------- */
  const panels = {};

  /* --- апскейл --- */
  const upModeSeg = Segmented({
    label: 'Тип масштабирования',
    items: [{ value: 0, label: 'Множитель' }, { value: 1, label: 'До размера' }],
    value: st.resize_mode,
    onChange: (v) => { st.resize_mode = v; save(); syncUp(); },
  });
  const upScale = Slider({
    label: 'Масштаб', min: 1, max: 8, step: 0.05, value: st.upscaling_resize,
    onChange: (v) => { st.upscaling_resize = v; save(); },
  });
  const upW = Slider({
    label: 'Ширина', min: 64, max: 8192, step: 8, value: st.upscaling_resize_w,
    onChange: (v) => { st.upscaling_resize_w = v; save(); },
  });
  const upH = Slider({
    label: 'Высота', min: 64, max: 8192, step: 8, value: st.upscaling_resize_h,
    onChange: (v) => { st.upscaling_resize_h = v; save(); },
  });
  const upCrop = Switch({
    label: 'Обрезать до размера', value: st.upscaling_crop,
    onChange: (v) => { st.upscaling_crop = v; save(); },
  });
  function syncUp() {
    upScale.el.hidden = st.resize_mode !== 0;
    upW.el.hidden = upH.el.hidden = upCrop.el.hidden = st.resize_mode !== 1;
  }
  const faceAcc = Accordion({ title: 'Восстановление лиц', open: false });
  faceAcc.body.append(
    Slider({
      label: 'GFPGAN', min: 0, max: 1, step: 0.01, value: st.gfpgan_visibility,
      onChange: (v) => { st.gfpgan_visibility = v; save(); },
    }).el,
    Slider({
      label: 'CodeFormer', min: 0, max: 1, step: 0.01, value: st.codeformer_visibility,
      onChange: (v) => { st.codeformer_visibility = v; save(); },
    }).el,
    Slider({
      label: 'Вес CodeFormer', min: 0, max: 1, step: 0.01, value: st.codeformer_weight,
      onChange: (v) => { st.codeformer_weight = v; save(); },
    }).el,
    Switch({
      label: 'Апскейл до восстановления', value: st.upscale_first,
      onChange: (v) => { st.upscale_first = v; save(); },
    }).el);

  panels.upscale = h('div', { class: 'card card-pad' },
    upModeSeg.el, upScale.el, upW.el, upH.el, upCrop.el,
    Select({
      label: 'Апскейлер 1', items: B.upscalers, value: st.upscaler_1,
      onChange: (v) => { st.upscaler_1 = v; save(); },
    }).el,
    Select({
      label: 'Апскейлер 2', items: B.upscalers, value: st.upscaler_2,
      onChange: (v) => { st.upscaler_2 = v; save(); },
    }).el,
    Slider({
      label: 'Видимость апскейлера 2', min: 0, max: 1, step: 0.01,
      value: st.extras_upscaler_2_visibility,
      onChange: (v) => { st.extras_upscaler_2_visibility = v; save(); },
    }).el,
    faceAcc.el);
  syncUp();

  /* --- rembg --- */
  panels.rembg = h('div', { class: 'card card-pad' },
    Select({
      label: 'Модель', items: B.rembg_models, value: st.rembg_model,
      onChange: (v) => { st.rembg_model = v; save(); },
    }).el,
    Switch({
      label: 'Вернуть маску', value: st.rembg_mask,
      onChange: (v) => { st.rembg_mask = v; save(); },
    }).el,
    Switch({
      label: 'Alpha matting', value: st.rembg_alpha,
      onChange: (v) => { st.rembg_alpha = v; save(); },
    }).el,
    Slider({
      label: 'Порог переднего плана', min: 0, max: 255, step: 1, value: st.rembg_fg,
      onChange: (v) => { st.rembg_fg = v; save(); },
    }).el,
    Slider({
      label: 'Порог фона', min: 0, max: 255, step: 1, value: st.rembg_bg,
      onChange: (v) => { st.rembg_bg = v; save(); },
    }).el,
    Slider({
      label: 'Erode size', min: 0, max: 64, step: 1, value: st.rembg_erode,
      onChange: (v) => { st.rembg_erode = v; save(); },
    }).el);

  /* --- reactor --- */
  panels.reactor = h('div', { class: 'card card-pad' },
    srcPicker.el,
    Select({
      label: 'Модель', items: B.reactor.models.length ? B.reactor.models : ['inswapper_128.onnx'],
      value: st.re_model, onChange: (v) => { st.re_model = v; save(); },
    }).el,
    h('div', { class: 'row' },
      TextField({
        label: 'Лица источника', value: st.re_src_idx, placeholder: '0',
        onChange: (v) => { st.re_src_idx = v; save(); },
      }).el,
      TextField({
        label: 'Лица цели', value: st.re_dst_idx, placeholder: '0',
        onChange: (v) => { st.re_dst_idx = v; save(); },
      }).el),
    Select({
      label: 'Восстановление лица', items: ['None', 'CodeFormer', 'GFPGAN'],
      value: st.re_restorer, onChange: (v) => { st.re_restorer = v; save(); },
    }).el,
    Slider({
      label: 'Видимость восстановления', min: 0, max: 1, step: 0.01, value: st.re_rest_vis,
      onChange: (v) => { st.re_rest_vis = v; save(); },
    }).el,
    Slider({
      label: 'Вес CodeFormer', min: 0, max: 1, step: 0.01, value: st.re_cf_weight,
      onChange: (v) => { st.re_cf_weight = v; save(); },
    }).el,
    Select({
      label: 'Апскейлер', items: B.reactor.upscalers.length ? B.reactor.upscalers : B.upscalers,
      value: st.re_upscaler, onChange: (v) => { st.re_upscaler = v; save(); },
    }).el,
    Slider({
      label: 'Масштаб', min: 1, max: 4, step: 0.05, value: st.re_scale,
      onChange: (v) => { st.re_scale = v; save(); },
    }).el,
    Slider({
      label: 'Видимость апскейла', min: 0, max: 1, step: 0.01, value: st.re_vis,
      onChange: (v) => { st.re_vis = v; save(); },
    }).el,
    Select({
      label: 'Устройство', items: ['CUDA', 'CPU'], value: st.re_device,
      onChange: (v) => { st.re_device = v; save(); },
    }).el,
    Select({
      label: 'Пол (источник)',
      items: [{ value: 0, label: 'Любой' }, { value: 1, label: 'Женский' }, { value: 2, label: 'Мужской' }],
      value: st.re_gender_src, onChange: (v) => { st.re_gender_src = v; save(); },
    }).el,
    Select({
      label: 'Пол (цель)',
      items: [{ value: 0, label: 'Любой' }, { value: 1, label: 'Женский' }, { value: 2, label: 'Мужской' }],
      value: st.re_gender_dst, onChange: (v) => { st.re_gender_dst = v; save(); },
    }).el,
    Switch({
      label: 'Коррекция маски лица', value: st.re_mask_face,
      onChange: (v) => { st.re_mask_face = v; save(); },
    }).el,
    Switch({
      label: 'Сначала восстановить, потом апскейл', value: st.re_restore_first,
      onChange: (v) => { st.re_restore_first = v; save(); },
    }).el,
    Slider({
      label: 'Порог детекции', min: 0.1, max: 1, step: 0.01, value: st.re_det_thresh,
      onChange: (v) => { st.re_det_thresh = v; save(); },
    }).el,
    Slider({
      label: 'Макс. лиц (0 = все)', min: 0, max: 20, step: 1, value: st.re_det_max,
      onChange: (v) => { st.re_det_max = v; save(); },
    }).el);

  /* --- old photo restoration --- */
  panels.restore = h('div', { class: 'card card-pad' },
    Switch({ label: 'Убрать царапины', value: st.op_scratch, onChange: (v) => { st.op_scratch = v; save(); } }).el,
    Switch({ label: 'Высокое разрешение', value: st.op_hr, onChange: (v) => { st.op_hr = v; save(); } }).el,
    Switch({ label: 'Восстановить лица', value: st.op_face, onChange: (v) => { st.op_face = v; save(); } }).el,
    Switch({ label: 'Только CPU', value: st.op_cpu, onChange: (v) => { st.op_cpu = v; save(); } }).el);

  /* --- interrogate --- */
  panels.interrogate = h('div', { class: 'card card-pad' },
    Select({
      label: 'CLIP-модель', items: B.interrogators, value: st.clip_model,
      onChange: (v) => { st.clip_model = v; save(); },
    }).el,
    Segmented({
      label: 'Режим', items: ['best', 'fast', 'classic', 'negative'], value: st.clip_mode,
      onChange: (v) => { st.clip_mode = v; save(); },
    }).el,
    h('div', { class: 'muted' }, 'Первый запуск скачивает и загружает модель — это может занять время.'));

  /* --- png info --- */
  panels.pnginfo = h('div', { class: 'card card-pad' },
    h('div', { class: 'muted' }, 'Извлекает параметры генерации из PNG и позволяет применить их к txt2img.'));

  /* --------------------------- переключатель --------------------------- */
  const panelBox = h('div');
  const opSeg = Segmented({
    items: OPS, value: st.op,
    onChange: (v) => { st.op = v; save(); syncOp(); },
  });
  function syncOp() {
    panelBox.textContent = '';
    panelBox.append(panels[st.op]);
    srcPicker.el.hidden = st.op !== 'reactor';
    textOut.hidden = true;
    batchBtn.hidden = st.op !== 'upscale';
    batchInfo.hidden = st.op !== 'upscale';
    if (st.op !== 'upscale') batchClear.hidden = true; else updBatch();
  }
  syncOp();

  const batchGrid = h('div', { class: 'gal-grid', hidden: true, style: { marginTop: '8px' } });

  root.textContent = '';
  root.append(
    h('div', { class: 'card card-pad' }, opSeg.el, picker.el, batchInfo, batchInput),
    panelBox,
    h('div', { class: 'card card-pad' }, outStage, outActions, batchGrid, textOut));

  /* --------------------------- выполнение --------------------------- */
  async function run() {
    const img = picker.get();
    const isBatch = st.op === 'upscale' && batchFiles.length > 0;
    if (!img && !isBatch) { toast('Выберите изображение', 'err'); return; }
    setRunning(true);
    S.busy = true;
    const t0 = Date.now();
    try {
      let resp = null;
      if (isBatch) {
        const common = {
          resize_mode: st.resize_mode,
          show_extras_results: true,
          gfpgan_visibility: st.gfpgan_visibility,
          codeformer_visibility: st.codeformer_visibility,
          codeformer_weight: st.codeformer_weight,
          upscaling_resize: st.upscaling_resize,
          upscaling_resize_w: Math.round(st.upscaling_resize_w),
          upscaling_resize_h: Math.round(st.upscaling_resize_h),
          upscaling_crop: st.upscaling_crop,
          upscaler_1: st.upscaler_1,
          upscaler_2: st.upscaler_2,
          extras_upscaler_2_visibility: st.extras_upscaler_2_visibility,
          upscale_first: st.upscale_first,
        };
        const r = await API.fpost('/sdapi/v1/extra-batch-images', Object.assign({
          imageList: batchFiles.map((f) => ({ data: b64Only(f.data), name: f.name })),
        }, common));
        const outs = (r && r.images) || [];
        if (!outs.length) { toast('Пустой ответ', 'err'); return; }
        showBatch(outs.map((b, i) => ({
          url: asDataURL(b, 'image/png'),
          name: 'up-' + (batchFiles[i] ? batchFiles[i].name : i + '.png'),
        })));
        toast('Готово: ' + outs.length + ' шт. за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с', 'ok');
        return;
      }
      if (st.op === 'upscale') {
        resp = await API.fpost('/sdapi/v1/extra-single-image', {
          image: b64Only(img),
          resize_mode: st.resize_mode,
          show_extras_results: true,
          gfpgan_visibility: st.gfpgan_visibility,
          codeformer_visibility: st.codeformer_visibility,
          codeformer_weight: st.codeformer_weight,
          upscaling_resize: st.upscaling_resize,
          upscaling_resize_w: Math.round(st.upscaling_resize_w),
          upscaling_resize_h: Math.round(st.upscaling_resize_h),
          upscaling_crop: st.upscaling_crop,
          upscaler_1: st.upscaler_1,
          upscaler_2: st.upscaler_2,
          extras_upscaler_2_visibility: st.extras_upscaler_2_visibility,
          upscale_first: st.upscale_first,
        });
      } else if (st.op === 'rembg') {
        if (st.rembg_model === 'None') { toast('Выберите модель', 'err'); return; }
        resp = await API.fpost('/rembg', {
          input_image: b64Only(img),
          model: st.rembg_model,
          return_mask: st.rembg_mask,
          alpha_matting: st.rembg_alpha,
          alpha_matting_foreground_threshold: Math.round(st.rembg_fg),
          alpha_matting_background_threshold: Math.round(st.rembg_bg),
          alpha_matting_erode_size: Math.round(st.rembg_erode),
        });
      } else if (st.op === 'reactor') {
        const src = srcPicker.get();
        if (!src) { toast('Загрузите лицо-источник', 'err'); return; }
        resp = await API.fpost('/reactor/image', {
          source_image: b64Only(src),
          target_image: b64Only(img),
          source_faces_index: parseIdx(st.re_src_idx),
          face_index: parseIdx(st.re_dst_idx),
          upscaler: st.re_upscaler,
          scale: st.re_scale,
          upscale_visibility: st.re_vis,
          face_restorer: st.re_restorer,
          restorer_visibility: st.re_rest_vis,
          codeformer_weight: st.re_cf_weight,
          restore_first: st.re_restore_first ? 1 : 0,
          model: st.re_model,
          gender_source: st.re_gender_src,
          gender_target: st.re_gender_dst,
          save_to_file: 0,
          device: st.re_device,
          mask_face: st.re_mask_face ? 1 : 0,
          select_source: 0,
          det_thresh: st.re_det_thresh,
          det_maxnum: Math.round(st.re_det_max),
        });
      } else if (st.op === 'restore') {
        resp = await API.fpost('/bopb2l/restore', {
          image: b64Only(img),
          scratch: st.op_scratch, hr: st.op_hr,
          face_res: st.op_face, cpu: st.op_cpu,
        });
      } else if (st.op === 'interrogate') {
        const r = await API.fpost('/interrogator/prompt', {
          image: b64Only(img),
          clip_model_name: st.clip_model,
          mode: st.clip_mode,
        });
        const txt = (r && (r.prompt || r.caption || r.result)) || JSON.stringify(r);
        showText(txt);
        outActions.textContent = '';
        outActions.append(h('button', {
          class: 'btn primary',
          onclick: () => window.dispatchEvent(new CustomEvent('fm:prompt', { detail: { text: txt } })),
        }, icon(I.send, 18), 'В промпт txt2img'));
        toast('Готово', 'ok');
        return;
      } else if (st.op === 'pnginfo') {
        const r = await API.fpost('/sdapi/v1/png-info', { image: b64Only(img) });
        const txt = (r && r.info) || 'Нет метаданных';
        showText(txt);
        outActions.textContent = '';
        outActions.append(h('button', {
          class: 'btn primary',
          onclick: () => window.dispatchEvent(new CustomEvent('fm:applyInfo', { detail: { info: txt } })),
        }, icon(I.send, 18), 'Применить к txt2img'));
        toast('Готово', 'ok');
        return;
      }

      const b64 = resp && (resp.image || (resp.images && resp.images[0]));
      if (!b64) { toast('Пустой ответ от Forge', 'err'); return; }
      showResult(asDataURL(b64, 'image/png'));
      toast('Готово за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с', 'ok');
      haptic(20);
    } catch (e) {
      toast('Ошибка: ' + e.message, 'err', 5000);
    } finally {
      S.busy = false;
      setRunning(false);
    }
  }

  ui = {
    run,
    setImage(dataUrl) { picker.set(dataUrl); },
    refresh() {},
  };
  return ui;
}

function parseIdx(s) {
  return String(s || '0').split(/[,\s]+/).map((x) => parseInt(x, 10))
    .filter((x) => Number.isFinite(x));
}

export function get() { return ui; }
