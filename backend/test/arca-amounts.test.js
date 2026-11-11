// Tests de los importes de la factura (services/arca/amounts.js). Funciones puras. Correr con: npm test
//
// Además de los casos a mano, un test arma muchos pedidos al azar con utils/orderTotals.js (la misma
// cuenta que usan el checkout, las cotizaciones y las ventas manuales) y comprueba que la factura cierra
// al centavo con Order.total y que cada IVA corresponde a su base dentro del margen de ARCA.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildInvoiceAmounts, findActiveInvoice, SHIPPING_MODES, toCents, formatCents, divRoundHalfEven, allocate, splitGross,
} = require("../src/services/arca/amounts");
const { computeOrderTotals } = require("../src/utils/orderTotals");

const item = (id, price, quantity = 1, productId = id, extra = {}) => ({ id, price, quantity, productId, currency: "ARS", ...extra });
const order = (items, extra = {}) => ({ status: "APPROVED", wantsInvoice: false, ivaAmount: 0, shippingCost: 0, shippingMethod: "RETIRO", items, ...extra });
const codes = (r) => (r.errors || []).map((e) => e.code).sort();
const warningCodes = (r) => (r.warnings || []).map((w) => w.code).sort();
const centsOf = (s) => Math.round(Number(s) * 100);

describe("cuentas con enteros", () => {
  test("divRoundHalfEven redondea la mitad al par, como ARCA", () => {
    assert.equal(divRoundHalfEven(5n, 2n), 2n);
    assert.equal(divRoundHalfEven(7n, 2n), 4n);
    assert.equal(divRoundHalfEven(1n, 3n), 0n);
    assert.equal(divRoundHalfEven(2n, 3n), 1n);
    assert.equal(divRoundHalfEven(-5n, 2n), -2n);
  });

  test("allocate: la suma da exacta, los ceros no reciben nada y los empates son estables", () => {
    assert.deepEqual(allocate(100n, [1n, 1n, 1n]), [34n, 33n, 33n]);
    assert.deepEqual(allocate(10n, [0n, 3n, 1n]), [0n, 8n, 2n]);
    assert.deepEqual(allocate(0n, [0n, 0n]), [0n, 0n]);
    assert.equal(allocate(5n, [0n, 0n]), null);
  });

  test("formatCents y toCents", () => {
    assert.equal(formatCents(0), "0.00");
    assert.equal(formatCents(5), "0.05");
    assert.equal(formatCents(123456), "1234.56");
    assert.equal(formatCents(-5n), "-0.05");
    assert.equal(toCents(1234.56), 123456);
    assert.equal(toCents("0.1"), 10);
    assert.equal(toCents(-0.001), 0);
    assert.equal(toCents("abc"), null);
    assert.equal(toCents(null), null);
  });

  test("splitGross: base + IVA = bruto, y el IVA coincide con base × alícuota dentro del margen de ARCA", () => {
    let exactos = 0;
    for (const pm of [210n, 105n]) {
      for (let g = 1n; g <= 5000n; g++) {
        const { base, iva } = splitGross(g, pm);
        assert.equal(base + iva, g);
        assert.ok(base > 0n);
        // Validación 10051: |Importe − BaseImp × alícuota| <= 0,01 (un centavo), sin y con redondeo.
        const err = iva * 1000n - base * pm;
        assert.ok(err <= 1000n && err >= -1000n, `g=${g} pm=${pm}`);
        const d = iva - divRoundHalfEven(base * pm, 1000n);
        assert.ok(d >= -1n && d <= 1n);
        if (d === 0n) exactos++;
      }
    }
    // La gran mayoría coincide exacto con el redondeo de ARCA (los demás, por un centavo).
    assert.ok(exactos > 8000, `exactos: ${exactos}`);
    assert.deepEqual(splitGross(12100n, 210n), { base: 10000n, iva: 2100n });
    assert.deepEqual(splitGross(1n, 210n), { base: 1n, iva: 0n });
  });
});

