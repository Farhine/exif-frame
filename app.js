const MAX_SIDE = 4000; // limita memoria en celulares
const THUMB_SIDE = 160;
const INFO_FIELDS = ['camera', 'lens', 'settings', 'date'];

const els = {
  file: document.getElementById('file'),
  drop: document.getElementById('drop'),
  canvas: document.getElementById('canvas'),
  panel: document.getElementById('panel'),
  strip: document.getElementById('strip'),
  templates: document.getElementById('templates'),
  save: document.getElementById('save'),
  saveAll: document.getElementById('save-all'),
  author: document.getElementById('f-author'),
  logo: document.getElementById('f-logo'),
  status: document.getElementById('status'),
  fields: Object.fromEntries(INFO_FIELDS.map((f) => [f, document.getElementById(`f-${f}`)])),
};

els.file.accept = ACCEPT_ATTR;

const LOGO_AUTO = 'auto';
const LOGO_NONE = 'none';

/**
 * photos: [{ id, file, info: {camera, lens, settings, date}, thumb }]
 * Solo la foto seleccionada se mantiene decodificada (cached) para cuidar la memoria.
 */
let state = { photos: [], current: -1, template: 'classic' };
let cached = { id: null, img: null };
let nextId = 1;

// ---------- Imagen ----------

async function loadImage(file) {
  return downscale(await decodePhoto(file), MAX_SIDE);
}

// Devuelve un canvas con naturalWidth/Height para que render.js lo trate igual que un <img>
function downscale(img, maxSide) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (s === 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  c.naturalWidth = c.width;
  c.naturalHeight = c.height;
  return c;
}

function makeThumb(img) {
  const s = THUMB_SIDE / Math.max(img.naturalWidth, img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

async function imageFor(photo) {
  if (cached.id === photo.id) return cached.img;
  return loadImage(photo.file);
}

function setBusy(message) {
  els.status.textContent = message || '';
  els.status.hidden = !message;
}

// ---------- Fotos ----------

const currentPhoto = () => state.photos[state.current];

async function addFiles(fileList) {
  const files = [...fileList];
  const rejected = files.filter((f) => !fileKind(f));
  const accepted = files.filter((f) => fileKind(f));
  if (rejected.length) {
    alert(`Estos archivos no son fotos soportadas:\n${rejected.map((f) => f.name).join('\n')}`);
  }
  if (!accepted.length) return;

  const failed = [];
  const firstNew = state.photos.length;
  for (const [i, file] of accepted.entries()) {
    setBusy(accepted.length > 1 ? `Cargando ${i + 1} de ${accepted.length}…` : 'Cargando foto…');
    try {
      const [img, info] = await Promise.all([loadImage(file), readExif(file)]);
      const photo = { id: nextId++, file, info, thumb: makeThumb(img) };
      state = { ...state, photos: [...state.photos, photo] };
      if (i === 0) cached = { id: photo.id, img };
    } catch (err) {
      failed.push(`${file.name}: ${err.message}`);
    }
  }
  setBusy('');
  els.file.value = ''; // permite volver a elegir los mismos archivos

  if (failed.length) alert(`No se pudieron abrir:\n${failed.join('\n')}`);
  if (state.photos.length > firstNew) await selectPhoto(firstNew);
}

async function selectPhoto(index) {
  const photo = state.photos[index];
  if (!photo) return;
  state = { ...state, current: index };
  if (cached.id !== photo.id) {
    setBusy(fileKind(photo.file) === 'native' ? '' : 'Procesando foto…');
    try {
      cached = { id: photo.id, img: await loadImage(photo.file) };
    } catch (err) {
      alert(`No se pudo abrir la imagen: ${err.message}`);
    } finally {
      setBusy('');
    }
  }
  INFO_FIELDS.forEach((f) => { els.fields[f].value = photo.info[f]; });
  render();
}

function removePhoto(index) {
  const photos = state.photos.filter((_, i) => i !== index);
  if (!photos.length) {
    state = { ...state, photos, current: -1 };
    cached = { id: null, img: null };
    render();
    return;
  }
  // Si se quita la actual queda seleccionada la siguiente (o la última)
  const next = Math.min(index < state.current ? state.current - 1 : state.current, photos.length - 1);
  state = { ...state, photos };
  selectPhoto(Math.max(0, next));
}

function updateCurrentInfo(field, value) {
  state = {
    ...state,
    photos: state.photos.map((p, i) => (i === state.current ? { ...p, info: { ...p.info, [field]: value } } : p)),
  };
  redraw();
}

// ---------- Dibujo ----------

function selectedLogo(camera) {
  const value = els.logo.value;
  if (value === LOGO_NONE) return '';
  return value === LOGO_AUTO ? detectBrand(camera) : value;
}

function frameInfo(photo) {
  const info = Object.fromEntries(INFO_FIELDS.map((f) => [f, photo.info[f].trim()]));
  return { ...info, logo: selectedLogo(info.camera), author: els.author.value.trim() };
}

function redraw() {
  const photo = currentPhoto();
  if (photo && cached.id === photo.id) renderFrame(els.canvas, cached.img, frameInfo(photo), state.template);
}

function renderStrip() {
  els.strip.innerHTML = '';
  state.photos.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = `thumb${i === state.current ? ' active' : ''}`;

    const select = document.createElement('button');
    select.className = 'thumb-img';
    select.dataset.select = i;
    select.title = p.file.name;
    const img = document.createElement('img');
    img.src = p.thumb;
    img.alt = '';
    select.append(img);

    const remove = document.createElement('button');
    remove.className = 'thumb-remove';
    remove.dataset.remove = i;
    remove.setAttribute('aria-label', `Quitar ${p.file.name}`);
    remove.textContent = '×';

    item.append(select, remove);
    els.strip.append(item);
  });
  const add = document.createElement('label');
  add.className = 'thumb-add';
  add.htmlFor = 'file';
  add.textContent = '+';
  add.title = 'Agregar fotos';
  els.strip.append(add);
}

