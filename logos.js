// Logos de marcas. Por defecto se dibujan como wordmarks tipográficos.
// Si existe logos/<clave>.svg (p. ej. logos/canon.svg) se usa esa imagen en su lugar.

const BRANDS = {
  canon: { name: 'Canon', text: 'Canon', family: 'Georgia, "Times New Roman", serif', weight: 700, italic: true, color: '#cc0000', match: ['canon'] },
  nikon: { name: 'Nikon', text: 'Nikon', weight: 800, italic: true, match: ['nikon'] },
  sony: { name: 'Sony', text: 'SONY', family: 'Georgia, "Times New Roman", serif', weight: 700, spacing: 0.12, match: ['sony', 'ilce', 'dsc-'] },
  fujifilm: { name: 'Fujifilm', text: 'FUJIFILM', weight: 800, spacing: 0.04, match: ['fujifilm', 'fuji'] },
  leica: { name: 'Leica', badge: true, match: ['leica'] },
  hasselblad: { name: 'Hasselblad', text: 'HASSELBLAD', weight: 500, spacing: 0.22, match: ['hasselblad'] },
  olympus: { name: 'Olympus', text: 'OLYMPUS', family: 'Georgia, "Times New Roman", serif', weight: 700, spacing: 0.08, match: ['olympus'] },
  omsystem: { name: 'OM System', text: 'OM SYSTEM', weight: 700, spacing: 0.1, match: ['om system', 'om digital', 'om-1', 'om-5'] },
  panasonic: { name: 'Panasonic / Lumix', text: 'LUMIX', weight: 800, spacing: 0.06, match: ['panasonic', 'lumix', 'dc-', 'dmc-'] },
  pentax: { name: 'Pentax', text: 'PENTAX', weight: 800, spacing: 0.08, match: ['pentax'] },
  ricoh: { name: 'Ricoh', text: 'RICOH', weight: 800, spacing: 0.1, match: ['ricoh'] },
  sigma: { name: 'Sigma', text: 'SIGMA', weight: 700, spacing: 0.14, match: ['sigma'] },
  apple: { name: 'Apple', text: 'Apple', weight: 500, match: ['apple', 'iphone'] },
  samsung: { name: 'Samsung', text: 'SAMSUNG', weight: 800, spacing: 0.12, match: ['samsung', 'galaxy', 'sm-'] },
  google: { name: 'Google Pixel', text: 'Pixel', weight: 500, match: ['google', 'pixel'] },
  xiaomi: { name: 'Xiaomi', text: 'Xiaomi', weight: 700, match: ['xiaomi', 'redmi'] },
  dji: { name: 'DJI', text: 'DJI', weight: 800, spacing: 0.08, match: ['dji'] },
};

const LEICA_RED = '#e20612';
const logoImages = {};

/** Detecta la marca a partir del texto de cámara. Devuelve la clave o ''. */
function detectBrand(cameraText) {
  const text = (cameraText || '').toLowerCase();
  const found = Object.entries(BRANDS).find(([, b]) => b.match.some((m) => text.includes(m)));
  return found ? found[0] : '';
}

// Intenta cargar logos/<clave>.svg una sola vez; al cargar avisa para redibujar.
function logoImage(key) {
  if (!(key in logoImages)) {
    logoImages[key] = null;
    const img = new Image();
    img.onload = () => {
      logoImages[key] = img;
      if (typeof window.onLogoLoaded === 'function') window.onLogoLoaded();
    };
    img.src = `logos/${key}.svg`;
  }
  return logoImages[key];
}

// Tamaño óptico: los logos anchos (HASSELBLAD) se achican y los cortos (DJI) crecen,
// para que todos ocupen un área visual parecida.
const REF_ASPECT = 3.5;
const INK_RATIO = 0.75; // altura de tinta respecto al tamaño nominal pedido
const MIN_SCALE = 0.72;
const MAX_SCALE = 1.2;
const BADGE_SCALE = 1.9; // un círculo se percibe más chico que un texto de igual alto
const MEASURE_SIZE = 100;

function wordmarkFont(brand, size) {
  return `${brand.italic ? 'italic ' : ''}${brand.weight || 700} ${size}px ${brand.family || 'Inter, system-ui, sans-serif'}`;
}

function opticalScale(aspect) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.sqrt(REF_ASPECT / aspect)));
}

