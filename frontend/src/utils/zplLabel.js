// Etiqueta de envío en ZPL (el idioma de las impresoras térmicas Zebra, que la TSC ME240 también entiende;
// es el mismo formato de las etiquetas Flex de Mercado Libre). Sale exacta en 10×15 sin pasar por el
// tamaño de hoja de Chrome ni por el driver.
//
// La etiqueta se dibuja en un canvas con la misma distribución que la vista previa (utils/shippingLabel.js),
// apaisada de 150 × 100 mm a 203 dpi (8 puntos por mm: 1200 × 800), se gira para el rollo de 10×15 parado
// (800 de ancho × 1200 de largo, como las etiquetas de Mercado Libre) y va como una imagen en blanco y
// negro (^GFA) con la compresión de Zebra. Como imagen, las tildes y los textos largos salen igual que en
// pantalla (cada texto se achica hasta entrar en su recuadro).

export const DOTS_PER_MM = 8;          // 203 dpi
export const LABEL_W = 150 * DOTS_PER_MM; // 1200 (apaisada)
export const LABEL_H = 100 * DOTS_PER_MM; // 800

// ── Compresión ASCII de Zebra para ^GFA ────────────────────────────────────
// Un carácter repetido n veces se escribe con letras de cantidad delante: G..Y = 1..19, g..z = 20..400
// (se suman: "hI" = 43). "," completa la fila con 0, "!" con F, ":" repite la fila anterior.
const LOW = "GHIJKLMNOPQRSTUVWXY";
const HIGH = "ghijklmnopqrstuvwxyz";
export function repeatPrefix(n) {
  let s = "";
  while (n >= 400) { s += "z"; n -= 400; }
  if (n >= 20) { s += HIGH[Math.floor(n / 20) - 1]; n %= 20; }
  if (n > 0) s += LOW[n - 1];
  return s;
}

function runs(hex) {
  let out = "";
  for (let i = 0; i < hex.length;) {
    let j = i;
    while (j < hex.length && hex[j] === hex[i]) j++;
    const n = j - i;
    out += (n > 1 ? repeatPrefix(n) : "") + hex[i];
    i = j;
  }
  return out;
}

// bits: un byte por punto (1 = negro), fila por fila. width múltiplo de 8.
// Devuelve { total, bytesPerRow, data } para "^GFA,total,total,bytesPerRow,data".
export function encodeGFA(bits, width, height) {
  if (width % 8 !== 0) throw new Error("El ancho tiene que ser múltiplo de 8");
  const bpr = width / 8;
  let data = "";
  let prev = null;
  let prevExact = false; // la fila anterior terminó justo, sin "," ni "!"
  for (let y = 0; y < height; y++) {
    let hex = "";
    for (let b = 0; b < bpr; b++) {
      let v = 0;
      for (let k = 0; k < 8; k++) v = (v << 1) | (bits[y * width + b * 8 + k] ? 1 : 0);
      hex += v.toString(16).toUpperCase().padStart(2, "0");
    }
    if (hex === prev) { data += ":"; prevExact = false; continue; }
    prev = hex;
    // Ceros (o F) hasta el final de la fila → "," (o "!"). No justo después de una fila que terminó
    // exacta: algunos lectores toman esa coma como el cierre de la fila anterior.
    const tail = hex.match(/(0+|F+)$/);
    if (tail && tail[0].length >= 2 && !(prevExact && tail.index === 0)) {
      data += runs(hex.slice(0, tail.index)) + (tail[0][0] === "0" ? "," : "!");
      prevExact = false;
    } else {
      data += runs(hex);
      prevExact = true;
    }
  }
  return { total: bpr * height, bytesPerRow: bpr, data };
}

// ZPL completo de una imagen (ya parada para el rollo). flip: true = dada vuelta 180° (^POI).
export function zplFromBitmap(bits, width, height, { flip = false } = {}) {
  const { total, bytesPerRow, data } = encodeGFA(bits, width, height);
  return [
    "^XA",
    "^CI28",
    `^PW${width}`,
    `^LL${height}`,
    "^LH0,0",
    flip ? "^POI" : "^PON",
    `^FO0,0^GFA,${total},${total},${bytesPerRow},${data}^FS`,
    "^XZ",
    "",
  ].join("\n");
}

// ── Dibujo (solo en el navegador) ──────────────────────────────────────────
const FONT = (px) => `bold ${Math.round(px)}px Arial, Helvetica, sans-serif`;

// Tamaño de letra (≤ max) para que los renglones entren en w × h
function fitSize(ctx, lines, w, h, max, lineHeight = 1.15) {
  let px = max;
  while (px > 10) {
    ctx.font = FONT(px);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= w && lines.length * px * lineHeight <= h) break;
    px -= 1;
  }
  return px;
}

function centeredLines(ctx, lines, cx, cy, px, lineHeight = 1.15) {
  ctx.font = FONT(px);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const step = px * lineHeight;
  const top = cy - ((lines.length - 1) * step) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, top + i * step));
}

