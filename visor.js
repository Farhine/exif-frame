// Visor SD: abre la carpeta de la cámara (o fotos sueltas) desde la tarjeta,
// junta los pares JPG + RAW (p. ej. ORF de Olympus) del mismo disparo y los
// muestra en una galería por día con un visor a pantalla completa
// (deslizar para cambiar, pellizcar o doble toque para zoom, bajar para cerrar).
// Todo se procesa en el celular: nada se sube a internet.

const THUMB_PX = 256;          // lado corto de las miniaturas generadas
const THUMB_QUALITY = 0.75;
const MIN_PREVIEW_SIDE = 200;  // vista previa incrustada mínima para usarla de miniatura
const JPG_HEAD_BYTES = 1 << 20; // las vistas previas de los JPG van en el primer MB
const RAW_HEAD_BYTES = 4 << 20;
const THUMB_WORKERS = 2;       // miniaturas en paralelo (cada una decodifica una foto entera)
const TILE_SIZES = [84, 112, 168];
const KEEP_AROUND = 2;         // fotos a cada lado que el visor mantiene decodificadas
const MAX_ZOOM = 6;
const TAP_ZOOM = 2.5;
const SLIDE_GAP = 24;
const LONG_PRESS_MS = 450;
const DOUBLE_TAP_MS = 280;
const FRAME_WARN_COUNT = 30;

const FILTERS = {
  all: { label: 'Todas', test: () => true },
  pair: { label: 'JPG + RAW', test: (it) => Boolean(it.img && it.raw) },
  img: { label: 'Solo JPG', test: (it) => Boolean(it.img && !it.raw) },
  raw: { label: 'Solo RAW', test: (it) => Boolean(!it.img && it.raw) },
};

const $ = (id) => document.getElementById(id);
const els = {
  pickFiles: $('pick-files'),
  pickFolder: $('pick-folder'),
  openToggle: $('open-toggle'),
  openMenu: $('open-menu'),
  selectToggle: $('select-toggle'),
  empty: $('empty'),
  hint: $('platform-hint'),
  toolbar: $('toolbar'),
  summary: $('summary'),
  filters: $('filters'),
  sort: $('sort'),
  size: $('size'),
  gallery: $('gallery'),
  selbar: $('selbar'),
  selcount: $('selcount'),
  selShare: $('sel-share'),
  selDownload: $('sel-download'),
  selFrame: $('sel-frame'),
  viewer: $('viewer'),
  stage: $('v-stage'),
  track: $('v-track'),
  vName: $('v-name'),
  vPos: $('v-pos'),
  vBadge: $('v-badge'),
  vPrev: $('v-prev'),
  vNext: $('v-next'),
  vClose: $('v-close'),
  vInfo: $('v-info'),
  vShare: $('v-share'),
  vDownload: $('v-download'),
  vFrame: $('v-frame'),
  panel: $('v-panel'),
  panelClose: $('v-panel-close'),
  details: $('v-details'),
  status: $('status'),
  loader: $('loader'),
  loaderTitle: $('loader-title'),
  loaderTime: $('loader-time'),
  loaderHide: $('loader-hide'),
};

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const canPickFolder = 'webkitdirectory' in els.pickFolder && !isIOS;
document.body.classList.toggle('no-folder', !canPickFolder);

// ---------- Estado ----------

/**
 * Un disparo: la foto (JPG u otro formato común) y/o su RAW.
 * { key, name, img: File|null, raw: File|null, date, thumb: url|null, thumbPromise, broken, details }
 */
let items = [];
let view = []; // items visibles con el filtro y orden actuales
let ignored = 0;
const ui = { filter: 'all', newestFirst: true, size: 1, selecting: false };
const selected = new Set();
const tileItem = new WeakMap();

try {
  const saved = JSON.parse(localStorage.getItem('visor-ui') || '{}');
  if (typeof saved.newestFirst === 'boolean') ui.newestFirst = saved.newestFirst;
  if (TILE_SIZES[saved.size]) ui.size = saved.size;
} catch { /* sin almacenamiento: valores por defecto */ }

function saveUi() {
  try {
    localStorage.setItem('visor-ui', JSON.stringify({ newestFirst: ui.newestFirst, size: ui.size }));
  } catch { /* no importa */ }
}

// ---------- Utilidades ----------

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseName = (name) => name.replace(/\.[^.]+$/, '');
const extOf = (file) => fileExt(file).toUpperCase();
const mainFile = (it) => it.img || it.raw;
const filesOf = (it) => [it.img, it.raw].filter(Boolean);
const plural = (n, one, many) => `${n.toLocaleString('es')} ${n === 1 ? one : many}`;

