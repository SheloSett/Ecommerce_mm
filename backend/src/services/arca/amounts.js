// Importes de una factura a partir de un pedido. Todo en CENTAVOS ENTEROS (BigInt para las cuentas
// intermedias): nunca se suma ni se divide con decimales de punto flotante.
//
// REGLAS (decididas en el plan de facturación con el dueño; las marcadas con (*) las confirma el contador):
// - El total de la factura es SIEMPRE lo que pagó el cliente: Order.total. Nunca se factura otro número.
// - Al total se le resta el envío. Lo que queda se reparte entre las líneas en proporción a precio ×
//   cantidad; si el pedido lleva el IVA aparte (mayorista que pidió factura, wantsInvoice), cada línea
//   pesa con su alícuota sumada. Es lo mismo que hace utils/orderTotals.js al armar el total, así el
//   cupón y el descuento manual quedan prorrateados igual, y la suma de las líneas da exacta al centavo.
// - Por cada alícuota (21 o 10,5): base = bruto / (1 + alícuota) e IVA = bruto − base. Una sola regla
//   para mayorista y minorista: el minorista paga precios con IVA adentro; el mayorista con factura paga
//   precio + IVA, y repartir con la alícuota sumada devuelve las mismas bases.
// - El envío va como renglón aparte con 21 % de IVA adentro (*). La configuración fiscal permite
//   prorratearlo entre las alícuotas de los productos o mandarlo como no gravado.
// - Order.ivaAmount NO se manda a ARCA: es una suma de redondeos, con la alícuota que tenía cada producto
//   ese día y sin el envío. Sirve de control: si no coincide con lo calculado, alguien cambió la alícuota
//   de un producto después de la venta, y el panel avisa antes de emitir.
// - Ítems sin producto (los "libres" de la venta manual, o de un producto borrado): 21 % por defecto (*),
//   y el panel deja elegir 21 o 10,5 en cada renglón.
// - No se factura: pedido cancelado o rechazado, con alguna línea en dólares, total en cero, alícuota
//   distinta de 21 o 10,5, o que ya tiene una factura vigente.
//
// LO QUE VALIDA ARCA (manual WSFEv1 v4.7, FECAESolicitar) y cómo se cumple:
// - 10048: ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA → exacto.
// - 10061: suma de BaseImp de AlicIva = ImpNeto → exacto.
// - 10023: suma de Importe de AlicIva = ImpIVA → exacto.
// - 10051: Importe de cada AlicIva = BaseImp × alícuota, con margen de 0,01 % o 0,01 → se elige la base
//   para que el IVA coincida exacto con BaseImp × alícuota redondeado (ARCA redondea "Round Half Even");
//   cuando ningún centavo lo logra la diferencia es de 1 centavo, dentro del margen.
// - 10022: un solo AlicIva por alícuota. 10020: BaseImp mayor a cero. 10056: dos decimales.

const { IVA_RATES, rateFromPct, isInvoiceType, isCreditNoteType } = require("./constants");

const RATE_21 = IVA_RATES.find((r) => r.pct === 21);

const SHIPPING_MODES = Object.freeze({
  GRAVADO_21: "GRAVADO_21",   // renglón aparte con 21 % adentro (por defecto)
  PRORRATEADO: "PRORRATEADO", // se reparte entre las alícuotas de los productos
  NO_GRAVADO: "NO_GRAVADO",   // va en "importe neto no gravado", sin IVA
});

// Importes de ARCA: hasta 13 enteros y 2 decimales.
const MAX_CENTS = 10n ** 15n - 1n;

