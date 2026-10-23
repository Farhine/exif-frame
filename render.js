// Dibuja la foto con su marco EXIF en un canvas. Todas las medidas son
// relativas al lado largo de la imagen (u = 1%) para que se vea igual a cualquier resolución.

const FONT = 'Inter, system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const SEP = '   ·   ';

const TEMPLATES = {
  classic: { label: 'Clásico', bg: '#ffffff', fg: '#111111', sub: '#7a7a7a', layout: 'bar' },
  dark: { label: 'Oscuro', bg: '#121212', fg: '#f5f5f5', sub: '#8d8d8d', monoLogo: true, layout: 'bar' },
  minimal: { label: 'Minimal', bg: '#ffffff', fg: '#111111', sub: '#8f8f8f', layout: 'minimal' },
  polaroid: { label: 'Polaroid', bg: '#f7f5f0', fg: '#222222', sub: '#8a857c', layout: 'polaroid' },
  blur: { label: 'Desenfoque', bg: '#000000', fg: '#ffffff', sub: 'rgba(255,255,255,.7)', monoLogo: true, layout: 'blur' },
  overlay: { label: 'Sobre foto', bg: '#000000', fg: '#ffffff', sub: 'rgba(255,255,255,.78)', monoLogo: true, layout: 'overlay' },
  side: { label: 'Lateral', bg: '#fafafa', fg: '#111111', sub: '#8a8a8a', layout: 'side' },
  cinema: { label: 'Cine', bg: '#000000', fg: '#f2f2f2', sub: '#9a9a9a', monoLogo: true, layout: 'cinema' },
  gallery: { label: 'Galería', bg: '#f4f1ea', fg: '#2a2723', sub: '#8f877a', line: '#d9d2c3', layout: 'gallery' },
  glass: { label: 'Cristal', bg: '#000000', fg: '#ffffff', sub: 'rgba(255,255,255,.75)', monoLogo: true, layout: 'glass' },
};

const LAYOUTS = {
  bar: drawBar,
  minimal: drawMinimal,
  polaroid: drawPolaroid,
  blur: drawBlur,
  overlay: drawOverlay,
  side: drawSide,
  cinema: drawCinema,
  gallery: drawGallery,
  glass: drawGlass,
};

function renderFrame(canvas, img, info, templateName) {
  const t = TEMPLATES[templateName] || TEMPLATES.classic;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const u = Math.max(w, h) / 100;
  LAYOUTS[t.layout](canvas, img, info, t, w, h, u);
}

// ---------- Helpers ----------

function setFont(ctx, weight, size, family = FONT) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
}