function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toLocaleString('es', { maximumFractionDigits: i > 1 ? 1 : 0 })} ${units[i]}`;
}

function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(t) {
  const s = new Date(t).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s[0].toUpperCase() + s.slice(1);
}

const timeLabel = (t) => new Date(t).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function setBusy(message) {
  els.status.textContent = message || '';
  els.status.hidden = !message;
}

function toBlob(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/jpeg', quality);
  });
}

/** Dibuja un <img> o canvas (con naturalWidth/Height) y lo devuelve como JPEG. */
function sourceToJpeg(src, maxShort = Infinity, quality = 0.92) {
  const s = Math.min(1, maxShort / Math.min(src.naturalWidth, src.naturalHeight));
  if (s === 1 && src instanceof HTMLCanvasElement) return toBlob(src, quality);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.naturalWidth * s));
  c.height = Math.max(1, Math.round(src.naturalHeight * s));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return toBlob(c, quality);
}

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
};

// El menú de compartir rechaza archivos sin tipo (pasa con algunos lectores de tarjetas)
function withType(file) {
  if (file.type) return file;
  return new File([file], file.name, { type: MIME_BY_EXT[fileExt(file)] || 'application/octet-stream', lastModified: file.lastModified });
}

async function rawToJpegFile(raw) {
  const { blob, img, orientation } = await extractRawPreview(raw);
  const jpeg = orientation === 1 ? blob : await sourceToJpeg(applyOrientation(img, orientation));
  return new File([jpeg], `${baseName(raw.name)}.jpg`, { type: 'image/jpeg', lastModified: raw.lastModified });
}

// ---------- Cargar archivos ----------

function shotKey(file) {
  return (file.webkitRelativePath || file.name).replace(/\.[^./]+$/, '').toLowerCase();
}

function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const byKey = new Map(items.map((it) => [it.key, it]));
  const before = items.length;
  for (const file of files) {
    const kind = fileKind(file);
    // Videos, archivos de la cámara y los "._" que deja macOS en la tarjeta
    if (!kind || file.name.startsWith('._')) { ignored += 1; continue; }
    const key = shotKey(file);
    let item = byKey.get(key);
    if (!item) {
      item = { key, name: baseName(file.name), img: null, raw: null, date: file.lastModified, thumb: null };
      byKey.set(key, item);
      items.push(item);
    }
    item[kind === 'raw' ? 'raw' : 'img'] = file;
    item.date = Math.min(item.date, file.lastModified);
    item.details = null;
  }
  els.pickFiles.value = '';
  els.pickFolder.value = '';
  if (!items.length) {
    alert('No encontré fotos en lo que elegiste. Prueba con la carpeta DCIM de la tarjeta.');
    return;
  }
  if (items.length === before && files.length) setBusy('Esas fotos ya estaban abiertas');
  setTimeout(() => setBusy(''), 1800);
  refresh();
}

// ---------- Galería ----------

function refresh() {
  const dir = ui.newestFirst ? -1 : 1;
  view = items
    .filter(FILTERS[ui.filter].test)
    .sort((a, b) => dir * (a.date - b.date || a.name.localeCompare(b.name, undefined, { numeric: true })));
  render();
}

function render() {
  const has = items.length > 0;
  els.empty.hidden = has;
  els.toolbar.hidden = !has;
  els.selectToggle.hidden = !has;
  els.gallery.style.setProperty('--tile', `${TILE_SIZES[ui.size]}px`);
  els.sort.textContent = ui.newestFirst ? '↓ Recientes' : '↑ Antiguas';
  renderSummary();
  renderFilters();
  renderGallery();
  renderSelbar();
}

function renderSummary() {
  const days = new Set(items.map((it) => dayKey(it.date))).size;
  const bytes = items.reduce((sum, it) => sum + filesOf(it).reduce((s, f) => s + f.size, 0), 0);
  const pairs = items.filter(FILTERS.pair.test).length;
  els.summary.textContent = [
    plural(items.length, 'foto', 'fotos'),
    pairs && `${pairs.toLocaleString('es')} con RAW`,
    plural(days, 'día', 'días'),
    formatBytes(bytes),
    ignored && plural(ignored, 'archivo omitido', 'archivos omitidos'),
  ].filter(Boolean).join(' · ');
}

function renderFilters() {
  const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, items.filter(f.test).length]));
  const kinds = ['pair', 'img', 'raw'].filter((k) => counts[k] > 0);
  if (!counts[ui.filter]) ui.filter = 'all';
  els.filters.hidden = kinds.length < 2;
  els.filters.innerHTML = '';
  for (const key of ['all', ...kinds]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${key === ui.filter ? ' active' : ''}`;
    b.dataset.filter = key;
    b.textContent = FILTERS[key].label;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = counts[key].toLocaleString('es');
    b.append(n);
    els.filters.append(b);
  }
}

function badgeFor(item) {
  if (item.img && item.raw) return `${extOf(item.img)}+${extOf(item.raw)}`;
  if (item.raw) return extOf(item.raw);
  return ['JPG', 'JPEG'].includes(extOf(item.img)) ? '' : extOf(item.img);
}