// Posición x de cada letra con el espaciado de la marca. Se hace a mano porque
// ctx.letterSpacing no existe en Safari y measureText no lo incluye en la tinta.
function glyphOffsets(ctx, brand, size) {
  const extra = size * (brand.spacing || 0);
  let x = 0;
  return [...brand.text].map((ch) => {
    const at = x;
    x += ctx.measureText(ch).width + extra;
    return at;
  });
}

// Mide la tinta real del wordmark (sin espacios laterales ni interlineado).
function measureWordmark(ctx, brand) {
  ctx.save();
  ctx.font = wordmarkFont(brand, MEASURE_SIZE);
  // actualBoundingBoxLeft depende de la alineación actual del contexto
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const chars = [...brand.text];
  const offsets = glyphOffsets(ctx, brand, MEASURE_SIZE);
  const first = ctx.measureText(chars[0]);
  const last = ctx.measureText(chars[chars.length - 1]);
  const all = ctx.measureText(brand.text);
  ctx.restore();
  if (!brand.spacing) {
    return {
      left: all.actualBoundingBoxLeft,
      width: all.actualBoundingBoxLeft + all.actualBoundingBoxRight,
      ascent: all.actualBoundingBoxAscent,
      descent: all.actualBoundingBoxDescent,
    };
  }
  return {
    left: first.actualBoundingBoxLeft,
    width: first.actualBoundingBoxLeft + offsets[offsets.length - 1] + last.actualBoundingBoxRight,
    ascent: all.actualBoundingBoxAscent,
    descent: all.actualBoundingBoxDescent,
  };
}

/** Caja final {w, h} del logo para un tamaño nominal h (null si no hay marca). */
function logoBox(ctx, key, h) {
  const brand = BRANDS[key];
  if (!brand) return null;
  const ink = h * INK_RATIO;
  const img = logoImage(key);
  if (img) {
    const aspect = img.naturalWidth / img.naturalHeight;
    const boxH = ink * opticalScale(aspect);
    return { w: boxH * aspect, h: boxH };
  }
  if (brand.badge) {
    const d = ink * BADGE_SCALE;
    return { w: d, h: d };
  }
  const m = measureWordmark(ctx, brand);
  const aspect = m.width / (m.ascent + m.descent);
  const boxH = ink * opticalScale(aspect) * (brand.scale || 1);
  return { w: boxH * aspect, h: boxH, m };
}

/** Ancho que ocupará el logo (0 si no hay marca). */
function logoWidth(ctx, key, h) {
  return logoBox(ctx, key, h)?.w || 0;
}

/**
 * Dibuja el logo con su tinta centrada verticalmente en cy.
 * align: 'left' | 'center' | 'right' respecto a x. Devuelve el ancho dibujado.
 * mono: usa el color fg en vez del color de marca (para fondos oscuros o fotos).
 */
function drawLogo(ctx, key, x, cy, h, fg, align = 'left', mono = false) {
  const box = logoBox(ctx, key, h);
  if (!box) return 0;
  const brand = BRANDS[key];
  const left = align === 'center' ? x - box.w / 2 : align === 'right' ? x - box.w : x;
  const img = logoImage(key);

  ctx.save();
  if (img) {
    ctx.drawImage(img, left, cy - box.h / 2, box.w, box.h);
  } else if (brand.badge) {
    drawLeicaBadge(ctx, left + box.w / 2, cy, box.h / 2);
  } else {
    const { m } = box;
    const k = box.h / (m.ascent + m.descent);
    const size = MEASURE_SIZE * k;
    ctx.font = wordmarkFont(brand, size);
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = (!mono && brand.color) || fg;
    const x0 = left + m.left * k;
    const baseline = cy + ((m.ascent - m.descent) * k) / 2;
    if (!brand.spacing) {
      ctx.fillText(brand.text, x0, baseline);
    } else {
      const chars = [...brand.text];
      glyphOffsets(ctx, brand, size).forEach((dx, i) => ctx.fillText(chars[i], x0 + dx, baseline));
    }
  }
  ctx.restore();
  return box.w;
}

function drawLeicaBadge(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = LEICA_RED;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic 700 ${Math.round(r * 0.62)}px Georgia, "Times New Roman", serif`;
  ctx.fillText('Leica', cx, cy + r * 0.04);
}