function text(ctx, str, x, y, { weight = 400, size, color, align = 'left', family = FONT }) {
  if (!str) return;
  setFont(ctx, weight, size, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

// Reduce el tamaño hasta que el texto quepa en maxW.
function fitSize(ctx, str, maxW, weight, size, family = FONT) {
  setFont(ctx, weight, size, family);
  const w = ctx.measureText(str).width;
  return w > maxW ? size * (maxW / w) : size;
}

function measure(ctx, str, weight, size, family = FONT) {
  setFont(ctx, weight, size, family);
  return ctx.measureText(str).width;
}

function setupCanvas(canvas, cw, ch, bg) {
  canvas.width = Math.round(cw);
  canvas.height = Math.round(ch);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

function brandOf(info) {
  return info.logo || '';
}

// Alto real del logo (0 si no hay), para dejar espacio antes de dibujar el texto.
function logoHeight(canvas, info, size) {
  return logoBox(canvas.getContext('2d'), brandOf(info), size)?.h || 0;
}

// Dibuja el logo centrado en cx con su borde superior en top.
function drawStackedLogo(ctx, info, cx, top, size, t) {
  const lh = logoHeight(ctx.canvas, info, size);
  if (lh) drawLogo(ctx, brandOf(info), cx, top + lh / 2, size, t.fg, 'center', t.monoLogo);
}

// Fondo: la misma foto ampliada y desenfocada cubriendo todo el canvas.
function drawBlurredBackground(ctx, img, w, h, u) {
  const { width: cw, height: ch } = ctx.canvas;
  const scale = Math.max(cw / w, ch / h) * 1.1;
  ctx.filter = `blur(${Math.round(u * 4)}px) brightness(0.6)`;
  ctx.drawImage(img, (cw - w * scale) / 2, (ch - h * scale) / 2, w * scale, h * scale);
  ctx.filter = 'none';
}

// Foto con esquinas redondeadas y sombra suave.
function drawRoundedPhoto(ctx, img, x, y, w, h, r, u) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = u * 3;
  ctx.shadowOffsetY = u * 0.8;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- Layouts ----------

function drawBar(canvas, img, info, t, w, h, u) {
  const pad = u * 2;
  const barH = u * 9;
  const ctx = setupCanvas(canvas, w + pad * 2, h + pad + barH, t.bg);
  ctx.drawImage(img, pad, pad, w, h);

  const midY = h + pad + barH / 2;
  const left = pad;
  const right = canvas.width - pad;
  const lensLine = [info.lens, info.author && `© ${info.author}`].filter(Boolean).join(SEP);

  text(ctx, info.camera, left, midY - u * 0.3, { weight: 700, size: u * 2.2, color: t.fg });
  text(ctx, lensLine, left, midY + u * 2.1, { size: u * 1.6, color: t.sub });
  text(ctx, info.settings, right, midY - u * 0.3, { weight: 700, size: u * 2.2, color: t.fg, align: 'right' });
  text(ctx, info.date, right, midY + u * 2.1, { size: u * 1.6, color: t.sub, align: 'right' });

  // Logo + línea divisoria a la izquierda del bloque de ajustes
  const blockW = Math.max(measure(ctx, info.settings, 700, u * 2.2), measure(ctx, info.date, 400, u * 1.6));
  if (!info.settings && !info.date) return;
  const lineX = right - blockW - u * 1.5;
  ctx.fillStyle = t.sub;
  ctx.fillRect(lineX, midY - u * 2.4, Math.max(1, u * 0.12), u * 5);

  // Solo dibuja el logo si no choca con el texto de la izquierda
  const leftW = Math.max(measure(ctx, info.camera, 700, u * 2.2), measure(ctx, lensLine, 400, u * 1.6));
  const logoRight = lineX - u * 1.5;
  if (logoRight - logoWidth(ctx, brandOf(info), u * 2.6) > left + leftW + u * 2) {
    drawLogo(ctx, brandOf(info), logoRight, midY, u * 2.6, t.fg, 'right', t.monoLogo);
  }
}

function drawMinimal(canvas, img, info, t, w, h, u) {
  const pad = u * 1.5;
  const bottom = u * 6;
  const ctx = setupCanvas(canvas, w + pad * 2, h + pad + bottom, t.bg);
  ctx.drawImage(img, pad, pad, w, h);

  const line = [info.camera, info.settings, info.author && `© ${info.author}`].filter(Boolean).join('   |   ');
  const size = u * 1.5;
  const logoH = u * 1.9;
  const gap = u * 1.4;
  const logoW = logoWidth(ctx, brandOf(info), logoH);
  const textW = measure(ctx, line, 500, size);
  const total = logoW + (logoW ? gap : 0) + textW;
  const startX = (canvas.width - total) / 2;
  const cy = h + pad + bottom / 2;

  drawLogo(ctx, brandOf(info), startX, cy, logoH, t.fg, 'left', t.monoLogo);
  text(ctx, line, startX + logoW + (logoW ? gap : 0), cy + size * 0.36, { weight: 500, size, color: t.sub });
}

function drawPolaroid(canvas, img, info, t, w, h, u) {
  const pad = u * 4;
  const logoSize = u * 3.2;
  const lh = logoHeight(canvas, info, logoSize);
  const off = lh ? lh + u * 1.8 : 0;
  const ctx = setupCanvas(canvas, w + pad * 2, h + pad + u * 15 + off, t.bg);
  ctx.drawImage(img, pad, pad, w, h);

  const cx = canvas.width / 2;
  const top = h + pad;
  drawStackedLogo(ctx, info, cx, top + u * 3.5, logoSize, t);
  text(ctx, info.camera, cx, top + off + u * 5.5, { weight: 700, size: u * 2.6, color: t.fg, align: 'center' });
  text(ctx, [info.lens, info.settings].filter(Boolean).join(SEP), cx, top + off + u * 8.6, { weight: 500, size: u * 1.8, color: t.sub, align: 'center' });
  text(ctx, [info.date, info.author && `© ${info.author}`].filter(Boolean).join(SEP), cx, top + off + u * 11.4, { size: u * 1.5, color: t.sub, align: 'center' });
}

function drawBlur(canvas, img, info, t, w, h, u) {
  const pad = u * 7;
  const logoSize = u * 3;
  const lh = logoHeight(canvas, info, logoSize);
  const off = lh ? lh + u * 1.5 : 0;
  const ctx = setupCanvas(canvas, w + pad * 2, h + pad + u * 12 + off, t.bg);

  drawBlurredBackground(ctx, img, w, h, u);
  drawRoundedPhoto(ctx, img, pad, pad, w, h, u * 1.2, u);

  const cx = canvas.width / 2;
  const top = h + pad;
  drawStackedLogo(ctx, info, cx, top + u * 3, logoSize, t);
  text(ctx, info.camera, cx, top + off + u * 5, { weight: 700, size: u * 2.4, color: t.fg, align: 'center' });
  const line = [info.lens, info.settings, info.date, info.author && `© ${info.author}`].filter(Boolean).join(SEP);
  text(ctx, line, cx, top + off + u * 8, { size: u * 1.7, color: t.sub, align: 'center' });
}

function drawOverlay(canvas, img, info, t, w, h, u) {
  const ctx = setupCanvas(canvas, w, h, t.bg);
  ctx.drawImage(img, 0, 0, w, h);

  const grad = ctx.createLinearGradient(0, h * 0.6, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h * 0.6, w, h * 0.4);

  const x = u * 4;
  const base = h - u * 4;
  const lh = logoHeight(canvas, info, u * 2.8);
  drawLogo(ctx, brandOf(info), x, base - u * 9 - lh / 2, u * 2.8, t.fg, 'left', t.monoLogo);
  text(ctx, info.camera, x, base - u * 5, { weight: 700, size: u * 3, color: t.fg });
  text(ctx, [info.lens, info.settings].filter(Boolean).join(SEP), x, base - u * 1.8, { size: u * 1.7, color: t.sub });
  text(ctx, info.date, w - x, base - u * 1.8, { size: u * 1.5, color: t.sub, align: 'right' });
  text(ctx, info.author && `© ${info.author}`, w - x, base - u * 5, { weight: 500, size: u * 1.7, color: t.fg, align: 'right' });
}

// Bandas negras de cine arriba y abajo, texto tipo créditos.
function drawCinema(canvas, img, info, t, w, h, u) {
  const band = u * 7;
  const ctx = setupCanvas(canvas, w, h + band * 2, t.bg);
  ctx.drawImage(img, 0, band, w, h);

  const x = u * 3;
  const topY = band / 2;
  ctx.letterSpacing = `${u * 0.35}px`;
  drawLogo(ctx, brandOf(info), x, topY, u * 2.2, t.fg, 'left', t.monoLogo);
  text(ctx, info.date.toUpperCase(), w - x, topY + u * 0.5, { weight: 500, size: u * 1.3, color: t.sub, align: 'right' });

  const cy = band + h + band / 2;
  text(ctx, info.camera.toUpperCase(), w / 2, cy - u * 0.4, { weight: 700, size: u * 1.8, color: t.fg, align: 'center' });
  const line = [info.lens, info.settings, info.author && `© ${info.author}`].filter(Boolean).join(SEP).toUpperCase();
  text(ctx, line, w / 2, cy + u * 2.2, { weight: 400, size: fitSize(ctx, line, w - x * 2, 400, u * 1.2), color: t.sub, align: 'center' });
  ctx.letterSpacing = '0px';
}

// Passe-partout de museo con filete fino y cartela centrada.
function drawGallery(canvas, img, info, t, w, h, u) {
  const mat = u * 8;
  const logoSize = u * 2.4;
  const lh = logoHeight(canvas, info, logoSize);
  const ctx = setupCanvas(canvas, w + mat * 2, h + mat + u * 15 + lh, t.bg);

  const gap = u * 0.9;
  ctx.strokeStyle = t.line;
  ctx.lineWidth = Math.max(1, u * 0.12);
  ctx.strokeRect(mat - gap, mat - gap, w + gap * 2, h + gap * 2);
  ctx.drawImage(img, mat, mat, w, h);

  const cx = canvas.width / 2;
  drawStackedLogo(ctx, info, cx, mat + h + u * 4, logoSize, t);
  const y = mat + h + u * 6 + (lh ? lh + u * 0.9 : 0);
  text(ctx, info.camera, cx, y + u * 0.8, { weight: 'italic 400', size: u * 2.6, color: t.fg, align: 'center', family: SERIF });
  ctx.letterSpacing = `${u * 0.25}px`;
  text(ctx, [info.lens, info.settings].filter(Boolean).join(SEP).toUpperCase(), cx, y + u * 4, { weight: 500, size: u * 1.2, color: t.sub, align: 'center' });
  ctx.letterSpacing = '0px';
  text(ctx, [info.date, info.author && `© ${info.author}`].filter(Boolean).join(SEP), cx, y + u * 6.6, { size: u * 1.3, color: t.sub, align: 'center', family: SERIF });
}

// Fondo desenfocado y tarjeta de vidrio esmerilado que flota sobre el borde inferior de la foto.
function drawGlass(canvas, img, info, t, w, h, u) {
  const pad = u * 6;
  const cardH = u * 10;
  const ctx = setupCanvas(canvas, w + pad * 2, h + pad * 2 + cardH / 2, t.bg);
  drawBlurredBackground(ctx, img, w, h, u);
  drawRoundedPhoto(ctx, img, pad, pad, w, h, u * 1.4, u);

  const cardW = Math.min(w * 0.86, u * 80);
  const cx = canvas.width / 2;
  const cardX = cx - cardW / 2;
  const cardY = pad + h - cardH / 2;
  const r = u * 1.6;

  // Vidrio: desenfoca lo que hay detrás de la tarjeta
  const snap = document.createElement('canvas');
  snap.width = canvas.width;
  snap.height = canvas.height;
  snap.getContext('2d').drawImage(canvas, 0, 0);
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, r);
  ctx.clip();
  ctx.filter = `blur(${Math.round(u * 2.5)}px) brightness(0.75)`;
  ctx.drawImage(snap, 0, 0);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  ctx.fill();
  ctx.restore();
  roundRect(ctx, cardX, cardY, cardW, cardH, r);
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = Math.max(1, u * 0.12);
  ctx.stroke();

  const inner = u * 2.5;
  const midY = cardY + cardH / 2;
  const logoW = drawLogo(ctx, brandOf(info), cardX + inner, midY, u * 2.6, t.fg, 'left', t.monoLogo);
  const textX = cardX + inner + (logoW ? logoW + u * 2 : 0);
  text(ctx, info.camera, textX, midY - u * 0.3, { weight: 700, size: u * 2.1, color: t.fg });
  text(ctx, [info.lens, info.author && `© ${info.author}`].filter(Boolean).join(SEP), textX, midY + u * 2.1, { size: u * 1.4, color: t.sub });
  const right = cardX + cardW - inner;
  text(ctx, info.settings, right, midY - u * 0.3, { weight: 700, size: u * 2, color: t.fg, align: 'right' });
  text(ctx, info.date, right, midY + u * 2.1, { size: u * 1.4, color: t.sub, align: 'right' });
}

function drawSide(canvas, img, info, t, w, h, u) {
  const pad = u * 2;
  const panel = u * 24;
  const ctx = setupCanvas(canvas, w + pad * 2 + panel, h + pad * 2, t.bg);
  ctx.drawImage(img, pad, pad, w, h);

  const x = w + pad * 2 + u;
  const maxW = panel - u * 3;
  const fit = (str, weight, size) => fitSize(ctx, str || ' ', maxW, weight, size);
  let y = pad + u * 2;

  if (brandOf(info)) {
    drawLogo(ctx, brandOf(info), x, y + u * 1.8, Math.min(u * 3.2, fit('W'.repeat(6), 800, u * 3.2)), t.fg, 'left', t.monoLogo);
    y += u * 7;
  }
  text(ctx, info.camera, x, y + u * 2, { weight: 700, size: fit(info.camera, 700, u * 2.4), color: t.fg });
  text(ctx, info.lens, x, y + u * 4.6, { size: fit(info.lens, 400, u * 1.5), color: t.sub });

  ctx.fillStyle = t.sub;
  ctx.fillRect(x, y + u * 6.8, u * 4, Math.max(1, u * 0.15));

  // Un ajuste por línea
  const parts = info.settings.split(/\s{2,}/).filter(Boolean);
  parts.forEach((p, i) => {
    text(ctx, p, x, y + u * 10.5 + i * u * 3.2, { weight: 700, size: fit(p, 700, u * 2.2), color: t.fg });
  });

  const bottom = h + pad;
  text(ctx, info.date, x, bottom - (info.author ? u * 3 : 0), { size: fit(info.date, 400, u * 1.4), color: t.sub });
  text(ctx, info.author && `© ${info.author}`, x, bottom, { weight: 500, size: u * 1.5, color: t.fg });
}