function makeTile(item, index) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile';
  tile.dataset.i = index;
  tile.setAttribute('aria-label', item.name);
  tile.classList.toggle('selected', selected.has(item));
  tileItem.set(tile, item);

  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  tile.append(img);

  const badge = badgeFor(item);
  if (badge) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = badge;
    tile.append(b);
  }
  const check = document.createElement('span');
  check.className = 'check';
  tile.append(check);

  if (item.broken) tile.classList.add('broken');
  else thumbs.watch(tile);
  return tile;
}

function renderGallery() {
  thumbs.reset();
  els.gallery.innerHTML = '';
  const groups = [];
  for (const item of view) {
    const key = dayKey(item.date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, date: item.date, items: [item] });
  }
  let index = 0;
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'day';
    const head = document.createElement('div');
    head.className = 'day-head';
    const h = document.createElement('h2');
    h.textContent = dayLabel(group.date);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = plural(group.items.length, 'foto', 'fotos');
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'day-pick';
    pick.dataset.from = index;
    pick.dataset.count = group.items.length;
    pick.textContent = 'Elegir día';
    head.append(h, n, pick);

    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const item of group.items) grid.append(makeTile(item, index++));
    section.append(head, grid);
    els.gallery.append(section);
  }
}

// ---------- Miniaturas ----------

// Las miniaturas salen, si se puede, de la vista previa chica que la cámara guarda
// dentro del archivo: decodificar una foto de 20 MP entera usa ~80 MB de memoria.

/** La vista previa JPEG incrustada más chica que sirva de miniatura, o null. */
async function embeddedPreview(file, limit) {
  const bytes = new Uint8Array(await file.slice(0, limit).arrayBuffer());
  // start > 0 descarta la foto principal de un JPG; de la más chica a la más grande
  const found = findEmbeddedJpegs(bytes).filter((j) => j.start > 0).reverse();
  for (const { start, end } of found) {
    const blob = new Blob([bytes.subarray(start, end)], { type: 'image/jpeg' });
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      continue;
    }
    if (Math.min(bitmap.width, bitmap.height) >= MIN_PREVIEW_SIDE) {
      // Si la vista previa trae su propia orientación el navegador ya la aplicó
      const own = await readOrientation(blob);
      return { src: bitmap, orientation: own !== 1 ? 1 : await readOrientation(file) };
    }
    bitmap.close();
  }
  return null;
}

async function thumbSource(file) {
  const kind = fileKind(file);
  if (kind === 'native' || kind === 'raw') {
    const preview = await embeddedPreview(file, kind === 'raw' ? RAW_HEAD_BYTES : JPG_HEAD_BYTES);
    if (preview) return preview;
  }
  if (kind === 'native') {
    try {
      // Un ImageBitmap reducido se libera apenas se cierra (un <img> espera al recolector)
      return { src: await createImageBitmap(file, { resizeWidth: THUMB_PX * 1.5, resizeQuality: 'medium' }), orientation: 1 };
    } catch {
      return { src: await blobToImage(file), orientation: 1 };
    }
  }
  return { src: await decodePhoto(file), orientation: 1 };
}

/** Dibuja la miniatura (lado corto = THUMB_PX) ya girada según la orientación EXIF. */
function drawThumb(src, orientation) {
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;
  const s = Math.min(1, THUMB_PX / Math.min(sw, sh));
  const w = Math.max(1, Math.round(sw * s));
  const h = Math.max(1, Math.round(sh * s));
  const deg = { 3: 180, 6: 90, 8: 270 }[orientation] || 0;
  const swap = deg === 90 || deg === 270;
  const c = document.createElement('canvas');
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return c;
}

async function makeThumb(file) {
  const { src, orientation } = await thumbSource(file);
  try {
    const canvas = drawThumb(src, orientation);
    const blob = await toBlob(canvas, THUMB_QUALITY);
    canvas.width = 0; // libera la memoria del canvas
    return URL.createObjectURL(blob);
  } finally {
    src.close?.();
  }
}

function thumbFor(item) {
  item.thumbPromise ||= makeThumb(mainFile(item)).then((url) => {
    item.thumb = url;
    return url;
  }, (err) => {
    item.broken = true;
    throw err;
  });
  return item.thumbPromise;
}

