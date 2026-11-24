// Tests del ZPL de la etiqueta de envío (utils/zplLabel.js). Correr con: npm test
// El decodificador de abajo es el del renderizador de etiquetas ZPL de Mercado Libre (verificado con
// etiquetas Flex reales), pasado a JavaScript: lo que se codifica tiene que volver idéntico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeGFA, repeatPrefix, zplFromBitmap } from "./zplLabel.js";

function decodeGF(data, total, bpr) {
  const rep = {};
  "GHIJKLMNOPQRSTUVWXY".split("").forEach((c, i) => { rep[c] = i + 1; });
  "ghijklmnopqrstuvwxyz".split("").forEach((c, i) => { rep[c] = (i + 1) * 20; });
  const rl = bpr * 2;
  const rows = [];
  let cur = "", prev = null, cnt = 0, auto = false;
  for (const c of data.trim()) {
    if (rep[c]) { cnt += rep[c]; continue; }
    if (/[0-9A-Fa-f]/.test(c)) {
      const n = cnt || 1; cnt = 0;
      for (let k = 0; k < n; k++) {
        cur += c.toUpperCase();
        if (cur.length >= rl) { rows.push(cur.slice(0, rl)); prev = rows[rows.length - 1]; cur = ""; auto = true; } else auto = false;
      }
      continue;
    }
    cnt = 0;
    if (c === "," || c === "!") {
      if (cur === "" && auto) { auto = false; continue; }
      cur += (c === "," ? "0" : "F").repeat(rl - cur.length);
      rows.push(cur); prev = cur; cur = ""; auto = false;
    } else if (c === ":") {
      if (prev !== null) rows.push(prev);
      auto = false;
    }
  }
  if (cur) rows.push(cur.padEnd(rl, "0"));
  return rows.slice(0, total / bpr);
}

function bitsToRows(bits, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    let hex = "";
    for (let b = 0; b < w / 8; b++) {
      let v = 0;
      for (let k = 0; k < 8; k++) v = (v << 1) | bits[y * w + b * 8 + k];
      hex += v.toString(16).toUpperCase().padStart(2, "0");
    }
    rows.push(hex);
  }
  return rows;
}

function roundTrip(bits, w, h) {
  const { total, bytesPerRow, data } = encodeGFA(bits, w, h);
  assert.equal(total, (w / 8) * h);
  assert.deepEqual(decodeGF(data, total, bytesPerRow), bitsToRows(bits, w, h));
  return data;
}

test("letras de cantidad: G=1 … Y=19, g=20 … z=400, sumadas", () => {
  assert.equal(repeatPrefix(1), "G");
  assert.equal(repeatPrefix(19), "Y");
  assert.equal(repeatPrefix(20), "g");
  assert.equal(repeatPrefix(43), "hI");
  assert.equal(repeatPrefix(400), "z");
  assert.equal(repeatPrefix(845), "zzhK");
});

test("todo blanco: una coma y filas repetidas", () => {
  const w = 800, h = 50;
  const data = roundTrip(new Uint8Array(w * h), w, h);
  assert.ok(data.length < 60, `muy largo: ${data.length}`);
});

test("rayas, filas que terminan justas, filas negras y filas iguales seguidas", () => {
  const w = 64, h = 40;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      if (y % 7 === 0) on = 1;                 // fila negra entera
      else if (y % 5 === 0) on = x === w - 1 ? 1 : 0; // termina justo en un punto negro
      else if (y % 3 === 0) on = (x >> 2) & 1; // rayas hasta el final
      else if (y % 4 === 0) on = x < 10 ? 1 : 0;
      bits[y * w + x] = on;
    }
  }
  // dos filas en blanco después de una que terminó justa
  for (const y of [11, 12]) for (let x = 0; x < w; x++) bits[y * w + x] = 0;
  for (let x = 0; x < w; x++) bits[10 * w + x] = x === w - 1 ? 1 : 0;
  roundTrip(bits, w, h);
});

test("al azar", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const w = 120, h = 60;
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < bits.length; i++) bits[i] = rnd() < 0.3 ? 1 : 0;
  roundTrip(bits, w, h);
});

test("el ZPL trae ancho, largo, orientación y la imagen", () => {
  const z = zplFromBitmap(new Uint8Array(800 * 16), 800, 16, { flip: true });
  assert.match(z, /^\^XA\n\^CI28\n\^PW800\n\^LL16\n/);
  assert.ok(z.includes("^POI"));
  assert.match(z, /\^FO0,0\^GFA,1600,1600,100,/);
  assert.ok(z.trim().endsWith("^XZ"));
  assert.ok(zplFromBitmap(new Uint8Array(800 * 16), 800, 16).includes("^PON"));
});
