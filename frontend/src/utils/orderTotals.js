// Montos de un pedido separados por moneda, listos para mostrar.
//
// El backend ahora guarda los pesos y los dólares en campos distintos (ver utils/orderTotals.js del
// backend y el modelo Order): `total` / `couponDiscount` / `ivaAmount` son la parte EN PESOS, y
// `totalUsd` / `couponDiscountUsd` / `ivaAmountUsd` la parte en dólares.
//
// Esta función existe para que las cinco pantallas que muestran totales (checkout, detalle del
// cliente, historial, detalle del admin y listado de pedidos) usen exactamente el mismo criterio,
// incluida la compatibilidad con los pedidos viejos.
//
// TRES CASOS:
//  1. Pedido 100% en pesos → se usa Order.total tal cual, como siempre.
//  2. Pedido con dólares guardado DESPUÉS del cambio (totalUsd != null) → cada moneda sale de su
//     campo, ya neta de cupón y con IVA.
//  3. Pedido con dólares guardado ANTES del cambio (totalUsd == null) → Order.total es una suma que
//     mezcla las dos monedas y no sirve para ninguna. Se reconstruye desde las líneas, que es
//     exactamente lo que hacía el panel hasta ahora. No se toca ningún dato histórico.

import { formatPrice as formatPriceCurrency } from "./formatPrice";

const isUsdItem = (i) => (i?.currency || "ARS") === "USD";

function sumLines(items, currency) {
  return (items || [])
    .filter((i) => (isUsdItem(i) ? "USD" : "ARS") === currency)
    .reduce((s, i) => s + i.price * i.quantity, 0);
}

export function getOrderTotals(order) {
  const items = order?.items || [];
  const hasUsd = items.some(isUsdItem);

  // ── Caso 1: sin dólares ────────────────────────────────────────────────────
  if (!hasUsd) {
    const discount = order?.couponDiscount || 0;
    const iva      = order?.ivaAmount || 0;
    const total    = order?.total || 0;
    return {
      hasUsd:  false,
      legacy:  false,
      ars: { subtotal: total + discount - iva, discount, iva, total },
      usd: { subtotal: 0, discount: 0, iva: 0, total: 0 },
    };
  }

  // ── Caso 3: pedido mixto viejo ─────────────────────────────────────────────
  // No hay forma de saber qué parte del cupón/IVA corresponde a cada moneda (se calcularon sobre un
  // total mezclado), así que se muestran los subtotales de las líneas y se avisa con `legacy: true`
  // para que la pantalla pueda aclararlo en vez de mostrar un número que no cierra.
  if (order?.totalUsd == null) {
    const subtotalArs = sumLines(items, "ARS");
    const subtotalUsd = sumLines(items, "USD");
    return {
      hasUsd: true,
      legacy: true,
      ars: { subtotal: subtotalArs, discount: 0, iva: 0, total: subtotalArs },
      usd: { subtotal: subtotalUsd, discount: 0, iva: 0, total: subtotalUsd },
    };
  }

  // ── Caso 2: pedido mixto nuevo ─────────────────────────────────────────────
  const dArs = order.couponDiscount || 0;
  const iArs = order.ivaAmount || 0;
  const dUsd = order.couponDiscountUsd || 0;
  const iUsd = order.ivaAmountUsd || 0;
  return {
    hasUsd: true,
    legacy: false,
    ars: { subtotal: (order.total || 0) + dArs - iArs, discount: dArs, iva: iArs, total: order.total || 0 },
    usd: { subtotal: (order.totalUsd || 0) + dUsd - iUsd, discount: dUsd, iva: iUsd, total: order.totalUsd || 0 },
  };
}

// Desglose listo para imprimir (Excel, PDF, impresión): un bloque por moneda, cada uno con
// subtotal, descuento, IVA y total.
//
// Existe porque las exportaciones mostraban SOLO los totales finales cuando el pedido tenía
// dólares: el cliente veía "TOTAL ARS $59.895" sin ver que se le había descontado el cupón ni
// cuánto IVA se le sumó. Con un solo total y sin desglose, el número no se puede verificar.
//
// `ivaRate` es la alícuota EFECTIVA (IVA sobre la base ya descontada), calculada en vez de
// hardcodear 21%: cada producto puede tener la suya (21% o 10,5%), así que en un pedido con
// productos de distinta alícuota el porcentaje real queda en el medio. Devuelve null si no hay IVA.
export function getTotalsBreakdown(order) {
  const T = getOrderTotals(order);

  const armarBloque = (m, currency) => {
    const base = m.subtotal - m.discount;          // base imponible: lo que queda tras el cupón
    const ivaRate = m.iva > 0 && base > 0
      ? Math.round((m.iva / base) * 1000) / 10     // un decimal: 21 / 10.5
      : null;
    return { currency, ...m, ivaRate };
  };

  const blocks = [];
  // El bloque en pesos se omite solo si el pedido es 100% en dólares.
  if (!T.hasUsd || T.ars.subtotal > 0) blocks.push(armarBloque(T.ars, "ARS"));
  if (T.hasUsd) blocks.push(armarBloque(T.usd, "USD"));

  return { hasUsd: T.hasUsd, legacy: T.legacy, blocks };
}