const ERROR_MESSAGES = Object.freeze({
  PEDIDO_INVALIDO: "No se pudo leer el pedido.",
  PEDIDO_CANCELADO: "El pedido está cancelado.",
  PEDIDO_RECHAZADO: "El pedido está rechazado.",
  YA_FACTURADO: "El pedido ya tiene una factura vigente o una en curso. Para volver a facturarlo, primero hay que anularla con una nota de crédito.",
  SIN_LINEAS: "El pedido no tiene productos.",
  LINEAS_EN_DOLARES: "El pedido tiene productos en dólares: desde el panel solo se factura en pesos.",
  IMPORTES_INVALIDOS: "El total o el envío del pedido no son números válidos.",
  TOTAL_CERO: "El total del pedido es cero.",
  ENVIO_INCONSISTENTE: "El envío es mayor que el total del pedido.",
  IMPORTE_FUERA_DE_RANGO: "El total supera el máximo que acepta ARCA.",
  MODO_ENVIO_INVALIDO: "La forma de facturar el envío no es válida.",
  LINEA_INVALIDA: "Una línea tiene precio o cantidad inválidos.",
  ALICUOTA_INVALIDA: "Una línea tiene una alícuota distinta de 21 % o 10,5 %.",
  ALICUOTA_DESCONOCIDA: "Falta la alícuota de IVA de un producto.",
  SIN_IMPORTE_EN_LINEAS: "Las líneas del pedido suman cero pero el total no.",
  ERROR_INTERNO: "No cierran las cuentas de la factura. No se emitió nada.",
});

// Avisos: no impiden facturar, pero el panel pide confirmarlos antes de emitir.
const WARNING_MESSAGES = Object.freeze({
  NO_ABONADO: "El pedido no figura como abonado.",
  ENVIO_CORREO_SIN_COSTO: "El envío por correo figura en $0. Si todavía no cargaste el costo, cargalo antes de facturar: después no se puede cambiar.",
  IVA_DISTINTO: "El IVA calculado no coincide con el que se le cobró al cliente: puede que la alícuota de un producto haya cambiado después de la venta. Revisá la alícuota de cada línea.",
});

const err = (code, extra = {}) => ({ code, message: ERROR_MESSAGES[code], ...extra });
const warn = (code, extra = {}) => ({ code, message: WARNING_MESSAGES[code], requiresConfirmation: true, ...extra });

// ── Cuentas con enteros ───────────────────────────────────────────────────────

// Pesos (Float del pedido, como los guarda el sistema: ya redondeados a 2 decimales) → centavos.
// null si no es un número.
function toCents(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 100) || 0; // || 0: sin "-0"
}

// Centavos → "1234.56", el formato de los importes en el sobre de ARCA.
function formatCents(cents) {
  const c = BigInt(cents);
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}