// Solo se generan y se muestran las miniaturas que están (o están por estar) en
// pantalla. Las que quedan lejos se sueltan para no acumular miles de imágenes en memoria.
const thumbs = (() => {
  const waiting = new Map(); // tile → item, en orden de llegada
  const near = new Set();    // casillas cerca de la pantalla
  let running = 0;

  function show(tile, url) {
    const img = tile.querySelector('img');
    if (img.getAttribute('src') === url) return;
    img.onload = () => img.classList.add('ready');
    img.src = url;
  }

  function hide(tile) {
    const img = tile.querySelector('img');
    if (!img.hasAttribute('src')) return;
    img.removeAttribute('src');
    img.classList.remove('ready');
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const item = tileItem.get(e.target);
      if (!e.isIntersecting) {
        near.delete(e.target);
        waiting.delete(e.target);
        hide(e.target);
      } else {
        near.add(e.target);
        if (item.thumb) show(e.target, item.thumb);
        else if (!item.broken) waiting.set(e.target, item);
      }
    }
    pump();
  }, { rootMargin: '1200px 0px' });

  function pump() {
    while (running < THUMB_WORKERS && waiting.size) {
      const [tile, item] = waiting.entries().next().value;
      waiting.delete(tile);
      running += 1;
      thumbFor(item)
        .then((url) => { if (near.has(tile)) show(tile, url); })
        .catch(() => tile.classList.add('broken'))
        .finally(() => { running -= 1; pump(); });
    }
  }

  return {
    watch: (tile) => io.observe(tile),
    reset: () => { io.disconnect(); waiting.clear(); near.clear(); },
  };
})();

// ---------- Selección ----------

function setSelecting(on) {
  ui.selecting = on;
  if (!on) {
    selected.clear();
    els.gallery.querySelectorAll('.tile.selected').forEach((t) => t.classList.remove('selected'));
  }
  document.body.classList.toggle('selecting', on);
  els.selectToggle.textContent = on ? 'Cancelar' : 'Seleccionar';
  renderSelbar();
}

function toggleTile(tile) {
  const item = tileItem.get(tile);
  if (selected.has(item)) selected.delete(item);
  else selected.add(item);
  tile.classList.toggle('selected', selected.has(item));
  renderSelbar();
}

function toggleRange(from, count) {
  const range = view.slice(from, from + count);
  const all = range.every((it) => selected.has(it));
  range.forEach((it) => (all ? selected.delete(it) : selected.add(it)));
  els.gallery.querySelectorAll('.tile').forEach((t) => t.classList.toggle('selected', selected.has(tileItem.get(t))));
  renderSelbar();
}

function renderSelbar() {
  els.selbar.hidden = !ui.selecting;
  els.selcount.textContent = selected.size
    ? plural(selected.size, 'elegida', 'elegidas')
    : 'Toca las fotos';
  [els.selShare, els.selDownload, els.selFrame].forEach((b) => { b.disabled = selected.size === 0; });
}

const chosen = () => view.filter((it) => selected.has(it));

// ---------- Acciones ----------

async function shareItems(list) {
  if (!list.length) return;
  try {
    const files = [];
    for (const [i, item] of list.entries()) {
      if (item.img) {
        files.push(withType(item.img));
      } else {
        setBusy(list.length > 1 ? `Preparando ${i + 1} de ${list.length}…` : 'Preparando JPG…');
        files.push(await rawToJpegFile(item.raw)); // el RAW no se puede compartir a la galería
      }
    }
    setBusy('');
    await deliverFiles(files);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy('');
  }
}

async function downloadItems(list) {
  const files = list.flatMap(filesOf);
  for (const [i, file] of files.entries()) {
    if (files.length > 1) setBusy(`Descargando ${i + 1} de ${files.length}…`);
    downloadBlob(file, file.name);
    if (files.length > 1) await sleep(400); // el navegador ignora descargas muy seguidas
  }
  setBusy('');
}

async function sendToFrame(list) {
  if (!list.length) return;
  if (list.length > FRAME_WARN_COUNT
    && !confirm(`Vas a enviar ${list.length} fotos a EXIF Frame. Puede tardar un poco. ¿Seguir?`)) return;
  setBusy('Abriendo EXIF Frame…');
  try {
    await putHandoff(list.map(mainFile));
    location.href = './?desde=visor';
  } catch (err) {
    setBusy('');
    alert(`No se pudieron pasar las fotos: ${err.message}`);
  }
}

// ---------- Visor a pantalla completa ----------

const V = {
  index: -1,
  slides: [], // [anterior, actual, siguiente]
  zoom: { s: 1, tx: 0, ty: 0 },
  size: { w: 0, h: 0 },
  infoOpen: false,
  animating: false,
};
const fullCache = new Map(); // item → Promise<url>

for (let k = 0; k < 3; k++) {
  const slide = document.createElement('div');
  slide.className = 'slide';
  slide.innerHTML = '<img alt="" draggable="false" decoding="async"><div class="spinner"></div><p class="slide-error"></p>';
  els.track.append(slide);
  V.slides.push(slide);
}

async function makeFullUrl(file) {
  const kind = fileKind(file);
  if (kind === 'native') return URL.createObjectURL(file);
  if (kind === 'raw') {
    const { blob, img, orientation } = await extractRawPreview(file);
    if (orientation === 1) return URL.createObjectURL(blob);
    return URL.createObjectURL(await sourceToJpeg(applyOrientation(img, orientation)));
  }
  return URL.createObjectURL(await sourceToJpeg(await decodePhoto(file)));
}