// ── Renderizado del desglose para exportaciones ──────────────────────────────
// Los cuatro exports (Excel y PDF, desde el detalle y desde el historial) mostraban solo el TOTAL
// final cuando el pedido tenía dólares, sin el subtotal, el descuento ni el IVA. Un total suelto
// no se puede verificar: el cliente ve "$59.895" y no sabe de dónde sale.
// Estas dos funciones arman el desglose una sola vez para que los cuatro coincidan.

// Etiqueta de cada fila. El sufijo de moneda solo aparece si el pedido mezcla monedas.
function etiquetas(bloque, hasUsd, couponCode) {
  const suf = hasUsd ? ` ${bloque.currency}` : "";
  return {
    subtotal: `Subtotal${suf}`,
    descuento: `Descuento${suf}${couponCode ? ` (${couponCode})` : ""}`,
    iva: `IVA${suf}${bloque.ivaRate ? ` (${bloque.ivaRate}%)` : ""}`,
    total: hasUsd ? `TOTAL ${bloque.currency}` : "TOTAL",
  };
}

const fmt = (monto, currency) => formatPriceCurrency(monto, currency);

// Filas para el Excel: array de arrays, con las 3 primeras columnas vacías (igual que el resto).
export function breakdownRowsAoa(order, couponCode) {
  const { hasUsd, blocks } = getTotalsBreakdown(order);
  const filas = [];
  blocks.forEach((b, i) => {
    if (i > 0) filas.push([]); // renglón en blanco entre monedas
    const L = etiquetas(b, hasUsd, couponCode);
    filas.push(["", "", "", L.subtotal, fmt(b.subtotal, b.currency)]);
    if (b.discount > 0) filas.push(["", "", "", L.descuento, `−${fmt(b.discount, b.currency)}`]);
    if (b.iva > 0)      filas.push(["", "", "", L.iva, `+${fmt(b.iva, b.currency)}`]);
    filas.push(["", "", "", L.total, fmt(b.total, b.currency)]);
  });
  return filas;
}

// Filas <tr> para los PDF/impresiones. Mismos estilos que ya usaban las plantillas.
export function breakdownRowsHtml(order, couponCode) {
  const { hasUsd, blocks } = getTotalsBreakdown(order);
  const chica = (label, valor, color) =>
    `<tr><td style="padding:4px 8px;font-size:12px;color:${color}">${label}</td>` +
    `<td style="padding:4px 8px;text-align:right;font-size:12px;color:${color}">${valor}</td></tr>`;
  const grande = (label, valor) =>
    `<tr style="border-top:2px solid #1e293b"><td style="padding:8px 8px 0;font-size:15px;font-weight:900;color:#1e293b">${label}</td>` +
    `<td style="padding:8px 8px 0;text-align:right;font-size:15px;font-weight:900;color:#1e293b">${valor}</td></tr>`;

  return blocks.map((b) => {
    const L = etiquetas(b, hasUsd, couponCode);
    return [
      chica(L.subtotal, fmt(b.subtotal, b.currency), "#64748b"),
      b.discount > 0 ? chica(L.descuento, `−${fmt(b.discount, b.currency)}`, "#16a34a") : "",
      b.iva > 0      ? chica(L.iva, `+${fmt(b.iva, b.currency)}`, "#64748b") : "",
      grande(L.total, fmt(b.total, b.currency)),
    ].join("");
  }).join("");
}

// Ganancia de una venta, SIN el IVA.
// El IVA se le cobra al cliente para girárselo a ARCA: entra y sale, nunca fue plata de la tienda.
// Por eso la ganancia se mide contra el total SIN IVA (pero sí neto del cupón, que es plata que
// realmente no entró a la caja).
export function profitFromTotals(monedaTotals, costo) {
  const ventaSinIva = (monedaTotals?.total || 0) - (monedaTotals?.iva || 0);
  return ventaSinIva - (costo || 0);
}