function render() {
  const has = state.photos.length > 0;
  els.drop.hidden = has;
  els.canvas.hidden = !has;
  els.panel.hidden = !has;
  els.strip.hidden = !has;
  els.saveAll.hidden = state.photos.length < 2;
  els.saveAll.textContent = `Guardar todas (${state.photos.length})`;
  els.save.textContent = state.photos.length > 1 ? 'Guardar esta' : 'Guardar / Compartir';
  renderStrip();
  redraw();
}

// ---------- Exportar ----------

async function saveCurrent() {
  const photo = currentPhoto();
  if (!photo) return;
  try {
    await deliverFiles([await canvasToFile(els.canvas, exportName(photo.file.name))]);
  } catch (err) {
    alert(err.message);
  }
}

async function saveAll() {
  const files = [];
  const failed = [];
  const out = document.createElement('canvas');
  for (const [i, photo] of state.photos.entries()) {
    setBusy(`Preparando ${i + 1} de ${state.photos.length}…`);
    try {
      renderFrame(out, await imageFor(photo), frameInfo(photo), state.template);
      files.push(await canvasToFile(out, exportName(photo.file.name)));
    } catch (err) {
      failed.push(`${photo.file.name}: ${err.message}`);
    }
  }
  out.width = 0; // libera la memoria del canvas
  setBusy(files.length > 1 ? 'Guardando…' : '');
  try {
    if (files.length) await deliverFiles(files);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy('');
  }
  if (failed.length) alert(`No se pudieron exportar:\n${failed.join('\n')}`);
}

// ---------- Controles ----------

function buildControls() {
  els.templates.innerHTML = '';
  Object.entries(TEMPLATES).forEach(([key, t]) => {
    const btn = document.createElement('button');
    btn.dataset.t = key;
    btn.textContent = t.label;
    btn.classList.toggle('active', key === state.template);
    els.templates.append(btn);
  });

  const options = [[LOGO_AUTO, 'Automático (según cámara)'], [LOGO_NONE, 'Sin logo'],
    ...Object.entries(BRANDS).map(([key, b]) => [key, b.name])];
  options.forEach(([value, label]) => els.logo.append(new Option(label, value)));
}

buildControls();
window.onLogoLoaded = redraw;

// ---------- Eventos ----------

els.file.addEventListener('change', (e) => addFiles(e.target.files));

['dragover', 'dragenter'].forEach((ev) =>
  document.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  document.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('over'); }));
document.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

els.strip.addEventListener('click', (e) => {
  const remove = e.target.closest('[data-remove]');
  if (remove) return removePhoto(Number(remove.dataset.remove));
  const select = e.target.closest('[data-select]');
  if (select) selectPhoto(Number(select.dataset.select));
});

els.templates.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-t]');
  if (!btn) return;
  els.templates.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  state = { ...state, template: btn.dataset.t };
  redraw();
});

INFO_FIELDS.forEach((f) => els.fields[f].addEventListener('input', (e) => updateCurrentInfo(f, e.target.value)));
els.author.addEventListener('input', redraw);
els.logo.addEventListener('change', redraw);

els.save.addEventListener('click', saveCurrent);
els.saveAll.addEventListener('click', saveAll);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