function fullUrl(item) {
  if (!fullCache.has(item)) {
    const promise = makeFullUrl(mainFile(item));
    promise.catch(() => { if (fullCache.get(item) === promise) fullCache.delete(item); });
    fullCache.set(item, promise);
  }
  return fullCache.get(item);
}

function trimCache(keepAll = false) {
  const keep = keepAll ? new Set() : new Set(view.slice(Math.max(0, V.index - KEEP_AROUND), V.index + KEEP_AROUND + 1));
  for (const [item, promise] of fullCache) {
    if (keep.has(item)) continue;
    fullCache.delete(item);
    promise.then((url) => URL.revokeObjectURL(url), () => {});
  }
}

function measure() {
  V.size = { w: els.stage.clientWidth, h: els.stage.clientHeight };
}

function layoutSlides() {
  V.slides.forEach((s, k) => { s.style.transform = `translateX(${(k - 1) * (V.size.w + SLIDE_GAP)}px)`; });
}

function setTrack(x, animate) {
  els.track.style.transition = animate ? 'transform .25s ease-out' : 'none';
  els.track.style.transform = x ? `translateX(${x}px)` : '';
}

function animateTrack(x, done) {
  setTrack(x, true);
  let finished = false;
  const end = () => {
    if (finished) return;
    finished = true;
    els.track.removeEventListener('transitionend', end);
    done?.();
  };
  els.track.addEventListener('transitionend', end);
  setTimeout(end, 320);
}

function fillSlides() {
  V.slides.forEach((slide, k) => {
    const item = view[V.index + k - 1];
    const img = slide.querySelector('img');
    img.style.transition = 'none';
    img.style.transform = '';
    if (!item) {
      slide.hidden = true;
      slide.item = null;
      img.removeAttribute('src');
      return;
    }
    slide.hidden = false;
    if (slide.item === item) return; // ya estaba cargada (se reutiliza al deslizar)
    slide.item = item;
    img.removeAttribute('src');
    slide.classList.remove('failed');
    slide.classList.add('loading');
    fullUrl(item).then((url) => {
      if (slide.item !== item) return;
      img.onload = () => slide.classList.remove('loading');
      img.onerror = () => { slide.classList.remove('loading'); slide.classList.add('failed'); };
      img.src = url;
    }, (err) => {
      if (slide.item !== item) return;
      slide.classList.remove('loading');
      slide.classList.add('failed');
      slide.querySelector('.slide-error').textContent = err.message;
    });
  });
}

function updateChrome() {
  const item = view[V.index];
  els.vName.textContent = item.name;
  els.vPos.textContent = `${V.index + 1} de ${view.length} · ${timeLabel(item.date)}`;
  els.vBadge.textContent = filesOf(item).map(extOf).join(' + ');
  els.vPrev.disabled = V.index === 0;
  els.vNext.disabled = V.index === view.length - 1;
  if (V.infoOpen) showDetails(item);
}

function openViewer(index) {
  if (!view[index]) return;
  V.index = index;
  els.viewer.hidden = false;
  document.body.classList.add('viewing');
  measure();
  layoutSlides();
  setTrack(0, false);
  resetZoom(false);
  fillSlides();
  updateChrome();
  history.pushState({ visor: true }, '');
}

function closeViewer() {
  if (history.state?.visor) history.back(); // popstate cierra el visor
  else hideViewer();
}

function hideViewer() {
  els.viewer.hidden = true;
  els.viewer.classList.remove('bare');
  document.body.classList.remove('viewing');
  setDetails(false);
  V.slides.forEach((s) => { s.item = null; s.querySelector('img').removeAttribute('src'); });
  trimCache(true);
  const tile = els.gallery.querySelector(`.tile[data-i="${V.index}"]`);
  tile?.scrollIntoView({ block: 'nearest' });
  tile?.focus({ preventScroll: true });
}

function go(delta) {
  if (V.animating) return;
  const target = V.index + delta;
  if (!view[target]) { setTrack(0, true); return; }
  V.animating = true;
  animateTrack(-delta * (V.size.w + SLIDE_GAP), () => {
    V.index = target;
    if (delta > 0) V.slides.push(V.slides.shift());
    else V.slides.unshift(V.slides.pop());
    setTrack(0, false);
    layoutSlides();
    V.zoom = { s: 1, tx: 0, ty: 0 };
    fillSlides();
    updateChrome();
    trimCache();
    V.animating = false;
  });
}

// ---------- Zoom ----------

const currentImg = () => V.slides[1].querySelector('img');

