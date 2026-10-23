const MAX_SIDE = 4000; // limita memoria en celulares

const els = {
  file: document.getElementById('file'),
  drop: document.getElementById('drop'),
  canvas: document.getElementById('canvas'),
  panel: document.getElementById('panel'),
  templates: document.getElementById('templates'),
  save: document.getElementById('save'),
  camera: document.getElementById('f-camera'),
  lens: document.getElementById('f-lens'),
  settings: document.getElementById('f-settings'),
  date: document.getElementById('f-date'),
  author: document.getElementById('f-author'),
  logo: document.getElementById('f-logo'),
};

const LOGO_AUTO = 'auto';
const LOGO_NONE = 'none';

let state = { img: null, template: 'classic', fileName: 'foto' };

// ---------- EXIF ----------

const BRAND_NAMES = {
  'NIKON CORPORATION': 'Nikon',
  'OLYMPUS IMAGING CORP.': 'Olympus',
  'OM Digital Solutions': 'OM System',
  'FUJIFILM': 'Fujifilm',
  'SONY': 'Sony',
  'Canon': 'Canon',
  'Apple': 'Apple',
};

function formatCamera(make = '', model = '') {
  const brand = BRAND_NAMES[make.trim()] || make.trim();
  const cleanModel = model.trim().replace(new RegExp(`^${escapeRegExp(make.trim())}\\s*`, 'i'), '');
  if (!brand) return cleanModel;
  return cleanModel.toLowerCase().startsWith(brand.toLowerCase()) ? cleanModel : `${brand} ${cleanModel}`.trim();
}

function formatExposure(t) {
  if (!t) return '';
  return t >= 1 ? `${+t.toFixed(1)}s` : `1/${Math.round(1 / t)}s`;
}

function formatSettings(e) {
  const focal = e.FocalLengthIn35mmFormat || e.FocalLength;
  return [
    focal && `${Math.round(focal)}mm`,
    e.FNumber && `f/${+e.FNumber.toFixed(1)}`,
    formatExposure(e.ExposureTime),
    e.ISO && `ISO ${e.ISO}`,
  ].filter(Boolean).join('  ');
}

function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return d.toLocaleString('es', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function readExif(file) {
  try {
    const e = (await exifr.parse(file, { tiff: true, exif: true, gps: false, xmp: false })) || {};
    return {
      camera: formatCamera(e.Make, e.Model),
      lens: (e.LensModel || '').trim(),
      settings: formatSettings(e),
      date: formatDate(e.DateTimeOriginal || e.CreateDate),
    };
  } catch (err) {
    console.warn('No se pudo leer EXIF:', err);
    return { camera: '', lens: '', settings: '', date: '' };
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- Imagen ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(downscale(img));
    img.onerror = () => reject(new Error('Formato de imagen no soportado'));
    img.src = url;
  });
}

// Devuelve un canvas con naturalWidth/Height para que render.js lo trate igual que un <img>
function downscale(img) {
  const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  if (s === 1) return img;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  c.naturalWidth = c.width;
  c.naturalHeight = c.height;
  return c;
}

async function openFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    const [img, info] = await Promise.all([loadImage(file), readExif(file)]);
    state = { ...state, img, fileName: file.name.replace(/\.[^.]+$/, '') };
    els.camera.value = info.camera || 'Cámara desconocida';
    els.lens.value = info.lens;
    els.settings.value = info.settings;
    els.date.value = info.date;
    els.drop.hidden = true;
    els.canvas.hidden = false;
    els.panel.hidden = false;
    redraw();
  } catch (err) {
    alert(`No se pudo abrir la imagen: ${err.message}`);
  }
}

function selectedLogo(camera) {
  const value = els.logo.value;
  if (value === LOGO_NONE) return '';
  return value === LOGO_AUTO ? detectBrand(camera) : value;
}

function currentInfo() {
  const camera = els.camera.value.trim();
  return {
    logo: selectedLogo(camera),
    camera,
    lens: els.lens.value.trim(),
    settings: els.settings.value.trim(),
    date: els.date.value.trim(),
    author: els.author.value.trim(),
  };
}

function redraw() {
  if (state.img) renderFrame(els.canvas, state.img, currentInfo(), state.template);
}

// ---------- Exportar ----------

async function save() {
  const blob = await new Promise((r) => els.canvas.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) return alert('No se pudo generar la imagen');
  const file = new File([blob], `${state.fileName}-exif.jpg`, { type: 'image/jpeg' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

els.file.addEventListener('change', (e) => openFile(e.target.files[0]));

['dragover', 'dragenter'].forEach((ev) =>
  document.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  document.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('over'); }));
document.addEventListener('drop', (e) => openFile(e.dataTransfer.files[0]));

els.templates.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-t]');
  if (!btn) return;
  els.templates.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
  state = { ...state, template: btn.dataset.t };
  redraw();
});

[els.camera, els.lens, els.settings, els.date, els.author].forEach((input) =>
  input.addEventListener('input', redraw));
els.logo.addEventListener('change', redraw);

els.save.addEventListener('click', save);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