describe("importes de la factura", () => {
  test("minorista, un producto al 21 %: precio con IVA adentro", () => {
    const r = buildInvoiceAmounts(order([item(1, 12100)], { total: 12100 }), { productRates: { 1: 21 } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.fe, {
      ImpTotal: "12100.00", ImpTotConc: "0.00", ImpNeto: "10000.00", ImpOpEx: "0.00", ImpTrib: "0.00", ImpIVA: "2100.00",
      Iva: [{ Id: 5, BaseImp: "10000.00", Importe: "2100.00" }],
    });
    assert.deepEqual(r.lines[0], {
      orderItemId: 1, productId: 1, quantity: 1, pct: 21, ivaId: 5, rateSource: "PRODUCTO",
      grossCents: 1210000, netCents: 1000000, ivaCents: 210000, unitGrossCents: 1210000, unitNetCents: 1000000,
    });
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.ivaControl, { applies: false });
  });

  test("mayorista con factura, 21 % y 10,5 % con cupón del 10 %: las bases son las del pedido", () => {
    const items = [item(1, 100000), item(2, 100000)];
    const t = computeOrderTotals({ items, coupon: { discountType: "PERCENTAGE", discountValue: 10 }, ivaRates: { 1: 21, 2: 10.5 } });
    assert.equal(t.totalArs, 208350);
    const r = buildInvoiceAmounts(order(items, { total: t.totalArs, wantsInvoice: true, ivaAmount: t.ivaAmountArs }), { productRates: { 1: 21, 2: 10.5 } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.byRate, [
      { ivaId: 5, pct: 21, grossCents: 10890000, baseCents: 9000000, ivaCents: 1890000 },
      { ivaId: 4, pct: 10.5, grossCents: 9945000, baseCents: 9000000, ivaCents: 945000 },
    ]);
    assert.equal(r.fe.ImpNeto, "180000.00");
    assert.equal(r.fe.ImpIVA, "28350.00");
    assert.equal(r.fe.ImpTotal, "208350.00");
    assert.deepEqual(r.ivaControl, { applies: true, storedCents: 2835000, computedCents: 2835000, diffCents: 0, toleranceCents: 5, ok: true });
  });

  test("envío gravado al 21 % (por defecto): renglón aparte", () => {
    const r = buildInvoiceAmounts(order([item(1, 12100)], { total: 13310, shippingCost: 1210, shippingMethod: "MOTO" }), { productRates: { 1: 21 } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.shippingLines, [{ pct: 21, ivaId: 5, grossCents: 121000, netCents: 100000, ivaCents: 21000 }]);
    assert.deepEqual(r.fe.Iva, [{ Id: 5, BaseImp: "11000.00", Importe: "2310.00" }]);
    assert.equal(r.totals.productsCents, 1210000);
  });

  test("envío prorrateado: se reparte entre las alícuotas de los productos", () => {
    const r = buildInvoiceAmounts(
      order([item(1, 12100), item(2, 11050)], { total: 24150, shippingCost: 1000 }),
      { productRates: { 1: 21, 2: 10.5 }, shippingMode: SHIPPING_MODES.PRORRATEADO },
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.shippingLines.map((s) => [s.pct, s.grossCents]), [[21, 52268], [10.5, 47732]]);
    assert.equal(r.fe.Iva.length, 2);
    assert.equal(r.totals.noGravadoCents, 0);
  });

  test("envío no gravado: va en ImpTotConc, sin IVA", () => {
    const r = buildInvoiceAmounts(order([item(1, 12100)], { total: 13100, shippingCost: 1000 }), { productRates: { 1: 21 }, shippingMode: "NO_GRAVADO" });
    assert.equal(r.ok, true);
    assert.equal(r.fe.ImpTotConc, "1000.00");
    assert.equal(r.fe.ImpNeto, "10000.00");
    assert.equal(r.fe.ImpIVA, "2100.00");
    assert.deepEqual(r.shippingLines, [{ pct: null, ivaId: null, grossCents: 100000, netCents: 100000, ivaCents: 0 }]);
  });

  test("ítem sin producto: 21 % por defecto, y el admin puede pasarlo a 10,5", () => {
    const items = [item(1, 1105, 1, null), item(2, 1210)];
    const porDefecto = buildInvoiceAmounts(order(items, { total: 2315 }), { productRates: { 2: 21 } });
    assert.equal(porDefecto.lines[0].rateSource, "POR_DEFECTO");
    assert.equal(porDefecto.lines[0].pct, 21);
    const elegido = buildInvoiceAmounts(order(items, { total: 2315 }), { productRates: { 2: 21 }, lineRates: { 1: "10,5" } });
    assert.equal(elegido.lines[0].rateSource, "PANEL");
    assert.deepEqual(elegido.fe.Iva, [{ Id: 5, BaseImp: "1000.00", Importe: "210.00" }, { Id: 4, BaseImp: "1000.00", Importe: "105.00" }]);
  });

  test("cupón del 100 % con envío: la factura es solo el envío", () => {
    const r = buildInvoiceAmounts(order([item(1, 5000)], { total: 1210, shippingCost: 1210 }), { productRates: { 1: 21 } });
    assert.equal(r.ok, true);
    assert.equal(r.lines[0].grossCents, 0);
    assert.deepEqual(r.fe.Iva, [{ Id: 5, BaseImp: "1000.00", Importe: "210.00" }]);
  });

  test("precio unitario redondeado y renglón exacto", () => {
    const r = buildInvoiceAmounts(order([item(1, 100, 3)], { total: 300 }), { productRates: { 1: 21 } });
    const l = r.lines[0];
    assert.equal(l.netCents + l.ivaCents, 30000);
    assert.equal(l.unitGrossCents, 10000);
    assert.equal(l.unitNetCents, Number(divRoundHalfEven(BigInt(l.netCents), 3n)));
  });
});

describe("cuándo no se factura", () => {
  test("pedido cancelado o rechazado", () => {
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: 100, status: "CANCELLED" }), { productRates: { 1: 21 } })), ["PEDIDO_CANCELADO"]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: 100, status: "REJECTED" }), { productRates: { 1: 21 } })), ["PEDIDO_RECHAZADO"]);
  });

  test("líneas en dólares (o un total en dólares)", () => {
    const usd = buildInvoiceAmounts(order([item(1, 100), item(2, 50, 1, 2, { currency: "USD" })], { total: 100 }), { productRates: { 1: 21, 2: 21 } });
    assert.deepEqual(codes(usd), ["LINEAS_EN_DOLARES"]);
    assert.deepEqual(usd.errors[0].orderItemIds, [2]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: 100, totalUsd: 10 }), { productRates: { 1: 21 } })), ["LINEAS_EN_DOLARES"]);
  });

  test("total en cero, sin líneas, envío mayor al total, importes que no son números", () => {
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 0)], { total: 0 }), { productRates: { 1: 21 } })), ["TOTAL_CERO"]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([], { total: 100 }))), ["SIN_LINEAS"]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: 100, shippingCost: 200 }), { productRates: { 1: 21 } })), ["ENVIO_INCONSISTENTE"]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: "x" }), { productRates: { 1: 21 } })), ["IMPORTES_INVALIDOS"]);
    assert.deepEqual(codes(buildInvoiceAmounts(null)), ["PEDIDO_INVALIDO"]);
  });

  test("alícuotas: distinta de 21 o 10,5, la del producto que falta, o una elegida que no existe", () => {
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: 100 }), { productRates: { 1: 27 } })), ["ALICUOTA_INVALIDA"]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: 100 }), { productRates: {} })), ["ALICUOTA_DESCONOCIDA"]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: 100 }), { productRates: { 1: 21 }, lineRates: { 1: 5 } })), ["ALICUOTA_INVALIDA"]);
  });

  test("línea con cantidad o precio inválidos, forma de facturar el envío que no existe", () => {
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100, 0)], { total: 100 }), { productRates: { 1: 21 } })), ["LINEA_INVALIDA"]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, -1)], { total: 100 }), { productRates: { 1: 21 } })), ["LINEA_INVALIDA"]);
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 100)], { total: 100 }), { productRates: { 1: 21 }, shippingMode: "GRATIS" })), ["MODO_ENVIO_INVALIDO"]);
  });

  test("líneas que suman cero con un total que no", () => {
    assert.deepEqual(codes(buildInvoiceAmounts(order([item(1, 0)], { total: 100 }), { productRates: { 1: 21 } })), ["SIN_IMPORTE_EN_LINEAS"]);
  });

  test("informa todos los motivos juntos", () => {
    const r = buildInvoiceAmounts(order([item(1, 100, 1, 1, { currency: "USD" })], { total: 0, status: "CANCELLED" }), { productRates: { 1: 21 } });
    assert.deepEqual(codes(r), ["LINEAS_EN_DOLARES", "PEDIDO_CANCELADO", "TOTAL_CERO"]);
  });
});