function clampPan() {
  const z = V.zoom;
  const img = currentImg();
  if (z.s <= 1) {
    V.zoom = { s: 1, tx: 0, ty: 0 };
    return;
  }
  if (!img.naturalWidth) return;
  const fit = Math.min(V.size.w / img.naturalWidth, V.size.h / img.naturalHeight);
  const mx = Math.max(0, (img.naturalWidth * fit * z.s - V.size.w) / 2);
  const my = Math.max(0, (img.naturalHeight * fit * z.s - V.size.h) / 2);
  z.tx = clamp(z.tx, -mx, mx);
  z.ty = clamp(z.ty, -my, my);
}

function applyZoom(animate) {
  const { s, tx, ty } = V.zoom;
  const img = currentImg();
  img.style.transition = animate ? 'transform .2s ease-out' : 'none';
  img.style.transform = s === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
}

function resetZoom(animate) {
  V.zoom = { s: 1, tx: 0, ty: 0 };
  applyZoom(animate);
}

/** Cambia el zoom dejando quieto el punto p (relativo al centro de la pantalla). */
function zoomAround(p, scale) {
  const z = V.zoom;
  const s = clamp(scale, 1, MAX_ZOOM);
  z.tx = p.x - (s * (p.x - z.tx)) / z.s;
  z.ty = p.y - (s * (p.y - z.ty)) / z.s;
  z.s = s;
  clampPan();
}

// ---------- Gestos ----------

const pointers = new Map();
let gesture = null;
let lastTap = null;
let tapTimer = 0;

function stagePoint(e) {
  const r = els.stage.getBoundingClientRect();
  return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
}
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function resetDismiss() {
  els.stage.style.transform = '';
  els.viewer.style.backgroundColor = '';
}

function startPinch() {
  if (gesture?.type === 'swipe') setTrack(0, true);
  if (gesture?.type === 'dismiss') resetDismiss();
  const [a, b] = [...pointers.values()];
  const z = V.zoom;
  gesture = { type: 'pinch', d0: distance(a, b) || 1, m0: midpoint(a, b), s0: z.s, tx0: z.tx, ty0: z.ty };
}

function onTap(p, time) {
  if (lastTap && time - lastTap.time < DOUBLE_TAP_MS && distance(p, lastTap.p) < 40) {
    clearTimeout(tapTimer);
    lastTap = null;
    if (V.zoom.s > 1) resetZoom(true);
    else { zoomAround(p, TAP_ZOOM); applyZoom(true); }
    return;
  }
  lastTap = { p, time };
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => {
    lastTap = null;
    els.viewer.classList.toggle('bare'); // un toque muestra u oculta los botones
  }, DOUBLE_TAP_MS);
}

els.stage.addEventListener('pointerdown', (e) => {
  if (e.button > 0 || V.animating) return;
  els.stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, stagePoint(e));
  if (pointers.size === 2) startPinch();
  else if (pointers.size === 1) {
    gesture = { type: 'pending', p0: stagePoint(e), t0: e.timeStamp, tx: V.zoom.tx, ty: V.zoom.ty };
  }
});

els.stage.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  const p = stagePoint(e);
  pointers.set(e.pointerId, p);
  const z = V.zoom;

  if (gesture.type === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const m = midpoint(a, b);
    const s = clamp((gesture.s0 * distance(a, b)) / gesture.d0, 1, MAX_ZOOM);
    z.tx = m.x - (s * (gesture.m0.x - gesture.tx0)) / gesture.s0;
    z.ty = m.y - (s * (gesture.m0.y - gesture.ty0)) / gesture.s0;
    z.s = s;
    clampPan();
    applyZoom(false);
    return;
  }

  const dx = p.x - gesture.p0.x;
  const dy = p.y - gesture.p0.y;
  if (gesture.type === 'pending') {
    if (Math.hypot(dx, dy) < 8) return;
    if (z.s > 1) gesture.type = 'pan';
    else if (Math.abs(dx) > Math.abs(dy)) gesture.type = 'swipe';
    else gesture.type = dy > 0 ? 'dismiss' : 'none';
  }
  if (gesture.type === 'pan') {
    z.tx = gesture.tx + dx;
    z.ty = gesture.ty + dy;
    clampPan();
    applyZoom(false);
  } else if (gesture.type === 'swipe') {
    const atEdge = !view[V.index + (dx < 0 ? 1 : -1)];
    setTrack(atEdge ? dx / 3 : dx, false);
  } else if (gesture.type === 'dismiss') {
    const d = Math.max(0, dy);
    els.stage.style.transform = `translateY(${d}px)`;
    els.viewer.style.backgroundColor = `rgba(0,0,0,${1 - Math.min(0.7, d / 350)})`;
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!gesture) return;
  const cancelled = e.type === 'pointercancel';

  if (gesture.type === 'pinch') {
    if (pointers.size === 1) {
      // Al soltar un dedo se sigue moviendo la foto con el otro
      const [rest] = pointers.values();
      gesture = { type: 'pan', p0: rest, t0: e.timeStamp, tx: V.zoom.tx, ty: V.zoom.ty };
    } else if (!pointers.size) {
      if (V.zoom.s < 1.05) resetZoom(true);
      gesture = null;
    }
    return;
  }
  if (pointers.size) return;

  const p = stagePoint(e);
  const dx = p.x - gesture.p0.x;
  const dy = p.y - gesture.p0.y;
  const fast = Math.abs(dx) / Math.max(1, e.timeStamp - gesture.t0) > 0.45;
  if (gesture.type === 'swipe') {
    if (cancelled) setTrack(0, true);
    else if (dx < -V.size.w * 0.2 || (fast && dx < -30)) go(1);
    else if (dx > V.size.w * 0.2 || (fast && dx > 30)) go(-1);
    else setTrack(0, true);
  } else if (gesture.type === 'dismiss') {
    if (!cancelled && dy > 110) closeViewer();
    resetDismiss();
  } else if (gesture.type === 'pending' && !cancelled) {
    onTap(p, e.timeStamp);
  }
  gesture = null;
}
els.stage.addEventListener('pointerup', endPointer);
els.stage.addEventListener('pointercancel', endPointer);

