/* ==========================================================================
   settings.js — шторки «Модель» и «Настройки», состояние системы
   ========================================================================== */
import {
  h, icon, I, API, toast, openSheet, closeSheet, pickSheet, store, fmtBytes, haptic,
} from './core.js';
import { Select, Switch, Slider } from './ui.js';
import { S, applyPresetDefaults, saveParams } from './state.js';

/* ------------------------------------------------------------------------ */
/*  Применение опций Forge                                                   */
/* ------------------------------------------------------------------------ */
async function setOptions(patch, msg) {
  try {
    toast(msg || 'Применяю…');
    await API.fpost('/sdapi/v1/options', patch);
    Object.assign(S.boot.options, patch);
    toast('Готово', 'ok');
    window.dispatchEvent(new CustomEvent('fm:optionsChanged'));
    return true;
  } catch (e) {
    toast('Ошибка: ' + e.message, 'err', 5000);
    return false;
  }
}

/* ------------------------------------------------------------------------ */
/*  Шторка выбора модели                                                     */
/* ------------------------------------------------------------------------ */
export function modelSheet() {
  const B = S.boot;
  const o = B.options || {};
  const body = h('div');

  const ckptSel = Select({
    label: 'Чекпоинт',
    items: (B.checkpoints || []).map((c) => ({
      value: c.title, label: c.name || c.title, sub: c.title,
    })),
    value: o.sd_model_checkpoint,
    onChange: (v) => setOptions({ sd_model_checkpoint: v }, 'Загрузка модели…'),
  });

  const modNames = (B.modules || []).map((m) => ({ value: m.filename, label: m.name, sub: m.filename }));
  const curMods = o.forge_additional_modules || [];
  const modBtn = h('button', { class: 'select' },
    h('div', { class: 'val' }, curMods.length ? curMods.map(shortName).join(', ') : 'Нет'),
    icon(I.chevronDown, 18));
  modBtn.addEventListener('click', () => {
    pickSheet({
      title: 'VAE / Text Encoder', items: modNames, multi: true, value: curMods.slice(),
      onPick: (v) => {
        modBtn.querySelector('.val').textContent = v.length ? v.map(shortName).join(', ') : 'Нет';
        setOptions({ forge_additional_modules: v });
      },
    });
  });

  const presetSel = Select({
    label: 'UI Preset',
    items: B.presets, value: o.forge_preset,
    onChange: async (v) => {
      await setOptions({ forge_preset: v }, 'Смена пресета…');
      applyPresetDefaults(true);
      saveParams('t2i', S.t2i); saveParams('i2i', S.i2i);
      window.dispatchEvent(new CustomEvent('fm:refreshViews'));
    },
  });

  const dtypeSel = Select({
    label: 'Diffusion in Low Bits',
    items: B.unet_dtypes, value: o.forge_unet_storage_dtype,
    onChange: (v) => setOptions({ forge_unet_storage_dtype: v }),
  });

  body.append(
    ckptSel.el,
    h('div', { class: 'field' }, h('div', { class: 'label' }, 'VAE / Text Encoder'), modBtn),
    presetSel.el,
    dtypeSel.el,
    h('div', { class: 'divider' }),
    h('button', {
      class: 'btn wide', style: { marginBottom: '8px' },
      onclick: async () => {
        closeSheet();
        toast('Обновление списков…');
        try {
          await API.post('/api/refresh', {});
          const fresh = await API.get('/api/bootstrap?refresh=1');
          if (fresh && fresh.ok) {
            S.boot = fresh;
            window.dispatchEvent(new CustomEvent('fm:refreshViews'));
            toast('Списки обновлены', 'ok');
          }
        } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
      },
    }, icon(I.refresh, 18), 'Обновить модели / LoRA'),
    h('button', {
      class: 'btn wide',
      onclick: async () => {
        closeSheet();
        try { await API.fpost('/sdapi/v1/unload-checkpoint', {}); toast('Модель выгружена', 'ok'); }
        catch (e) { toast('Ошибка: ' + e.message, 'err'); }
      },
    }, icon(I.trash, 18), 'Выгрузить модель из VRAM'));

  openSheet({ title: 'Модель', body, full: true });
}

function shortName(p) {
  return String(p).split(/[\\/]/).pop();
}