describe("factura vigente", () => {
  const F = (id, status, env = "PRODUCCION", cbteTipo = 6) => ({ id, environment: env, cbteTipo, status });
  const NC = (id, associatedInvoiceId, status = "AUTHORIZED", env = "PRODUCCION", cbteTipo = 8) => ({ id, environment: env, cbteTipo, status, associatedInvoiceId });

  test("una autorizada sin anular bloquea; anulada por nota de crédito, no", () => {
    assert.equal(findActiveInvoice([F(1, "AUTHORIZED")], "PRODUCCION").id, 1);
    assert.equal(findActiveInvoice([F(1, "AUTHORIZED"), NC(2, 1)], "PRODUCCION"), null);
  });

  test("pendiente o a confirmar bloquea; rechazada no; nota de crédito sin autorizar no anula", () => {
    assert.equal(findActiveInvoice([F(1, "PENDING")], "PRODUCCION").id, 1);
    assert.equal(findActiveInvoice([F(1, "UNCERTAIN")], "PRODUCCION").id, 1);
    assert.equal(findActiveInvoice([F(1, "REJECTED")], "PRODUCCION"), null);
    assert.equal(findActiveInvoice([F(1, "AUTHORIZED"), NC(2, 1, "PENDING")], "PRODUCCION").id, 1);
  });

  test("una factura de prueba no bloquea las de producción", () => {
    assert.equal(findActiveInvoice([F(1, "AUTHORIZED", "HOMOLOGACION")], "PRODUCCION"), null);
    assert.equal(findActiveInvoice([F(1, "AUTHORIZED", "HOMOLOGACION")], "HOMOLOGACION").id, 1);
  });

  test("buildInvoiceAmounts no deja emitir sobre una vigente", () => {
    const r = buildInvoiceAmounts(order([item(1, 100)], { total: 100 }), { productRates: { 1: 21 }, invoices: [F(7, "AUTHORIZED", "PRODUCCION", 1)], environment: "PRODUCCION" });
    assert.deepEqual(codes(r), ["YA_FACTURADO"]);
    assert.equal(r.errors[0].invoiceId, 7);
  });
});

