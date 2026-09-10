/* ==========================================================================
   browser.js — «Infinite image browsing»: папки, сетка, поиск, просмотр
   ========================================================================== */
import {
  h, icon, I, API, toast, haptic, store, openSheet, closeSheet, confirmSheet,
  lightbox, fmtBytes, parentDir, urlToDataURL, pickSheet,
} from './core.js';
import { S } from './state.js';

let ui = null;

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const VID_RE = /\.(mp4|webm|mov|mkv|avi)$/i;

export function mount(root) {
  if (ui) return ui;

  let cwd = null;             // текущая папка (null = корни)
  let files = [];             // элементы текущего списка
  let selection = new Set();
  let selMode = false;
  let cols = store.get('galCols', 3);
  let sortMode = store.get('galSort', 'date-desc');
  let searchQuery = '';

  const crumbs = h('div', { class: 'crumbs' });
  const grid = h('div', { class: 'gal-grid' });
  const listBox = h('div');
  const status = h('div', { class: 'muted', style: { padding: '10px 2px' } }, '');

  const btnBack = h('button', { class: 'btn', onclick: () => goUp() }, icon(I.up, 18));
  const btnSearch = h('button', { class: 'btn', onclick: () => searchSheet() }, icon(I.search, 18));
  const btnCols = h('button', {
    class: 'btn',
    onclick: () => { cols = cols >= 4 ? 2 : cols + 1; store.set('galCols', cols); applyCols(); haptic(); },
  }, icon(I.grid, 18));
  const btnSort = h('button', { class: 'btn', onclick: () => sortSheet() }, '↕');
  const btnSel = h('button', {
    class: 'btn',
    onclick: () => { selMode = !selMode; selection.clear(); render(); haptic(); },
  }, icon(I.check, 18));
  const btnMore = h('button', { class: 'btn', onclick: () => moreSheet() }, '⋯');

  const head = h('div', { class: 'gal-head' }, btnBack, btnSearch, btnCols, btnSort, btnSel, btnMore);
  const selBar = h('div', { class: 'result-actions', hidden: true });

  root.textContent = '';
  root.append(head, crumbs, selBar, listBox, grid, status);

  function applyCols() {
    grid.className = 'gal-grid' + (cols === 2 ? ' c2' : cols === 4 ? ' c4' : '');
  }
  applyCols();

  /* ------------------------------ навигация ------------------------------ */
  async function openRoots() {
    cwd = null; searchQuery = '';
    crumbs.textContent = '';
    grid.textContent = '';
    listBox.textContent = '';
    status.textContent = '';
    const folders = (S.boot.folders || []).filter((f) => f.exists);
    folders.forEach((f) => {
      listBox.append(h('button', {
        class: 'folder-row', onclick: () => openFolder(f.path),
      }, icon(I.folder, 22),
        h('div', { class: 'fname' }, f.title, h('span', { class: 'fsub' }, f.path))));
    });
    listBox.append(h('button', {
      class: 'folder-row', onclick: () => randomImages(),
    }, icon(I.star, 22), h('div', { class: 'fname' }, 'Случайные изображения',
      h('span', { class: 'fsub' }, 'из индекса базы'))));
    btnBack.hidden = true;
  }

  async function openFolder(path) {
    cwd = path; searchQuery = '';
    btnBack.hidden = false;
    status.textContent = 'Загрузка…';
    listBox.textContent = '';
    grid.textContent = '';
    drawCrumbs();
    try {
      const r = await API.fg('/infinite_image_browsing/files?folder_path=' + encodeURIComponent(path));
      const all = r.files || [];
      const dirs = all.filter((f) => f.type === 'dir');
      files = all.filter((f) => f.type === 'file' && (IMG_RE.test(f.name) || VID_RE.test(f.name)));
      sortFiles();
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      dirs.forEach((d) => listBox.append(h('button', {
        class: 'folder-row', onclick: () => openFolder(d.fullpath),
      }, icon(I.folder, 22), h('div', { class: 'fname' }, d.name,
        h('span', { class: 'fsub' }, d.date || '')))));
      render();
    } catch (e) {
      status.textContent = 'Ошибка: ' + e.message;
    }
  }

  function goUp() {
    if (!cwd) return;
    const roots = (S.boot.folders || []).map((f) => f.path.toLowerCase());
    if (roots.includes(String(cwd).toLowerCase())) { openRoots(); return; }
    const p = parentDir(cwd);
    if (!p || p === cwd) openRoots(); else openFolder(p);
  }

  function drawCrumbs() {
    crumbs.textContent = '';
    crumbs.append(h('button', { class: 'crumb', onclick: () => openRoots() }, 'Корни'));
    if (!cwd) return;
    const parts = String(cwd).split('\\').filter(Boolean);
    let acc = '';
    parts.forEach((p, i) => {
      acc = acc ? acc + '\\' + p : p + (parts.length > 1 ? '\\' : '');
      const target = parts.slice(0, i + 1).join('\\');
      crumbs.append(h('button', {
        class: 'crumb' + (i === parts.length - 1 ? ' on' : ''),
        onclick: () => openFolder(target),
      }, p));
    });
  }

  function sortFiles() {
    const cmp = {
      'date-desc': (a, b) => String(b.date).localeCompare(String(a.date)),
      'date-asc': (a, b) => String(a.date).localeCompare(String(b.date)),
      'name-asc': (a, b) => a.name.localeCompare(b.name),
      'name-desc': (a, b) => b.name.localeCompare(a.name),
      'size-desc': (a, b) => (b.bytes || 0) - (a.bytes || 0),
    }[sortMode];
    if (cmp) files.sort(cmp);
  }

  /* ------------------------------ отрисовка ------------------------------ */
  let io = null;
  function render() {
    grid.textContent = '';
    if (io) io.disconnect();
    io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const img = en.target;
        if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
        io.unobserve(img);
      });
    }, { rootMargin: '600px' });

    status.textContent = files.length ? files.length + ' файл(ов)' : 'Пусто';
    selBar.hidden = !selMode;
    if (selMode) {
      selBar.textContent = '';
      selBar.append(
        h('button', { class: 'btn', onclick: () => { files.forEach((f) => selection.add(f.fullpath)); render(); } }, 'Выбрать все'),
        h('button', { class: 'btn', onclick: () => { selection.clear(); render(); } }, 'Снять'),
        h('button', { class: 'btn danger', onclick: () => removeSelected() },
          icon(I.trash, 18), 'Удалить (' + selection.size + ')'));
    }

    const frag = document.createDocumentFragment();
    files.forEach((f, i) => {
      const isVid = VID_RE.test(f.name);
      const im = h('img', { alt: '', loading: 'lazy' });
      im.dataset.src = isVid
        ? '/forge/infinite_image_browsing/video_cover?path=' + encodeURIComponent(f.fullpath) + '&t=' + encodeURIComponent(f.date || '')
        : API.thumbUrl(f.fullpath, f.date, '320x320');
      im.addEventListener('load', () => im.classList.add('ready'));
      im.addEventListener('error', () => im.classList.add('ready'));
      const cell = h('div', {
        class: 'gal-cell' + (selection.has(f.fullpath) ? ' sel' : ''),
        onclick: () => {
          if (selMode) {
            if (selection.has(f.fullpath)) selection.delete(f.fullpath);
            else selection.add(f.fullpath);
            render(); haptic();
          } else openViewer(i);
        },
      }, im, isVid ? h('div', { class: 'badge' }, 'video') : null);
      frag.append(cell);
      io.observe(im);
    });
    grid.append(frag);
  }

  /* ------------------------------ просмотр ------------------------------ */
  function openViewer(i) {
    const items = files.map((f) => ({
      url: API.fileUrl(f.fullpath, f.date),
      name: f.name, path: f.fullpath, date: f.date, bytes: f.bytes,
    }));
    lightbox(items, i, {
      buttons: [
        {
          label: 'Параметры', icon: I.info,
          run: async (it, idx, ctx) => {
            if (!ctx.infoBox.hidden) { ctx.infoBox.hidden = true; return; }
            ctx.infoBox.hidden = false;
            ctx.infoBox.textContent = 'Загрузка…';
            try {
              const r = await API.fg('/infinite_image_browsing/image_geninfo?path=' + encodeURIComponent(it.path));
              ctx.infoBox.textContent = (typeof r === 'string' ? r : JSON.stringify(r)) ||
                'Нет метаданных\n' + it.path + '\n' + (it.date || '') + '  ' + fmtBytes(it.bytes);
            } catch (e) { ctx.infoBox.textContent = 'Ошибка: ' + e.message; }
          },
        },
        {
          label: 'В img2img', icon: I.send,
          run: async (it, idx, ctx) => {
            ctx.close();
            const d = await urlToDataURL(it.url);
            const info = await geninfo(it.path);
            window.dispatchEvent(new CustomEvent('fm:send', { detail: { to: 'img2img', url: d, info } }));
          },
        },
        {
          label: 'В Extras', icon: I.wand,
          run: async (it, idx, ctx) => {
            ctx.close();
            const d = await urlToDataURL(it.url);
            window.dispatchEvent(new CustomEvent('fm:send', { detail: { to: 'extras', url: d } }));
          },
        },
        {
          label: 'В txt2img', icon: I.copy,
          run: async (it, idx, ctx) => {
            const info = await geninfo(it.path);
            if (!info) { toast('Нет метаданных', 'err'); return; }
            ctx.close();
            window.dispatchEvent(new CustomEvent('fm:applyInfo', { detail: { info } }));
          },
        },
        {
          label: 'Скачать', icon: I.download,
          run: (it) => {
            const a = document.createElement('a');
            a.href = it.url + '&disposition=' + encodeURIComponent(it.name);
            a.download = it.name;
            document.body.append(a); a.click(); a.remove();
          },
        },
        {
          label: 'Удалить', icon: I.trash,
          run: async (it, idx, ctx) => {
            const ok = await confirmSheet('Удалить файл?', it.name, 'Удалить');
            if (!ok) return;
            try {
              await API.fpost('/infinite_image_browsing/delete_files', { file_paths: [it.path] });
              toast('Удалено', 'ok');
              ctx.close();
              files = files.filter((f) => f.fullpath !== it.path);
              render();
            } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
          },
        },
      ],
    });
  }

  async function geninfo(path) {
    try {
      const r = await API.fg('/infinite_image_browsing/image_geninfo?path=' + encodeURIComponent(path));
      return typeof r === 'string' ? r : '';
    } catch (e) { return ''; }
  }

  async function removeSelected() {
    if (!selection.size) return;
    const ok = await confirmSheet('Удалить файлы?', selection.size + ' файл(ов) будет удалено безвозвратно.', 'Удалить');
    if (!ok) return;
    try {
      await API.fpost('/infinite_image_browsing/delete_files', { file_paths: Array.from(selection) });
      files = files.filter((f) => !selection.has(f.fullpath));
      selection.clear();
      toast('Удалено', 'ok');
      render();
    } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  }

  /* ------------------------------ поиск ------------------------------ */
  function searchSheet() {
    const input = h('input', { type: 'search', placeholder: 'Текст в промпте…', value: searchQuery });
    const res = h('div', { class: 'muted', style: { padding: '10px 0' } },
      'Поиск идёт по индексу базы IIB. Если результатов нет — выполните индексацию (меню ⋯).');
    const go = async () => {
      searchQuery = input.value.trim();
      if (!searchQuery) return;
      res.textContent = 'Поиск…';
      try {
        const r = await API.fpost('/infinite_image_browsing/db/search_by_substr', {
          surstr: searchQuery, cursor: '', size: 300, media_type: 'all',
        });
        files = (r.files || []).filter((f) => IMG_RE.test(f.name) || VID_RE.test(f.name));
        cwd = null; btnBack.hidden = false;
        listBox.textContent = '';
        crumbs.textContent = '';
        crumbs.append(h('button', { class: 'crumb on' }, 'Поиск: ' + searchQuery));
        sortFiles(); render();
        closeSheet();
        toast(files.length + ' найдено');
      } catch (e) { res.textContent = 'Ошибка: ' + e.message; }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    openSheet({
      title: 'Поиск по промпту',
      body: h('div', null, input,
        h('button', { class: 'btn primary wide', style: { marginTop: '10px' }, onclick: go },
          icon(I.search, 18), 'Найти'), res),
    });
    setTimeout(() => input.focus(), 320);
  }

  function sortSheet() {
    pickSheet({
      title: 'Сортировка',
      items: [
        { value: 'date-desc', label: 'Дата ↓ (новые)' },
        { value: 'date-asc', label: 'Дата ↑' },
        { value: 'name-asc', label: 'Имя A→Я' },
        { value: 'name-desc', label: 'Имя Я→A' },
        { value: 'size-desc', label: 'Размер ↓' },
      ],
      value: sortMode,
      onPick: (v) => { sortMode = v; store.set('galSort', v); sortFiles(); render(); },
    });
  }

  async function randomImages() {
    status.textContent = 'Загрузка…';
    try {
      const r = await API.fg('/infinite_image_browsing/db/random_images');
      files = (r || []).filter((f) => IMG_RE.test(f.name));
      cwd = null; btnBack.hidden = false;
      listBox.textContent = '';
      crumbs.textContent = '';
      crumbs.append(h('button', { class: 'crumb on' }, 'Случайные'));
      render();
    } catch (e) { status.textContent = 'Ошибка: ' + e.message; }
  }

  function moreSheet() {
    const body = h('div', null,
      h('button', {
        class: 'btn wide', style: { marginBottom: '8px' },
        onclick: async () => {
          closeSheet(); toast('Индексация запущена…');
          try {
            await API.fpost('/infinite_image_browsing/db/update_image_data', {});
            toast('Индексация завершена', 'ok');
          } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
        },
      }, icon(I.refresh, 18), 'Обновить индекс базы'),
      h('button', {
        class: 'btn wide', style: { marginBottom: '8px' },
        onclick: async () => {
          closeSheet();
          try {
            const r = await API.fg('/infinite_image_browsing/db/basic_info');
            toast('В индексе: ' + r.img_count + ' изображений', 'ok', 4000);
          } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
        },
      }, icon(I.info, 18), 'Статистика индекса'),
      h('button', {
        class: 'btn wide', style: { marginBottom: '8px' },
        onclick: () => { closeSheet(); tagSheet(); },
      }, icon(I.tag, 18), 'Поиск по тегам'),
      h('button', {
        class: 'btn wide',
        onclick: () => { closeSheet(); if (cwd) openFolder(cwd); else openRoots(); },
      }, icon(I.refresh, 18), 'Обновить список'));
    openSheet({ title: 'Действия', body });
  }

  async function tagSheet() {
    try {
      const r = await API.fg('/infinite_image_browsing/db/basic_info');
      const tags = (r.tags || []).filter((t) => t.count > 0);
      if (!tags.length) { toast('Тегов нет'); return; }
      pickSheet({
        title: 'Теги',
        items: tags.map((t) => ({ value: t.id, label: t.display_name || t.name, sub: t.type + ' · ' + t.count })),
        onPick: async (id) => {
          status.textContent = 'Загрузка…';
          try {
            const rr = await API.fpost('/infinite_image_browsing/db/match_images_by_tags', {
              and_tags: [id], or_tags: [], not_tags: [], cursor: '', size: 300,
            });
            files = (rr.files || []).filter((f) => IMG_RE.test(f.name));
            cwd = null; btnBack.hidden = false;
            listBox.textContent = '';
            crumbs.textContent = '';
            crumbs.append(h('button', { class: 'crumb on' }, 'Тег'));
            render();
          } catch (e) { status.textContent = 'Ошибка: ' + e.message; }
        },
      });
    } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
  }

  openRoots();

  ui = {
    refresh() { if (cwd) openFolder(cwd); else openRoots(); },
    run() { toast('На этой вкладке генерация недоступна'); },
  };
  return ui;
}

