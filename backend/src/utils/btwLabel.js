// Lee un archivo .btw de BarTender (2016 y anteriores) y saca los datos de una etiqueta de envío.
//
// Cómo es el archivo (visto en las 319 etiquetas del negocio, 2016-2026):
//   1. Un encabezado de texto ("Bar Tender Format File", impresora, y en las nuevas un <Metadata> con
//      <TemplateSize>150 x 100 mm</TemplateSize> y el <Title>).
//   2. Una vista previa en PNG.
//   3. Bloques comprimidos con zlib. Uno de ellos guarda el diseño: los textos van serializados al
//      estilo MFC (FF FE FF + largo + UTF-16LE). El valor de cada objeto de texto aparece justo
//      después de la máscara "(???) ???-????" que BarTender guarda en cada uno.
//
// No se escribe nunca un .btw: solo se leen para pasar los datos al panel.
//
// Las etiquetas de envío tienen siempre los mismos textos fijos ("CANT. BULTOS", "TRANSPORTE:",
// "SEGURO:") y el remitente empieza con "Remitente:". El resto se reparte así:
//   - transporte = el texto que sigue al remitente; seguro = el que sigue a "SEGURO:";
//   - bultos = los dos números que siguen al seguro ("2" y "2" → 2 de 2);
//   - de lo que queda: el bloque de varios renglones son los datos de entrega y el renglón suelto el
//     nombre (en el molde de MOTO el nombre va al final y los datos arriba).

const zlib = require("zlib");

const MASK = "(???) ???-????";
const PLACEHOLDER = "Texto de muestra";

// Todos los bloques zlib que se pueden descomprimir. Se buscan después de la vista previa (los de
// antes son del encabezado y del propio PNG).
function zlibBlocks(buf) {
  const iend = buf.indexOf(Buffer.from("IEND"));
  const from = iend > 0 ? iend + 8 : 0;
  const blocks = [];
  for (let i = from; i < buf.length - 2; i++) {
    if (buf[i] === 0x78 && (buf[i + 1] === 0x01 || buf[i + 1] === 0x5e || buf[i + 1] === 0x9c || buf[i + 1] === 0xda)) {
      try {
        const out = zlib.inflateSync(buf.subarray(i));
        if (out.length > 50) blocks.push(out);
      } catch { /* no era un bloque zlib */ }
    }
  }
  return blocks;
}

// Cadenas MFC: FF FE FF, un byte de largo (o FF + 2 bytes si es más larga) y el texto en UTF-16LE.
function mfcStrings(data) {
  const res = [];
  for (let i = 0; i < data.length - 4; i++) {
    if (data[i] === 0xff && data[i + 1] === 0xfe && data[i + 2] === 0xff) {
      let len = data[i + 3];
      let p = i + 4;
      if (len === 0xff) { len = data.readUInt16LE(p); p += 2; }
      if (len > 0 && p + len * 2 <= data.length) res.push(data.subarray(p, p + len * 2).toString("utf16le"));
    }
  }
  return res;
}

// Los valores de los objetos de texto, en el orden en que aparecen.
function textValues(buf) {
  const vals = [];
  for (const block of zlibBlocks(buf)) {
    const ss = mfcStrings(block);
    ss.forEach((s, i) => {
      const next = ss[i + 1];
      if (s === MASK && next !== undefined && !/^(Box Options|Recuadro|DataSource|Root\.)/.test(next)) vals.push(next);
    });
  }
  return vals;
}

// "150 x 100 mm" → "10x15"; "101 x 101 mm" → "10x10". Sin dato en el archivo, se mira el nombre.
function sizeOf(header, fileName = "") {
  const m = header.match(/<TemplateSize>\s*([\d.,]+)\s*x\s*([\d.,]+)\s*mm/i);
  const fromMm = (a, b) => {
    const [w, h] = [a, b].map((v) => Math.round(parseFloat(String(v).replace(",", ".")) / 10));
    return `${Math.min(w, h)}x${Math.max(w, h)}`;
  };
  if (m) return fromMm(m[1], m[2]);
  const n = fileName.match(/(\d{2})\s*x\s*(\d{2})/i);
  return n ? fromMm(n[1] * 10, n[2] * 10) : null;
}

const clean = (s) => (s || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).join("\n").trim();
const isFixed = (s) => /^(CANT\.?\s*BULTOS|TRANSPORTE:?|SEGURO:?|Seguro|Texto de muestra)$/i.test(s.trim());

// buf: el contenido del .btw. Devuelve null si no es un archivo de BarTender o no tiene textos.
function parseBtwLabel(buf, fileName = "") {
  const header = buf.subarray(0, 2000).toString("latin1");
  if (!header.includes("Bar Tender Format File")) return null;
  const title = (header.match(/<Title>([^<]*)</) || [])[1] || null;
  const vals = textValues(buf).map(clean).filter((v) => v && v !== PLACEHOLDER);
  if (vals.length === 0) return null;

  const used = new Set();
  const take = (i) => { if (i >= 0 && i < vals.length && !used.has(i)) { used.add(i); return vals[i]; } return null; };

  // Remitente (sin el renglón "Remitente:")
  const senderIdx = vals.findIndex((v) => /^remitente/i.test(v));
  const senderRaw = take(senderIdx);
  const sender = senderRaw ? clean(senderRaw.replace(/^remitente:?\s*/i, "")) : null;

  // Transporte: el que sigue al remitente (si no es un texto fijo)
  let transport = null;
  if (senderIdx >= 0 && vals[senderIdx + 1] && !isFixed(vals[senderIdx + 1])) transport = take(senderIdx + 1);

  // Seguro: el que sigue a "SEGURO:"
  const segIdx = vals.findIndex((v) => /^seguro:?$/i.test(v.trim()));
  if (segIdx >= 0) used.add(segIdx);
  const insurance = segIdx >= 0 && vals[segIdx + 1] && !isFixed(vals[segIdx + 1]) ? take(segIdx + 1) : null;

  // Bultos: los dos primeros números que quedan ("2" y "2" → 2 de 2)
  const nums = vals.map((v, i) => (/^\d{1,3}$/.test(v) && !used.has(i) ? i : -1)).filter((i) => i >= 0);
  let packages = null;
  if (nums.length >= 2) { packages = { current: parseInt(vals[nums[0]]), total: parseInt(vals[nums[1]]) }; }
  nums.forEach((i) => used.add(i));
  vals.forEach((v, i) => { if (isFixed(v)) used.add(i); });

  // Lo que queda: datos de entrega (el de más renglones) y nombre (un renglón suelto)
  const rest = vals.map((v, i) => ({ v, i })).filter(({ i }) => !used.has(i));
  const multi = [...rest].sort((a, b) => b.v.split("\n").length - a.v.split("\n").length)[0];
  let recipientDetails = multi && multi.v.includes("\n") ? multi.v : "";
  if (multi && recipientDetails) used.add(multi.i);
  const single = rest.find(({ i, v }) => !used.has(i) && !v.includes("\n"));
  let recipientName = single ? single.v : "";
  if (!recipientName && recipientDetails) {
    // Sin renglón suelto: el primero de los datos hace de nombre
    const lines = recipientDetails.split("\n");
    recipientName = lines.shift();
    recipientDetails = lines.join("\n");
  }
  if (!recipientName && !recipientDetails) return null;

  return {
    title,
    size: sizeOf(header, fileName),
    recipientName: recipientName.replace(/\s+/g, " ").trim(),
    recipientDetails,
    transport,
    insurance,
    sender,
    packages,
  };
}

module.exports = { parseBtwLabel, sizeOf, mfcStrings };
