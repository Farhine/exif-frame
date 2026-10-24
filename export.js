// Guardar o compartir las fotos terminadas.
// En celular se usa el menú de compartir del sistema; en PC se descarga
// (una foto como JPG, varias juntas en un ZIP).

const FFLATE_URL = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
const JPEG_QUALITY = 0.92;
const ZIP_NAME = 'exif-frame.zip';

const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

function canvasToFile(canvas, name) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('No se pudo generar la imagen'));
      resolve(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

function exportName(originalName) {
  return `${originalName.replace(/\.[^.]+$/, '')}-exif.jpg`;
}

// Evita nombres repetidos dentro del ZIP (foto.jpg, foto (2).jpg…)
function uniqueNames(names) {
  const seen = {};
  return names.map((name) => {
    seen[name] = (seen[name] || 0) + 1;
    return seen[name] === 1 ? name : name.replace(/(\.[^.]+)$/, ` (${seen[name]})$1`);
  });
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function zipFiles(files) {
  await loadScript(FFLATE_URL);
  const names = uniqueNames(files.map((f) => f.name));
  const entries = {};
  for (const [i, f] of files.entries()) {
    // JPEG ya está comprimido: guardarlo sin recomprimir es mucho más rápido
    entries[names[i]] = [new Uint8Array(await f.arrayBuffer()), { level: 0 }];
  }
  return new Blob([fflate.zipSync(entries)], { type: 'application/zip' });
}

async function deliverFiles(files) {
  if (isTouchDevice() && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Algunos teléfonos rechazan muchos archivos juntos: se descarga en su lugar
    }
  }
  if (files.length === 1) {
    downloadBlob(files[0], files[0].name);
    return;
  }
  downloadBlob(await zipFiles(files), ZIP_NAME);
}
