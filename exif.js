// Lectura y formato de los datos EXIF de una foto.

const UNKNOWN_CAMERA = 'Cámara desconocida';

const BRAND_NAMES = {
  'NIKON CORPORATION': 'Nikon',
  'OLYMPUS IMAGING CORP.': 'Olympus',
  'OM Digital Solutions': 'OM System',
  'FUJIFILM': 'Fujifilm',
  'SONY': 'Sony',
  'Canon': 'Canon',
  'Apple': 'Apple',
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

/** @returns {Promise<{camera: string, lens: string, settings: string, date: string}>} */
async function readExif(file) {
  try {
    const e = (await exifr.parse(file, { tiff: true, exif: true, gps: false, xmp: false })) || {};
    return {
      camera: formatCamera(e.Make, e.Model) || UNKNOWN_CAMERA,
      lens: (e.LensModel || '').trim(),
      settings: formatSettings(e),
      date: formatDate(e.DateTimeOriginal || e.CreateDate),
    };
  } catch (err) {
    console.warn('No se pudo leer EXIF:', err);
    return { camera: UNKNOWN_CAMERA, lens: '', settings: '', date: '' };
  }
}