els.stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAround(stagePoint(e), V.zoom.s * Math.exp(-e.deltaY * 0.0015));
  applyZoom(false);
}, { passive: false });

window.addEventListener('resize', () => {
  if (els.viewer.hidden) return;
  measure();
  layoutSlides();
  clampPan();
  applyZoom(false);
});

// ---------- Datos de la foto ----------

function setDetails(open) {
  V.infoOpen = open;
  els.panel.hidden = !open;
  if (open) showDetails(view[V.index]);
}

async function readDetails(item) {
  try {
    const e = (await exifr.parse(mainFile(item), { tiff: true, exif: true, gps: true, xmp: false })) || {};
    return formatDetails(e);
  } catch (err) {
    console.warn('No se pudo leer EXIF:', err);
    return {};
  }
}

function formatDetails(e) {
  const w = e.ExifImageWidth || e.ImageWidth;
  const h = e.ExifImageHeight || e.ImageHeight;
  const ev = e.ExposureCompensation;
  return {
    camera: formatCamera(e.Make, e.Model),
    lens: (e.LensModel || '').trim(),
    settings: formatSettings(e),
    ev: ev ? `${ev > 0 ? '+' : ''}${+ev.toFixed(1)} EV` : '',
    date: formatDate(e.DateTimeOriginal || e.CreateDate),
    res: w && h ? `${w} × ${h} (${((w * h) / 1e6).toFixed(1)} MP)` : '',
    gps: Number.isFinite(e.latitude) && Number.isFinite(e.longitude) ? `${e.latitude},${e.longitude}` : '',
  };
}