/* ------------------------------------------------------------------------ */
/*  Выбор изображения из папок (для img2img / Extras)                        */
/* ------------------------------------------------------------------------ */
export async function pickImageSheet(cb) {
  const grid = h('div', { class: 'gal-grid' });
  const status = h('div', { class: 'muted', style: { padding: '8px 0' } }, 'Загрузка…');
  const crumb = h('div', { class: 'crumbs' });
  const dirs = h('div');
  const body = h('div', null, crumb, dirs, status, grid);
  openSheet({ title: 'Выбор изображения', body, full: true });

  const roots = (S.boot.folders || []).filter((f) => f.exists);

  async function show(path, title) {
    status.textContent = 'Загрузка…';
    grid.textContent = '';
    dirs.textContent = '';
    crumb.textContent = '';
    crumb.append(h('button', { class: 'crumb', onclick: () => showRoots() }, 'Папки'),
      h('button', { class: 'crumb on' }, title));
    try {
      const r = await API.fg('/infinite_image_browsing/files?folder_path=' + encodeURIComponent(path));
      const list = (r.files || []).filter((f) => f.type === 'file' && IMG_RE.test(f.name))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 200);
      const subdirs = (r.files || []).filter((f) => f.type === 'dir');
      status.textContent = list.length + ' изображений';
      subdirs.forEach((d) => crumb.append(h('button', {
        class: 'crumb', onclick: () => show(d.fullpath, d.name),
      }, '📁 ' + d.name)));
      list.forEach((f) => {
        const im = h('img', { loading: 'lazy', src: API.thumbUrl(f.fullpath, f.date, '240x240'), alt: '' });
        im.addEventListener('load', () => im.classList.add('ready'));
        grid.append(h('div', {
          class: 'gal-cell',
          onclick: async () => {
            toast('Загрузка изображения…');
            try {
              const d = await urlToDataURL(API.fileUrl(f.fullpath, f.date));
              closeSheet();
              cb(d);
            } catch (e) { toast('Ошибка: ' + e.message, 'err'); }
          },
        }, im));
      });
    } catch (e) { status.textContent = 'Ошибка: ' + e.message; }
  }

  function showRoots() {
    grid.textContent = '';
    crumb.textContent = '';
    dirs.textContent = '';
    status.textContent = roots.length ? 'Выберите папку' : 'Папки не найдены';
    roots.forEach((f) => dirs.append(
      h('button', { class: 'folder-row', onclick: () => show(f.path, f.title) },
        icon(I.folder, 22), h('div', { class: 'fname' }, f.title))));
  }

  if (roots.length) show(roots[0].path, roots[0].title);
  else showRoots();
}

export function get() { return ui; }