describe("avisos que el panel hace confirmar", () => {
  test("pedido que no figura como abonado", () => {
    const r = buildInvoiceAmounts(order([item(1, 100)], { total: 100, status: "QUOTE_APPROVED" }), { productRates: { 1: 21 } });
    assert.equal(r.ok, true);
    assert.deepEqual(warningCodes(r), ["NO_ABONADO"]);
    assert.equal(r.warnings[0].requiresConfirmation, true);
  });

  test("envío por correo sin costo cargado", () => {
    const r = buildInvoiceAmounts(order([item(1, 100)], { total: 100, shippingMethod: "CORREO_ARGENTINO" }), { productRates: { 1: 21 } });
    assert.deepEqual(warningCodes(r), ["ENVIO_CORREO_SIN_COSTO"]);
  });

  test("la alícuota del producto cambió después de la venta: el IVA no coincide", () => {
    const items = [item(1, 100000)];
    const t = computeOrderTotals({ items, ivaRates: { 1: 21 } }); // se vendió al 21 %
    const o = order(items, { total: t.totalArs, wantsInvoice: true, ivaAmount: t.ivaAmountArs });
    const hoy = buildInvoiceAmounts(o, { productRates: { 1: 10.5 } }); // hoy el producto figura al 10,5 %
    assert.deepEqual(warningCodes(hoy), ["IVA_DISTINTO"]);
    assert.equal(hoy.ivaControl.ok, false);
    const corregido = buildInvoiceAmounts(o, { productRates: { 1: 10.5 }, lineRates: { 1: 21 } });
    assert.deepEqual(warningCodes(corregido), []);
  });
});