// n / d redondeado "mitad al par" (el criterio de ARCA), con enteros. d > 0.
function divRoundHalfEven(n, d) {
  if (n < 0n) return -divRoundHalfEven(-n, d);
  const q = n / d;
  const twice = 2n * (n % d);
  if (twice > d) return q + 1n;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

// Reparte `total` en proporción a `weights` (método del resto mayor): la suma da exacta. Los empates se
// rompen por peso y después por orden, así el resultado es siempre el mismo. null si hay que repartir
// algo entre pesos que suman cero.
function allocate(total, weights) {
  const W = weights.reduce((a, w) => a + w, 0n);
  if (W === 0n) return total === 0n ? weights.map(() => 0n) : null;
  const parts = weights.map((w, i) => ({ i, w, q: (total * w) / W, r: (total * w) % W }));
  let rest = total - parts.reduce((a, p) => a + p.q, 0n);
  const byRemainder = [...parts].sort((a, b) =>
    (b.r > a.r ? 1 : b.r < a.r ? -1 : 0) || (b.w > a.w ? 1 : b.w < a.w ? -1 : 0) || a.i - b.i);
  for (const p of byRemainder) {
    if (rest <= 0n) break;
    if (p.w === 0n) continue;
    p.q += 1n;
    rest -= 1n;
  }
  return parts.map((p) => p.q);
}

// Bruto (IVA incluido) → { base, iva } para una alícuota en milésimos. Se busca, alrededor de
// bruto / (1 + alícuota), la base cuyo IVA redondeado completa exacto el bruto; si no hay ninguna
// (pasa con algunos brutos, porque base + IVA salta de a 2 centavos), queda la más cercana y el IVA
// difiere de base × alícuota en menos de un centavo.
function splitGross(gross, perMille) {
  const g = BigInt(gross);
  const pm = BigInt(perMille);
  const b0 = divRoundHalfEven(g * 1000n, 1000n + pm);
  for (const b of [b0, b0 - 1n, b0 + 1n]) {
    if (b < 0n || b > g) continue;
    if (g - b === divRoundHalfEven(b * pm, 1000n)) return { base: b, iva: g - b };
  }
  return { base: b0, iva: g - b0 };
}

// ── Factura vigente ───────────────────────────────────────────────────────────

/**
 * La factura que impide volver a facturar el pedido, o null. Cuenta como vigente una factura autorizada
 * que no fue anulada por una nota de crédito autorizada, y también una pendiente o "a confirmar" (todavía
 * no se sabe si ARCA la aprobó). Solo mira el ambiente pedido: una factura de prueba no bloquea las de
 * producción.
 * @param {Array} invoices - [{ id, environment, cbteTipo, status, associatedInvoiceId }]
 */
function findActiveInvoice(invoices, environment) {
  const list = (Array.isArray(invoices) ? invoices : [])
    .filter((i) => i && typeof i === "object" && (!environment || i.environment === environment));
  const credited = new Set(list
    .filter((i) => isCreditNoteType(i.cbteTipo) && i.status === "AUTHORIZED" && i.associatedInvoiceId != null)
    .map((i) => i.associatedInvoiceId));
  return list.find((i) => isInvoiceType(i.cbteTipo) && (
    i.status === "PENDING" || i.status === "UNCERTAIN" || (i.status === "AUTHORIZED" && !credited.has(i.id))
  )) || null;
}

// ── Importes de la factura ────────────────────────────────────────────────────

const lookup = (m, k) => (m instanceof Map ? m.get(k) : m ? m[k] : undefined);

/**
 * Arma los importes de la factura de un pedido.
 *
 * @param {Object} order - el pedido como lo guarda el sistema: { status, total, totalUsd, shippingCost,
 *   shippingMethod, wantsInvoice, ivaAmount, items: [{ id, productId, price, quantity, currency }] }
 * @param {Object} options
 *   - productRates: { [productId]: 21 | 10.5 } (o Map) — Product.ivaRate de cada producto del pedido.
 *   - lineRates:    { [orderItemId]: 21 | 10.5 } (o Map) — lo que eligió el admin en la ventana; pisa al
 *                   del producto.
 *   - shippingMode: SHIPPING_MODES (por defecto GRAVADO_21).
 *   - invoices, environment: las facturas del pedido, para no emitir otra si hay una vigente.
 * @returns {{ ok: true, totals, byRate, lines, shippingLines, fe, ivaControl, warnings }
 *         | { ok: false, errors, warnings }}
 *   fe: lo que va en FECAESolicitar (ImpTotal, ImpTotConc, ImpNeto, ImpOpEx, ImpTrib, ImpIVA e Iva[]),
 *   con los importes ya escritos como texto con 2 decimales.
 */
function buildInvoiceAmounts(order, options = {}) {
  if (!order || typeof order !== "object") return { ok: false, errors: [err("PEDIDO_INVALIDO")], warnings: [] };
  const errors = [];
  const warnings = [];

  // Estado del pedido.
  if (order.status === "CANCELLED") errors.push(err("PEDIDO_CANCELADO"));
  else if (order.status === "REJECTED") errors.push(err("PEDIDO_RECHAZADO"));
  else if (order.status !== "APPROVED") warnings.push(warn("NO_ABONADO"));

  const active = findActiveInvoice(options.invoices, options.environment);
  if (active) errors.push(err("YA_FACTURADO", { invoiceId: active.id ?? null, invoiceStatus: active.status }));

  // Monedas, total y envío.
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) errors.push(err("SIN_LINEAS"));
  const usdItems = items.filter((i) => i && i.currency === "USD");
  if (usdItems.length || (Number(order.totalUsd) || 0) > 0) {
    errors.push(err("LINEAS_EN_DOLARES", { orderItemIds: usdItems.map((i) => i.id ?? null) }));
  }

  const totalCents = toCents(order.total);
  const shippingCents = order.shippingCost == null ? 0 : toCents(order.shippingCost);
  if (totalCents === null || shippingCents === null) {
    errors.push(err("IMPORTES_INVALIDOS"));
  } else {
    if (totalCents <= 0) errors.push(err("TOTAL_CERO"));
    else if (BigInt(totalCents) > MAX_CENTS) errors.push(err("IMPORTE_FUERA_DE_RANGO"));
    if (shippingCents < 0 || (totalCents > 0 && shippingCents > totalCents)) errors.push(err("ENVIO_INCONSISTENTE"));
    if (order.shippingMethod === "CORREO_ARGENTINO" && shippingCents === 0) warnings.push(warn("ENVIO_CORREO_SIN_COSTO"));
  }

  const shippingMode = options.shippingMode ?? SHIPPING_MODES.GRAVADO_21;
  if (!Object.values(SHIPPING_MODES).includes(shippingMode)) errors.push(err("MODO_ENVIO_INVALIDO"));

  // Alícuota de cada línea: la que eligió el admin, la del producto, o 21 % si no hay producto.
  const lines = [];
  for (const item of items) {
    if (!item || typeof item !== "object") { errors.push(err("LINEA_INVALIDA", { orderItemId: null })); continue; }
    const orderItemId = item.id ?? null;
    const priceCents = toCents(item.price);
    if (priceCents === null || priceCents < 0 || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      errors.push(err("LINEA_INVALIDA", { orderItemId }));
      continue;
    }
    let rate = null;
    let rateSource;
    const override = lookup(options.lineRates, orderItemId);
    if (override !== undefined && override !== null) {
      rateSource = "PANEL";
      rate = rateFromPct(override);
      if (!rate) errors.push(err("ALICUOTA_INVALIDA", { orderItemId, value: override }));
    } else if (item.productId == null) {
      rateSource = "POR_DEFECTO";
      rate = RATE_21;
    } else {
      rateSource = "PRODUCTO";
      const pct = lookup(options.productRates, item.productId);
      if (pct === undefined || pct === null) errors.push(err("ALICUOTA_DESCONOCIDA", { orderItemId, productId: item.productId }));
      else {
        rate = rateFromPct(pct);
        if (!rate) errors.push(err("ALICUOTA_INVALIDA", { orderItemId, productId: item.productId, value: pct }));
      }
    }
    lines.push({ orderItemId, productId: item.productId ?? null, quantity: item.quantity, priceCents, rate, rateSource });
  }

  if (errors.length) return { ok: false, errors, warnings };

  // ── Reparto del total ──
  const T = BigInt(totalCents);
  const S = BigInt(shippingCents);
  const P = T - S; // lo que pagó por los productos, ya neto de cupón y descuento, con IVA

  const withIva = order.wantsInvoice === true;
  const weights = lines.map((l) => BigInt(l.priceCents) * BigInt(l.quantity) * (withIva ? 1000n + BigInt(l.rate.perMille) : 1000n));
  const gross = allocate(P, weights);
  if (!gross) return { ok: false, errors: [err("SIN_IMPORTE_EN_LINEAS")], warnings };
  lines.forEach((l, i) => { l.gross = gross[i]; });

  // Envío: uno o más renglones según cómo se factura.
  const shippingLines = [];
  if (S > 0n) {
    if (shippingMode === SHIPPING_MODES.NO_GRAVADO) {
      shippingLines.push({ rate: null, gross: S });
    } else if (shippingMode === SHIPPING_MODES.PRORRATEADO && P > 0n) {
      const productsByRate = IVA_RATES.map((r) => lines.filter((l) => l.rate.id === r.id).reduce((a, l) => a + l.gross, 0n));
      const parts = allocate(S, productsByRate);
      IVA_RATES.forEach((r, k) => { if (parts[k] > 0n) shippingLines.push({ rate: r, gross: parts[k] }); });
    } else {
      // Gravado al 21 %, o prorrateado sin productos con importe (no hay entre qué repartir).
      shippingLines.push({ rate: RATE_21, gross: S });
    }
  }

  // Base e IVA por alícuota, y el reparto de cada base entre sus renglones (para imprimirlos).
  const byRate = [];
  for (const r of IVA_RATES) {
    const members = [...lines, ...shippingLines].filter((m) => m.rate && m.rate.id === r.id);
    if (!members.length) continue;
    const G = members.reduce((a, m) => a + m.gross, 0n);
    if (G === 0n) {
      members.forEach((m) => { m.net = 0n; m.iva = 0n; });
      continue;
    }
    const { base, iva } = splitGross(G, r.perMille);
    const nets = allocate(base, members.map((m) => m.gross));
    members.forEach((m, k) => { m.net = nets[k]; m.iva = m.gross - nets[k]; });
    byRate.push({ rate: r, gross: G, base, iva });
  }
  shippingLines.filter((m) => !m.rate).forEach((m) => { m.net = m.gross; m.iva = 0n; });

  const neto = byRate.reduce((a, b) => a + b.base, 0n);
  const ivaTotal = byRate.reduce((a, b) => a + b.iva, 0n);
  const noGravado = shippingLines.filter((m) => !m.rate).reduce((a, m) => a + m.gross, 0n);
  // Control final: si esto no cierra hay un error en esta función, y no se emite nada.
  if (neto + ivaTotal + noGravado !== T) return { ok: false, errors: [err("ERROR_INTERNO")], warnings };

  // Control contra el IVA que se le cobró al mayorista.
  let ivaControl = { applies: false };
  if (withIva) {
    const storedCents = toCents(order.ivaAmount) ?? 0;
    const computedCents = Number(lines.reduce((a, l) => a + l.iva, 0n));
    const diffCents = computedCents - storedCents;
    // Cada línea redondeó su IVA por separado al venderse, y acá cada alícuota redondea otra vez.
    const toleranceCents = lines.length + byRate.length + 1;
    ivaControl = { applies: true, storedCents, computedCents, diffCents, toleranceCents, ok: Math.abs(diffCents) <= toleranceCents };
    if (!ivaControl.ok) warnings.push(warn("IVA_DISTINTO", { storedCents, computedCents }));
  }

  const n = (v) => Number(v);
  const outLine = (l) => ({
    orderItemId: l.orderItemId,
    productId: l.productId,
    quantity: l.quantity,
    pct: l.rate.pct,
    ivaId: l.rate.id,
    rateSource: l.rateSource,
    grossCents: n(l.gross),
    netCents: n(l.net),
    ivaCents: n(l.iva),
    // Precio unitario redondeado, solo para mostrar: el que vale es el del renglón.
    unitGrossCents: n(divRoundHalfEven(l.gross, BigInt(l.quantity))),
    unitNetCents: n(divRoundHalfEven(l.net, BigInt(l.quantity))),
  });

  return {
    ok: true,
    totals: {
      totalCents: n(T),
      productsCents: n(P),
      shippingCents: n(S),
      netoCents: n(neto),
      ivaCents: n(ivaTotal),
      noGravadoCents: n(noGravado),
      exentoCents: 0,
      tributosCents: 0,
    },
    byRate: byRate.map((b) => ({ ivaId: b.rate.id, pct: b.rate.pct, grossCents: n(b.gross), baseCents: n(b.base), ivaCents: n(b.iva) })),
    lines: lines.map(outLine),
    shippingLines: shippingLines.map((m) => ({
      pct: m.rate ? m.rate.pct : null,
      ivaId: m.rate ? m.rate.id : null,
      grossCents: n(m.gross),
      netCents: n(m.net),
      ivaCents: n(m.iva),
    })),
    fe: {
      ImpTotal: formatCents(T),
      ImpTotConc: formatCents(noGravado),
      ImpNeto: formatCents(neto),
      ImpOpEx: formatCents(0n),
      ImpTrib: formatCents(0n),
      ImpIVA: formatCents(ivaTotal),
      Iva: byRate.map((b) => ({ Id: b.rate.id, BaseImp: formatCents(b.base), Importe: formatCents(b.iva) })),
    },
    ivaControl,
    warnings,
  };
}

module.exports = {
  buildInvoiceAmounts,
  findActiveInvoice,
  SHIPPING_MODES,
  ERROR_MESSAGES,
  WARNING_MESSAGES,
  toCents,
  formatCents,
  divRoundHalfEven,
  allocate,
  splitGross,
};
