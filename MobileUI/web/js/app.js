/* ==========================================================================
   app.js — точка входа: загрузка, роутинг вкладок, глобальные события
   ========================================================================== */
import { $, $$, h, toast, store, haptic } from './core.js';
import { S, bootstrap } from './state.js';
import { applyTheme, modelSheet, settingsSheet, queueSheet } from './settings.js';
import { interrupt, skipCurrent, applyInfotext } from './gen.js';
import * as T2I from './t2i.js';
import * as I2I from './i2i.js';
import * as EXTRAS from './extras.js';
import * as BROWSER from './browser.js';
import { pickImageSheet } from './browser.js';

const TITLES = {
  txt2img: 'txt2img',
  img2img: 'img2img',
  extras: 'Extras',
  browser: 'Галерея',
};

const MOUNTED = {};
let current = 'txt2img';
let wakeLock = null;

/* ------------------------------------------------------------------------ */
async function init() {
  /* Разовая миграция: раньше живой предпросмотр был включён по умолчанию и шёл
     через /sdapi/v1/progress, что вызывало VAE-декод в HTTP-потоке Forge. */
  if (!store.get('migr.safeProgress', false)) {
    store.set('livePreview', false);
    store.set('migr.safeProgress', true);
  }
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  const status = $('#splashStatus');
  try {
    await bootstrap((msg) => { status.textContent = msg; });
  } catch (e) {
    status.textContent = 'Не удалось подключиться к Forge. Проверьте, что WebUI запущен, и обновите страницу.';
    return;
  }

  buildTab('txt2img');
  switchTab(store.get('lastTab', 'txt2img'));
  wireChrome();
  wireEvents();

  const sp = $('#splash');
  sp.classList.add('hide');
  setTimeout(() => sp.remove(), 400);

  updateBar();
  registerSW();
}

/* ------------------------------- вкладки -------------------------------- */
function buildTab(name) {
  if (MOUNTED[name]) return MOUNTED[name];
  const root = $('#view-' + name);
  const mod = { txt2img: T2I, img2img: I2I, extras: EXTRAS, browser: BROWSER }[name];
  MOUNTED[name] = mod.mount(root);
  return MOUNTED[name];
}

function switchTab(name) {
  if (!TITLES[name]) name = 'txt2img';
  current = name;
  store.set('lastTab', name);
  buildTab(name);
  $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + name; });
  $$('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  $('#barTitle').textContent = TITLES[name];
  const runbar = $('#runbar');
  const showRun = name !== 'browser';
  runbar.hidden = !showRun;
  $('#views').classList.toggle('no-run', !showRun);
  if (showRun) {
    const label = name === 'extras' ? 'Обработать' : 'Генерация';
    $('#btnRun').dataset.label = label;
    if (!S.busy) $('#btnRun').querySelector('span').textContent = label;
  }
  window.scrollTo({ top: 0 });
  updateBar();
}

/* ------------------------------- каркас --------------------------------- */
function wireChrome() {
  $$('.tab').forEach((b) => b.addEventListener('click', () => {
    haptic(); switchTab(b.dataset.tab);
  }));
  $('#btnModel').addEventListener('click', () => modelSheet());
  $('#btnSettings').addEventListener('click', () => settingsSheet());
  $('#btnQueue').addEventListener('click', () => queueSheet());
  $('#btnStop').addEventListener('click', () => interrupt());
  $('#btnSkip').addEventListener('click', () => skipCurrent());
  $('#btnRun').addEventListener('click', async () => {
    const ui = MOUNTED[current];
    if (!ui || !ui.run) return;
    haptic(12);
    await acquireWake();
    try { await ui.run(); } finally { releaseWake(); }
  });
}

function updateBar() {
  const o = (S.boot && S.boot.options) || {};
  const m = (o.sd_model_checkpoint || '').split(/[\\/]/).pop() || '—';
  $('#barSub').textContent = m;
}

/* ------------------------------- события -------------------------------- */
function wireEvents() {
  /* отправка изображения между вкладками */
  window.addEventListener('fm:send', async (e) => {
    const { to, url, info } = e.detail;
    if (to === 'img2img') {
      switchTab('img2img');
      const ui = buildTab('img2img');
      await ui.setImage(url, info);
      toast('Изображение загружено в img2img', 'ok');
    } else if (to === 'extras') {
      switchTab('extras');
      const ui = buildTab('extras');
      ui.setImage(url);
      toast('Изображение загружено в Extras', 'ok');
    }
  });

  /* выбор изображения из папок Forge */
  window.addEventListener('fm:pickFromBrowser', (e) => {
    pickImageSheet(e.detail.cb);
  });

  /* применение infotext к txt2img */
  window.addEventListener('fm:applyInfo', (e) => {
    const ui = buildTab('txt2img');
    if (applyInfotext(S.t2i, e.detail.info)) {
      ui.refresh();
      switchTab('txt2img');
      toast('Параметры применены', 'ok');
    } else toast('Не удалось разобрать параметры', 'err');
  });

  /* добавление описания персонажа к текущему промпту */
  window.addEventListener('fm:appendPrompt', (e) => {
    const key = current === 'img2img' ? 'i2i' : 't2i';
    const params = key === 'i2i' ? S.i2i : S.t2i;
    const txt = e.detail.text || '';
    if (!txt) return;
    params.prompt = params.prompt ? params.prompt.replace(/,\s*$/, '') + ', ' + txt : txt;
    const ui = MOUNTED[current === 'img2img' ? 'img2img' : 'txt2img'];
    if (ui && ui.refresh) ui.refresh();
  });

  /* вставка текста в промпт txt2img */
  window.addEventListener('fm:prompt', (e) => {
    const ui = buildTab('txt2img');
    S.t2i.prompt = e.detail.text;
    ui.refresh();
    switchTab('txt2img');
    toast('Промпт обновлён', 'ok');
  });

  /* полная перерисовка после смены пресета/моделей */
  window.addEventListener('fm:refreshViews', () => {
    Object.keys(MOUNTED).forEach((k) => { if (MOUNTED[k].refresh) MOUNTED[k].refresh(); });
    updateBar();
  });

  window.addEventListener('fm:optionsChanged', updateBar);

  /* повторное подключение при возврате в приложение */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateBar();
  });
}

/* ---------------------------- wake lock --------------------------------- */
async function acquireWake() {
  if (!store.get('wakeLock', true)) return;
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* не поддерживается */ }
}

function releaseWake() {
  try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
}

/* ------------------------- service worker ------------------------------- */
function registerSW() {
  /* Service Worker доступен только в защищённом контексте (https / localhost).
     При доступе по IP в локальной сети он не регистрируется — это нормально,
     приложение работает и без него. */
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/* ------------------------------------------------------------------------ */
init();