function box(ctx, x, y, w, h, t = 4) {
  ctx.fillRect(x, y, w, t);
  ctx.fillRect(x, y + h - t, w, t);
  ctx.fillRect(x, y, t, h);
  ctx.fillRect(x + w - t, y, t, h);
}

const split = (s) => (s || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && i < a.length - 1));

// Dibuja la etiqueta apaisada (1200 × 800) con la misma distribución que la hoja de impresión.
export function drawLabelCanvas(label, { packages = { current: 1, total: 1 } } = {}) {
  const c = document.createElement("canvas");
  c.width = LABEL_W;
  c.height = LABEL_H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000";

  const m = 20, gap = 16, pad = 20;            // 2,5 mm de margen, 2 mm entre recuadros
  const innerW = LABEL_W - 2 * m;
  const nameH = 136, bottomH = 272;              // 17 mm y 34 mm, como la hoja
  const detY = m + nameH + gap;
  const detH = LABEL_H - m - bottomH - gap - detY;
  const botY = LABEL_H - m - bottomH;
  const halfW = (innerW - gap) / 2;

  // Destinatario
  box(ctx, m, m, innerW, nameH);
  const name = split(label.recipientName);
  centeredLines(ctx, name, m + innerW / 2, m + nameH / 2, fitSize(ctx, name, innerW - 2 * pad, nameH - 16, 72));

  // Datos de entrega
  box(ctx, m, detY, innerW, detH);
  const det = split(label.recipientDetails);
  if (det.length) centeredLines(ctx, det, m + innerW / 2, detY + detH / 2, fitSize(ctx, det, innerW - 2 * pad, detH - 16, 48));

  // Transporte / seguro / bultos
  box(ctx, m, botY, halfW, bottomH);
  const lx = m + halfW / 2;
  const small = 29;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = FONT(small);
  ctx.fillText("TRANSPORTE:", lx, botY + 34);
  const tr = [label.transport || " "];
  centeredLines(ctx, tr, lx, botY + 92, fitSize(ctx, tr, halfW - 2 * pad, 60, 48));
  const ins = label.insurance || "—";
  ctx.font = FONT(small);
  const segW = ctx.measureText("SEGURO: ").width;
  const insPx = fitSize(ctx, [ins], halfW - 2 * pad - segW, 50, 36);
  ctx.font = FONT(insPx);
  const insW = ctx.measureText(ins).width;
  const segX = lx - (segW + insW) / 2;
  ctx.textAlign = "left";
  ctx.font = FONT(small);
  ctx.fillText("SEGURO:", segX, botY + 156);
  ctx.font = FONT(insPx);
  ctx.fillText(ins, segX + segW, botY + 156);
  const cur = Math.max(1, parseInt(packages.current) || 1);
  const tot = Math.max(cur, parseInt(packages.total) || 1);
  const bult = `${cur} / ${tot}`;
  ctx.font = FONT(52);
  const bW = ctx.measureText(bult).width + 36;
  ctx.font = FONT(small);
  const cbW = ctx.measureText("CANT. BULTOS").width;
  const rowX = lx - (cbW + 16 + bW) / 2;
  ctx.fillText("CANT. BULTOS", rowX, botY + 222);
  box(ctx, rowX + cbW + 16, botY + 222 - 34, bW, 68, 3);
  ctx.textAlign = "center";
  ctx.font = FONT(52);
  ctx.fillText(bult, rowX + cbW + 16 + bW / 2, botY + 224);

  // Remitente
  const rx = m + halfW + gap;
  box(ctx, rx, botY, halfW, bottomH);
  const snd = ["Remitente:", ...split(label.sender)];
  centeredLines(ctx, snd, rx + halfW / 2, botY + bottomH / 2, fitSize(ctx, snd, halfW - 2 * pad, bottomH - 24, 40));
  return c;
}

// Gira la etiqueta para el rollo de 10×15 parado (800 de ancho × 1200 de largo) y la pasa a blanco y negro.
export function portraitBits(landscape) {
  const p = document.createElement("canvas");
  p.width = LABEL_H;
  p.height = LABEL_W;
  const ctx = p.getContext("2d");
  ctx.translate(LABEL_H, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(landscape, 0, 0);
  const { data } = ctx.getImageData(0, 0, p.width, p.height);
  const bits = new Uint8Array(p.width * p.height);
  for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4] < 128 ? 1 : 0;
  return { bits, width: p.width, height: p.height };
}

export function labelToZpl(label, { packages, flip = false } = {}) {
  const { bits, width, height } = portraitBits(drawLabelCanvas(label, { packages }));
  return zplFromBitmap(bits, width, height, { flip });
}

// Baja el .zpl (se manda a la impresora como las etiquetas de Mercado Libre)
export function downloadZpl(label, opts = {}) {
  const zpl = labelToZpl(label, opts);
  const name = (label.recipientName || "etiqueta").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "etiqueta";
  const blob = new Blob([zpl], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Etiqueta ${name}.zpl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return zpl;
}