async function showDetails(item) {
  els.details.innerHTML = '<dt>Leyendo datos…</dt>';
  const d = await (item.details ||= readDetails(item));
  if (view[V.index] !== item || !V.infoOpen) return;

  const rows = [
    ['Cámara', d.camera], ['Lente', d.lens], ['Ajustes', d.settings], ['Compensación', d.ev],
    ['Tomada', d.date || timeLabel(item.date)], ['Resolución', d.res],
  ];
  els.details.innerHTML = '';
  const add = (label, content) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (typeof content === 'string') dd.textContent = content;
    else dd.append(...content);
    els.details.append(dt, dd);
  };
  rows.filter(([, v]) => v).forEach(([label, v]) => add(label, v));
  add('Archivos', filesOf(item).map((f) => {
    const line = document.createElement('div');
    line.textContent = `${f.name} · ${formatBytes(f.size)}`;
    return line;
  }));
  const folder = mainFile(item).webkitRelativePath?.replace(/\/[^/]*$/, '');
  if (folder) add('Carpeta', folder);
  if (d.gps) {
    const a = document.createElement('a');
    a.href = `https://www.google.com/maps?q=${d.gps}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Ver en el mapa';
    add('Ubicación', [a]);
  }
}

// ---------- Eventos ----------

function closeMenu() {
  els.openMenu.hidden = true;
  els.openToggle.setAttribute('aria-expanded', 'false');
}

els.openToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!canPickFolder) { els.pickFiles.click(); return; }
  els.openMenu.hidden = !els.openMenu.hidden;
  els.openToggle.setAttribute('aria-expanded', String(!els.openMenu.hidden));
});
els.openMenu.addEventListener('click', closeMenu);
document.addEventListener('click', (e) => { if (!e.target.closest('.open-menu')) closeMenu(); });

// Mientras Android prepara los archivos la página no recibe nada (ni cuántos van),
// así que se muestra una barra animada con el tiempo que lleva esperando.
const loader = { timer: 0, start: 0 };

function showLoader(title) {
  els.loaderTitle.textContent = title;
  if (!els.loader.hidden) return;
  loader.start = Date.now();
  els.loaderTime.textContent = '0:00';
  els.loader.hidden = false;
  loader.timer = setInterval(() => {
    const s = Math.floor((Date.now() - loader.start) / 1000);
    els.loaderTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

function hideLoader() {
  clearInterval(loader.timer);
  els.loader.hidden = true;
}

for (const input of [els.pickFiles, els.pickFolder]) {
  // Tocar el botón (o su etiqueta) dispara "click" en el input: el selector se abre
  input.addEventListener('click', () => showLoader('Leyendo la tarjeta…'));
  input.addEventListener('cancel', hideLoader);
  input.addEventListener('change', (e) => {
    const files = [...e.target.files];
    if (!files.length) { hideLoader(); return; }
    showLoader(`Ordenando ${plural(files.length, 'archivo', 'archivos')}…`);
    // Deja que se pinte el mensaje antes de armar la galería
    setTimeout(() => {
      try {
        addFiles(files);
      } finally {
        hideLoader();
      }
    }, 50);
  });
}
els.loaderHide.addEventListener('click', hideLoader);

['dragover', 'dragenter'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
document.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });

els.filters.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filter]');
  if (!chip) return;
  ui.filter = chip.dataset.filter;
  selected.clear();
  refresh();
});

els.sort.addEventListener('click', () => {
  ui.newestFirst = !ui.newestFirst;
  saveUi();
  refresh();
});

els.size.addEventListener('click', () => {
  ui.size = (ui.size + 1) % TILE_SIZES.length;
  saveUi();
  els.gallery.style.setProperty('--tile', `${TILE_SIZES[ui.size]}px`);
});

els.selectToggle.addEventListener('click', () => setSelecting(!ui.selecting));

// Mantener presionada una foto entra al modo selección
let longPress = null;
let suppressClick = false;
const cancelLongPress = () => { if (longPress) clearTimeout(longPress.timer); longPress = null; };

els.gallery.addEventListener('pointerdown', (e) => {
  suppressClick = false;
  const tile = e.target.closest('.tile');
  if (!tile || e.button > 0) return;
  cancelLongPress();
  longPress = {
    x: e.clientX,
    y: e.clientY,
    timer: setTimeout(() => {
      suppressClick = true;
      longPress = null;
      if (!ui.selecting) setSelecting(true);
      toggleTile(tile);
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS),
  };
});
els.gallery.addEventListener('pointermove', (e) => {
  if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) cancelLongPress();
});
['pointerup', 'pointercancel'].forEach((ev) => els.gallery.addEventListener(ev, cancelLongPress));
els.gallery.addEventListener('contextmenu', (e) => { if (e.target.closest('.tile')) e.preventDefault(); });

els.gallery.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  const pick = e.target.closest('.day-pick');
  if (pick) { toggleRange(Number(pick.dataset.from), Number(pick.dataset.count)); return; }
  const tile = e.target.closest('.tile');
  if (!tile) return;
  if (ui.selecting) toggleTile(tile);
  else openViewer(Number(tile.dataset.i));
});

els.selShare.addEventListener('click', () => shareItems(chosen()));
els.selDownload.addEventListener('click', () => downloadItems(chosen()));
els.selFrame.addEventListener('click', () => sendToFrame(chosen()));

els.vClose.addEventListener('click', closeViewer);
els.vPrev.addEventListener('click', () => go(-1));
els.vNext.addEventListener('click', () => go(1));
els.vInfo.addEventListener('click', () => setDetails(!V.infoOpen));
els.panelClose.addEventListener('click', () => setDetails(false));
els.vShare.addEventListener('click', () => shareItems([view[V.index]]));
els.vDownload.addEventListener('click', () => downloadItems([view[V.index]]));
els.vFrame.addEventListener('click', () => sendToFrame([view[V.index]]));

window.addEventListener('popstate', () => { if (!els.viewer.hidden) hideViewer(); });

document.addEventListener('keydown', (e) => {
  if (els.viewer.hidden) {
    if (e.key === 'Escape' && ui.selecting) setSelecting(false);
    return;
  }
  if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'i') setDetails(!V.infoOpen);
  else if (e.key === 'Escape') { if (V.infoOpen) setDetails(false); else closeViewer(); }
});

// ---------- Inicio ----------

if (isIOS) {
  els.hint.innerHTML = 'En iPhone: toca <strong>Elegir fotos</strong> → <strong>Elegir archivo</strong> → <strong>Explorar</strong> y busca la tarjeta en <strong>Ubicaciones</strong>.';
} else if (/Android/.test(ua)) {
  els.hint.innerHTML = 'En Android, si no ves la tarjeta en el selector, abre el menú <strong>☰</strong> y elígela ahí (puede llamarse “USB” o “Tarjeta SD”).';
}

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
