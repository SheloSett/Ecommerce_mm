// Centinela: el stock se cambia SOLO desde services/stock.service.js. Correr con: npm test
//
// Antes el stock se escribía desde unos 20 lugares, cada uno leyendo el número y escribiéndolo de
// nuevo; dos cambios a la vez se pisaban y no quedaba ningún historial. Si alguien vuelve a escribir
// `stock: algo` en un update de Prisma fuera del servicio, este test falla y dice dónde.
//
// Mira el código sin comentarios y busca "stock:" seguido de un valor. No cuenta lo que no es una
// escritura: selects (stock: true), filtros (stock: { gt: 0 }), orden (stock: "asc"). Lo que sí es
// escritura pero está bien (crear un producto con su stock inicial, armar una respuesta) va en ALLOWED,
// con el motivo.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src");
const SERVICE = path.join("services", "stock.service.js");

// archivo (relativo a src) → fragmentos permitidos de la línea, con el motivo
const ALLOWED = {
  [path.join("controllers", "product.controller.js")]: [
    "stock: parseInt(stock) || 0,",     // createProduct: el producto nace con su stock (queda en el historial con recordInitial)
  ],
  [path.join("controllers", "purchase.controller.js")]: [
    "stock:  itemQty,",                 // applyItemTx: producto nuevo que crea la compra (historial con recordInitial)
    "stock: itemQty, reason",           // segunda línea de la llamada a recordInitial: argumento, no escritura
  ],
  [path.join("routes", "cart.routes.js")]: [
    "stock:          product.stock,",   // respuesta del carrito (lo que hay para mostrar), no una escritura
  ],
};
// Llamadas al propio servicio: sus argumentos (stock: n) no son escrituras.
const SERVICE_CALL = /\b(?:recordInitial|recordRemoved|adjustStock)\s*\(/;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith(".js") ? [full] : [];
  });
}

// Saca los comentarios conservando los saltos de línea (para que los números de línea sigan valiendo).
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (m, pre) => pre);
}

// "stock:" seguido de un valor que no sea select/filtro/orden
const WRITE = /\bstock\s*:\s*(?!true\b|false\b|\{\s*(?:gt|gte|lt|lte|not|equals|in)\b|["'](?:asc|desc)["'])\S/;
// asignaciones sueltas: data.stock = ..., updateData.stock = ... (no where.stock = { gt })
const ASSIGN = /\b(?!where\b)\w+\.stock\s*=(?!=)/;

test("nadie escribe stock fuera de services/stock.service.js", () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (rel === SERVICE) continue;
    const lines = stripComments(fs.readFileSync(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!WRITE.test(line) && !ASSIGN.test(line)) return;
      if (SERVICE_CALL.test(line)) return;
      if ((ALLOWED[rel] || []).some((ok) => line.includes(ok))) return;
      offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], "El stock se cambia con adjustStock (services/stock.service.js), no a mano:\n" + offenders.join("\n"));
});

test("el centinela detecta una escritura de stock (que no se rompa en silencio)", () => {
  const sample = stripComments([
    "await prisma.product.update({ where: { id }, data: { stock: newStock } });",
    "// await prisma.product.update({ data: { stock: 1 } }) — comentado, no cuenta",
    "updateData.stock = 5;",
    "select: { stock: true }, where: { stock: { gt: 0 } }, orderBy: { stock: \"asc\" }",
  ].join("\n")).split("\n");
  const hits = sample.filter((l) => WRITE.test(l) || ASSIGN.test(l));
  assert.equal(hits.length, 2);
});