/* ------------------------------------------------------------------------ */
/*  Шторка настроек приложения                                               */
/* ------------------------------------------------------------------------ */
export function settingsSheet() {
  const body = h('div');

  const theme = Select({
    label: 'Тема',
    items: [
      { value: 'dark', label: 'Тёмная' },
      { value: 'light', label: 'Светлая' },
      { value: 'auto', label: 'Как в системе' },
    ],
    value: store.get('theme', 'dark'),
    onChange: (v) => { store.set('theme', v); applyTheme(); },
  });

  const live = Switch({
    label: 'Живой предпросмотр',
    sub: 'Промежуточные кадры. Требует VAE-декода во время сэмплинга — ' +
         'при --cuda-stream это может дестабилизировать Forge',
    value: store.get('livePreview', false),
    onChange: (v) => store.set('livePreview', v),
  });

  const keepAwake = Switch({
    label: 'Не гасить экран',
    sub: 'Удерживать экран включённым во время генерации',
    value: store.get('wakeLock', true),
    onChange: (v) => store.set('wakeLock', v),
  });

  const saveImgs = Switch({
    label: 'Сохранять результаты на ПК',
    sub: 'Записывать изображения в output Forge',
    value: S.t2i.save_images !== false,
    onChange: (v) => {
      S.t2i.save_images = v; S.i2i.save_images = v;
      saveParams('t2i', S.t2i); saveParams('i2i', S.i2i);
    },
  });

  body.append(theme.el, live.el, keepAwake.el, saveImgs.el, h('div', { class: 'divider' }));

  /* системная информация */
  const sys = h('div', { class: 'grid2' });
  body.append(h('div', { class: 'label' }, 'Система'), sys, h('div', { class: 'divider' }));
  refreshSys(sys);

  body.append(
    h('button', {
      class: 'btn wide', style: { marginBottom: '8px' },
      onclick: () => refreshSys(sys),
    }, icon(I.refresh, 18), 'Обновить статистику'),
    h('button', {
      class: 'btn wide', style: { marginBottom: '8px' },
      onclick: async () => {
        try { await API.fpost('/sdapi/v1/interrupt', {}); toast('Прервано', 'ok'); }
        catch (e) { toast('Ошибка', 'err'); }
      },
    }, icon(I.close, 18), 'Прервать текущую задачу'),
    h('button', {
      class: 'btn wide', style: { marginBottom: '8px' },
      onclick: () => {
        store.del('params.t2i'); store.del('params.i2i');
        store.del('ext.txt2img'); store.del('ext.img2img');
        toast('Настройки сброшены, перезагрузка…');
        setTimeout(() => location.reload(), 700);
      },
    }, icon(I.trash, 18), 'Сбросить параметры и расширения'),
    h('a', {
      class: 'btn wide', style: { marginBottom: '8px', textDecoration: 'none' },
      href: '/forge/', target: '_blank', rel: 'noopener',
    }, icon(I.layers, 18), 'Открыть полный интерфейс Forge'),
    h('div', { class: 'muted', style: { textAlign: 'center', marginTop: '10px' } },
      'Forge Mobile UI · порт 9595'));

  openSheet({ title: 'Настройки', body, full: true });
}

async function refreshSys(box) {
  box.textContent = '';
  box.append(h('div', { class: 'stat' }, h('b', null, '…'), h('span', null, 'загрузка')));
  try {
    const mem = await API.fg('/sdapi/v1/memory');
    const cuda = (mem && mem.cuda) || {};
    const sys = cuda.system || {};
    const ram = (mem && mem.ram) || {};
    box.textContent = '';
    box.append(
      stat(fmtBytes(sys.free), 'VRAM свободно'),
      stat(fmtBytes(sys.total), 'VRAM всего'),
      stat(fmtBytes(ram.free), 'RAM свободно'),
      stat(fmtBytes(ram.total), 'RAM всего'),
      stat(shortName(S.boot.options.sd_model_checkpoint || '—'), 'Модель'),
      stat(S.boot.options.forge_preset || '—', 'Пресет'));
  } catch (e) {
    box.textContent = '';
    box.append(h('div', { class: 'stat' }, h('b', null, '—'), h('span', null, 'нет данных')));
  }
}

function stat(v, label) {
  return h('div', { class: 'stat' }, h('b', null, String(v)), h('span', null, label));
}

/* ------------------------------------------------------------------------ */
/*  Тема                                                                     */
/* ------------------------------------------------------------------------ */
export function applyTheme() {
  const t = store.get('theme', 'dark');
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/* ------------------------------------------------------------------------ */
/*  Очередь / состояние                                                      */
/* ------------------------------------------------------------------------ */
/**
 * Состояние Forge. Намеренно не используется /sdapi/v1/progress: его обработчик
 * запускает VAE-декод латента в HTTP-потоке (см. комментарий в gen.js).
 */
export async function queueSheet() {
  const body = h('div', null, h('div', { class: 'muted' }, 'Загрузка…'));
  openSheet({ title: 'Состояние Forge', body });
  try {
    const tasks = await API.fg('/internal/pending-tasks');
    const p = S.progress || {};
    const busy = S.busy;
    body.textContent = '';
    body.append(
      h('div', { class: 'grid2' },
        stat(busy ? 'генерация' : 'ожидание', 'Состояние'),
        stat(((p.progress || 0) * 100).toFixed(0) + '%', 'Прогресс'),
        stat((p.eta || 0).toFixed(0) + ' с', 'Осталось'),
        stat(String((tasks && tasks.size) || 0), 'В очереди'),
        stat(S.taskId ? S.taskId.replace(/^task\(|\)$/g, '') : '—', 'Задача'),
        stat(shortName(S.boot.options.sd_model_checkpoint || '—'), 'Модель')),
      h('div', { class: 'divider' }),
      h('div', { class: 'muted' }, p.textinfo || 'нет активной задачи'),
      h('button', {
        class: 'btn danger wide', style: { marginTop: '12px' },
        onclick: async () => {
          await API.fpost('/sdapi/v1/interrupt', {});
          toast('Прервано'); closeSheet();
        },
      }, 'Прервать'));
  } catch (e) {
    body.textContent = '';
    body.append(h('div', { class: 'warnbox' }, 'Forge не отвечает: ' + e.message));
  }
}