// Generador con semilla: el mismo "azar" en cada corrida (y en Node 22 y 24).
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("2000 pedidos al azar: la factura cierra al centavo con Order.total y respeta los márgenes de ARCA", () => {
  const rnd = mulberry32(20261111);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const r2 = (n) => Math.round(n * 100) / 100;
  let revisados = 0;

  for (let k = 0; k < 2000; k++) {
    const n = 1 + Math.floor(rnd() * 6);
    const items = [];
    const productRates = {};
    const ivaRates = {};
    for (let i = 1; i <= n; i++) {
      const libre = rnd() < 0.15;
      const productId = libre ? null : 100 + i;
      const rate = pick([21, 10.5]);
      if (!libre) { productRates[productId] = rate; ivaRates[productId] = rate; }
      items.push(item(i, rnd() < 0.05 ? 0 : r2(rnd() * pick([500, 50000, 900000])), 1 + Math.floor(rnd() * pick([1, 3, 40])), productId));
    }
    const wantsInvoice = rnd() < 0.5;
    const coupon = pick([null, { discountType: "PERCENTAGE", discountValue: pick([5, 10, 33, 100]) }, { discountType: "FIXED", discountValue: r2(rnd() * 20000) }]);
    const manualDiscount = pick([null, { type: "PERCENTAGE", value: pick([3, 12.5]) }, { type: "FIXED", value: r2(rnd() * 5000) }]);
    const shippingCost = pick([0, 0, r2(rnd() * 15000)]);
    const shippingMode = pick(Object.values(SHIPPING_MODES));
    const t = computeOrderTotals({ items, coupon, ivaRates: wantsInvoice ? ivaRates : null, manualDiscount, shippingCost });
    const o = order(items, { total: t.totalArs, shippingCost, wantsInvoice, ivaAmount: wantsInvoice ? t.ivaAmountArs : 0 });
    const r = buildInvoiceAmounts(o, { productRates, shippingMode });

    if (t.totalArs <= 0) { assert.deepEqual(codes(r), ["TOTAL_CERO"]); continue; }
    if (!r.ok) {
      // Única excepción esperable: todas las líneas a precio 0 y un total que no es solo el envío.
      assert.deepEqual(codes(r), ["SIN_IMPORTE_EN_LINEAS"], JSON.stringify({ k, o }));
      continue;
    }
    revisados++;
    const total = toCents(t.totalArs);
    const all = [...r.lines, ...r.shippingLines];
    const ctx = `pedido ${k}`;

    // 10048: el total cierra exacto, con el de la base.
    assert.equal(r.totals.totalCents, total, ctx);
    assert.equal(r.totals.netoCents + r.totals.ivaCents + r.totals.noGravadoCents, total, ctx);
    assert.equal(all.reduce((a, l) => a + l.grossCents, 0), total, ctx);
    assert.equal(r.lines.reduce((a, l) => a + l.grossCents, 0), total - toCents(shippingCost), ctx);
    assert.equal(centsOf(r.fe.ImpTotal), total, ctx);
    assert.equal(centsOf(r.fe.ImpNeto) + centsOf(r.fe.ImpIVA) + centsOf(r.fe.ImpTotConc), total, ctx);

    // 10061 y 10023: las alícuotas suman exacto el neto y el IVA. 10022: una por alícuota. 10020: base > 0.
    assert.equal(r.fe.Iva.reduce((a, x) => a + centsOf(x.BaseImp), 0), r.totals.netoCents, ctx);
    assert.equal(r.fe.Iva.reduce((a, x) => a + centsOf(x.Importe), 0), r.totals.ivaCents, ctx);
    assert.equal(new Set(r.fe.Iva.map((x) => x.Id)).size, r.fe.Iva.length, ctx);
    for (const x of r.fe.Iva) assert.ok(centsOf(x.BaseImp) > 0, ctx);

    // 10051: cada IVA es su base × alícuota, con un centavo de margen.
    for (const b of r.byRate) {
      const pm = b.pct === 21 ? 210 : 105;
      assert.ok(Math.abs(b.ivaCents * 1000 - b.baseCents * pm) <= 1000, `${ctx}: ${JSON.stringify(b)}`);
    }

    // Los renglones impresos suman lo mismo que lo que va a ARCA, y ninguno queda negativo.
    for (const b of r.byRate) {
      const members = all.filter((l) => l.pct === b.pct);
      assert.equal(members.reduce((a, l) => a + l.netCents, 0), b.baseCents, ctx);
      assert.equal(members.reduce((a, l) => a + l.ivaCents, 0), b.ivaCents, ctx);
    }
    for (const l of all) assert.ok(l.netCents >= 0 && l.ivaCents >= 0 && l.netCents <= l.grossCents, ctx);

    // Mayorista con factura: el IVA y las bases son los del pedido, salvo redondeos.
    if (wantsInvoice) {
      assert.equal(r.ivaControl.ok, true, `${ctx}: ${JSON.stringify(r.ivaControl)}`);
      const baseDelPedido = toCents(t.subtotalArs - t.couponDiscountArs - t.manualDiscountArs);
      const netoProductos = r.lines.reduce((a, l) => a + l.netCents, 0);
      assert.ok(Math.abs(netoProductos - baseDelPedido) <= r.lines.length + 2, `${ctx}: ${netoProductos} vs ${baseDelPedido}`);
    }
  }
  assert.ok(revisados > 1500, `revisados: ${revisados}`);
});
