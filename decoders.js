// Convierte cualquier archivo de foto soportado en algo dibujable en un canvas.
// - JPEG, PNG, WebP, AVIF, GIF, BMP: el navegador los abre directo.
// - HEIC/HEIF (iPhone): Safari los abre directo; en el resto se usa heic2any.
// - TIFF: Safari los abre directo; en el resto se usa UTIF.
// - RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2…): se extrae la vista previa JPEG
//   a tamaño completo que la cámara guarda dentro del archivo.

const HEIC2ANY_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
const UTIF_URL = 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js';

const NATIVE_EXT = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'avif', 'gif', 'bmp'];
const HEIC_EXT = ['heic', 'heif', 'hif'];
const TIFF_EXT = ['tif', 'tiff'];
const RAW_EXT = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl',
  'pef', 'srw', 'x3f', '3fr', 'fff', 'iiq', 'erf', 'kdc', 'dcr', 'mrw', 'mos', 'gpr'];

const ACCEPT_ATTR = ['image/*', ...[...HEIC_EXT, ...TIFF_EXT, ...RAW_EXT].map((e) => `.${e}`)].join(',');

// Una vista previa más chica que esto se considera miniatura, no foto
const MIN_RAW_PREVIEW_SIDE = 1000;

function fileExt(file) {
  const m = /\.([^.]+)$/.exec(file.name || '');
  return m ? m[1].toLowerCase() : '';
}

/** 'native' | 'heic' | 'tiff' | 'raw' | '' (no soportado) */
function fileKind(file) {
  const ext = fileExt(file);
  const type = (file.type || '').toLowerCase();
  if (RAW_EXT.includes(ext)) return 'raw';
  if (HEIC_EXT.includes(ext) || type === 'image/heic' || type === 'image/heif') return 'heic';
  if (TIFF_EXT.includes(ext) || type === 'image/tiff') return 'tiff';
  if (NATIVE_EXT.includes(ext) || type.startsWith('image/')) return 'native';
  return '';
}

// ---------- Utilidades ----------

const scriptPromises = {};
function loadScript(url) {
  scriptPromises[url] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => {
      delete scriptPromises[url];
      reject(new Error('No se pudo descargar el decodificador (¿sin conexión?)'));
    };
    document.head.append(s);
  });
  return scriptPromises[url];
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('El navegador no puede abrir este formato')); };
    img.src = url;
  });
}

// render.js usa naturalWidth/naturalHeight; un canvas los recibe para tratarse igual que un <img>
function asSource(canvas) {
  canvas.naturalWidth = canvas.width;
  canvas.naturalHeight = canvas.height;
  return canvas;
}

// Aplica la orientación EXIF (1, 3, 6, 8; los espejados casi no se usan en cámaras)
function applyOrientation(img, orientation) {
  const deg = { 3: 180, 6: 90, 8: 270 }[orientation];
  if (!deg) return img;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  const swap = deg !== 180;
  c.width = swap ? h : w;
  c.height = swap ? w : h;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2);
  return asSource(c);
}

async function readOrientation(input) {
  try {
    return (await exifr.orientation(input)) || 1;
  } catch {
    return 1;
  }
}

// ---------- HEIC ----------

async function decodeHeic(file) {
  try {
    return await blobToImage(file); // Safari / iOS
  } catch {
    await loadScript(HEIC2ANY_URL);
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    return blobToImage(Array.isArray(out) ? out[0] : out);
  }
}

// ---------- TIFF ----------

async function decodeTiff(file) {
  try {
    return await blobToImage(file); // Safari
  } catch {
    await loadScript(UTIF_URL);
    const buf = await file.arrayBuffer();
    // Elige la página más grande (algunos TIFF traen miniaturas como páginas extra)
    const widthOf = (d) => (d.t256 ? d.t256[0] : 0);
    const ifd = UTIF.decode(buf).reduce((a, b) => (widthOf(b) > widthOf(a) ? b : a));
    UTIF.decodeImage(buf, ifd);
    const rgba = UTIF.toRGBA8(ifd);
    const c = document.createElement('canvas');
    c.width = ifd.width;
    c.height = ifd.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), ifd.width, ifd.height), 0, 0);
    return applyOrientation(asSource(c), await readOrientation(file));
  }
}

// ---------- RAW ----------

// Recorre los segmentos de un JPEG que empieza en `start` y devuelve dónde termina (-1 si no es válido).
function findJpegEnd(b, start) {
  let i = start + 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return -1;
    const m = b[i + 1];
    if (m === 0xff) { i += 1; continue; }
    if (m === 0xd9) return i + 2;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (m === 0xda) {
      // Datos comprimidos: avanzar hasta el siguiente marcador real
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0x00 && (b[i + 1] < 0xd0 || b[i + 1] > 0xd7))) i += 1;
    }
  }
  return -1;
}

/** Lista de JPEG incrustados en el archivo, del más grande al más chico. */
function findEmbeddedJpegs(bytes) {
  const found = [];
  let i = 0;
  while (i < bytes.length - 3) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      const end = findJpegEnd(bytes, i);
      if (end > 0) {
        found.push({ start: i, end });
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return found.sort((a, b) => (b.end - b.start) - (a.end - a.start));
}

async function decodeRaw(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const candidates = findEmbeddedJpegs(bytes);
  for (const { start, end } of candidates) {
    const blob = new Blob([bytes.subarray(start, end)], { type: 'image/jpeg' });
    let img;
    try {
      img = await blobToImage(blob); // algunos son JPEG sin pérdida que el navegador no abre
    } catch {
      continue;
    }
    if (Math.max(img.naturalWidth, img.naturalHeight) < MIN_RAW_PREVIEW_SIDE) break;
    // Si la vista previa trae su propia orientación el navegador ya la aplicó
    const own = await readOrientation(blob);
    return own !== 1 ? img : applyOrientation(img, await readOrientation(file));
  }
  throw new Error('Este RAW no trae una vista previa JPEG de tamaño completo');
}

// ---------- Entrada ----------

/** Devuelve un <img> o canvas (con naturalWidth/naturalHeight) listo para dibujar. */
async function decodePhoto(file) {
  switch (fileKind(file)) {
    case 'native': return blobToImage(file);
    case 'heic': return decodeHeic(file);
    case 'tiff': return decodeTiff(file);
    case 'raw': return decodeRaw(file);
    default: throw new Error('Formato de archivo no soportado');
  }
}
