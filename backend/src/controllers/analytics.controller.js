// ─── Analíticas del admin ─────────────────────────────────────────────────────
// Sección "Analíticas" del panel: seis endpoints, uno por pestaña. Todos son de solo lectura y
// trabajan sobre lo que ya está en la base (órdenes, ítems, clientes, carritos, cupones, ofertas,
// devoluciones, productos y variantes). No se registra nada nuevo.
//
// Criterios compartidos con Dashboard / Métricas (getStats de order.controller):
//   - Venta = orden con status APPROVED.
//   - Pesos y dólares NUNCA se mezclan. La facturación en pesos de una orden es Order.total (que ya
//     trae cupón e IVA) salvo en los pedidos mixtos viejos (totalUsd null), donde se reconstruye
//     sumando las líneas en pesos. Los dólares se suman siempre a nivel de línea.
//   - Ganancia = facturación − IVA facturado − costo. El costo de cada línea es el snapshot guardado
//     en la orden (item.cost) y, si es null, el costo maestro del producto solo si está en la misma
//     moneda que la línea.
//   - Fechas: la tienda es de Argentina (UTC−3, sin horario de verano). Los cortes por día / semana /
//     mes y el día de la semana / hora se calculan con ese huso, no con el del servidor.
const { PrismaClient } = require("@prisma/client");
const { livePresence } = require("./events.controller");

const prisma = new PrismaClient();

const AR_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((n || 0) * 100) / 100;

// ─── Fechas ──────────────────────────────────────────────────────────────────

// Convierte un instante a "hora argentina" expresada en campos UTC de un Date auxiliar:
// después se leen con getUTC*() y se obtiene el día / hora local de la tienda.
function toAr(date) {
  return new Date(date.getTime() + AR_OFFSET_MS);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// Clave de agrupación según la granularidad. Semana = lunes de esa semana.
function bucketKey(date, granularity) {
  const d = toAr(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (granularity === "month") return `${y}-${pad(m)}`;
  if (granularity === "week") {
    const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
    const monday = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate() - dow));
    return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
  }
  return `${y}-${pad(m)}-${pad(d.getUTCDate())}`;
}

// Lista de claves consecutivas entre dos fechas, para que la serie no tenga huecos.
function bucketRange(from, to, granularity) {
  const keys = [];
  const seen = new Set();
  // Se recorre día a día y se deduplica: simple y a prueba de meses de distinta longitud.
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const k = bucketKey(new Date(t), granularity);
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  const last = bucketKey(to, granularity);
  if (!seen.has(last)) keys.push(last);
  return keys;
}

// Rango pedido por query (?dateFrom&dateTo, YYYY-MM-DD) interpretado en hora argentina.
// Sin parámetros: últimos 30 días. Devuelve también el período anterior de la misma longitud,
// para las comparaciones "vs período anterior".
function parseRange(query) {
  const today = toAr(new Date());
  const defaultTo = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`;
  const toStr = /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo || "") ? query.dateTo : defaultTo;
  let fromStr = /^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom || "") ? query.dateFrom : null;

  // Inicio del día en Argentina = 03:00 UTC; fin del día = 02:59:59.999 UTC del día siguiente.
  const startOf = (s) => new Date(new Date(`${s}T00:00:00.000Z`).getTime() - AR_OFFSET_MS);
  const endOf = (s) => new Date(startOf(s).getTime() + DAY_MS - 1);

  let to = endOf(toStr);
  let from = fromStr ? startOf(fromStr) : new Date(startOf(toStr).getTime() - 29 * DAY_MS);
  if (from > to) from = new Date(to.getTime() - 29 * DAY_MS);

  const length = to.getTime() - from.getTime() + 1;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - length + 1);

  const days = Math.round(length / DAY_MS);
  let granularity = ["day", "week", "month"].includes(query.granularity) ? query.granularity : null;
  if (!granularity) granularity = days <= 45 ? "day" : days <= 200 ? "week" : "month";

  return { from, to, prevFrom, prevTo, days, granularity };
}

// ─── Finanzas por orden ───────────────────────────────────────────────────────

const ORDER_ITEM_SELECT = {
  id: true, productId: true, quantity: true, price: true, cost: true, currency: true,
  product: { select: { id: true, name: true, images: true, cost: true, currency: true } },
};

function unitCostArs(item) {
  if (item.cost !== null && item.cost !== undefined) return item.cost;
  const p = item.product;
  if (!p) return 0;
  if ((p.currency || "ARS") !== "ARS") return 0;
  return p.cost ?? 0;
}

// Facturación, IVA, costo y ganancia en pesos + facturación en dólares de UNA orden aprobada.
function orderFinancials(order) {
  const items = order.items || [];
  const hasUsd = items.some((i) => i.currency === "USD");
  let revenueArs;
  let ivaArs;
  if (!hasUsd || order.totalUsd !== null) {
    revenueArs = order.total || 0;
    ivaArs = order.ivaAmount || 0;
  } else {
    // Pedido mixto viejo: Order.total mezclaba monedas → se reconstruye desde las líneas en pesos.
    revenueArs = items.filter((i) => i.currency !== "USD").reduce((s, i) => s + i.price * i.quantity, 0);
    ivaArs = 0;
  }
  const costArs = items
    .filter((i) => i.currency !== "USD")
    .reduce((s, i) => s + i.quantity * unitCostArs(i), 0);
  const revenueUsd = items.filter((i) => i.currency === "USD").reduce((s, i) => s + i.price * i.quantity, 0);
  return {
    revenueArs,
    ivaArs,
    costArs,
    profitArs: revenueArs - ivaArs - costArs,
    revenueUsd,
    hasUsd,
  };
}

function approvedOrdersIn(from, to, extraInclude = {}) {
  return prisma.order.findMany({
    where: { status: "APPROVED", createdAt: { gte: from, lte: to } },
    select: {
      id: true, customerId: true, customerName: true, customerEmail: true, customerType: true,
      salesChannel: true, paymentMethod: true, shippingMethod: true, shippingCost: true,
      total: true, totalUsd: true, ivaAmount: true, couponId: true, couponDiscount: true,
      fulfillmentStatus: true, createdAt: true, updatedAt: true,
      items: { select: { ...ORDER_ITEM_SELECT, ...extraInclude } },
    },
  });
}

function summarize(orders) {
  const acc = { ordenes: 0, ventasArs: 0, ivaArs: 0, costoArs: 0, gananciaArs: 0, ventasUsd: 0, ordenesUsd: 0, unidades: 0 };
  for (const o of orders) {
    const f = orderFinancials(o);
    acc.ordenes += 1;
    acc.ventasArs += f.revenueArs;
    acc.ivaArs += f.ivaArs;
    acc.costoArs += f.costArs;
    acc.gananciaArs += f.profitArs;
    acc.ventasUsd += f.revenueUsd;
    if (f.hasUsd) acc.ordenesUsd += 1;
    acc.unidades += (o.items || []).reduce((s, i) => s + i.quantity, 0);
  }
  const ordenesArs = orders.filter((o) => orderFinancials(o).revenueArs > 0).length;
  acc.ticketArs = ordenesArs > 0 ? acc.ventasArs / ordenesArs : 0;
  for (const k of Object.keys(acc)) acc[k] = round2(acc[k]);
  return acc;
}

// ─── 1. Ventas en el tiempo ───────────────────────────────────────────────────
// GET /api/analytics/ventas?dateFrom&dateTo&granularity=day|week|month
async function getVentas(req, res) {
  try {
    const { from, to, prevFrom, prevTo, days, granularity } = parseRange(req.query);

    const [orders, prevOrders, gastos] = await Promise.all([
      approvedOrdersIn(from, to),
      approvedOrdersIn(prevFrom, prevTo),
      prisma.gasto.findMany({
        where: { date: { gte: from, lte: to }, currency: "ARS" },
        select: { amount: true, type: true, date: true },
      }),
    ]);

    const current = summarize(orders);
    const previous = summarize(prevOrders);
    current.gastosArs = round2(gastos.reduce((s, g) => s + g.amount, 0));

    // Serie temporal sin huecos
    const keys = bucketRange(from, to, granularity);
    const byKey = Object.fromEntries(keys.map((k) => [k, { bucket: k, ordenes: 0, ventasArs: 0, gananciaArs: 0, ventasUsd: 0, gastosArs: 0 }]));
    for (const o of orders) {
      const k = bucketKey(o.createdAt, granularity);
      const b = byKey[k];
      if (!b) continue;
      const f = orderFinancials(o);
      b.ordenes += 1;
      b.ventasArs += f.revenueArs;
      b.gananciaArs += f.profitArs;
      b.ventasUsd += f.revenueUsd;
    }
    for (const g of gastos) {
      const b = byKey[bucketKey(g.date, granularity)];
      if (b) b.gastosArs += g.amount;
    }
    const series = keys.map((k) => {
      const b = byKey[k];
      return { ...b, ventasArs: round2(b.ventasArs), gananciaArs: round2(b.gananciaArs), ventasUsd: round2(b.ventasUsd), gastosArs: round2(b.gastosArs) };
    });

    // Día de la semana (0 = lunes) y hora del día, en hora argentina
    const byWeekday = Array.from({ length: 7 }, (_, i) => ({ dow: i, ordenes: 0, ventasArs: 0 }));
    const byHour = Array.from({ length: 24 }, (_, i) => ({ hour: i, ordenes: 0, ventasArs: 0 }));
    for (const o of orders) {
      const d = toAr(o.createdAt);
      const f = orderFinancials(o);
      const dow = (d.getUTCDay() + 6) % 7;
      byWeekday[dow].ordenes += 1;
      byWeekday[dow].ventasArs += f.revenueArs;
      byHour[d.getUTCHours()].ordenes += 1;
      byHour[d.getUTCHours()].ventasArs += f.revenueArs;
    }
    byWeekday.forEach((w) => { w.ventasArs = round2(w.ventasArs); });
    byHour.forEach((h) => { h.ventasArs = round2(h.ventasArs); });

    res.json({
      range: { from, to, prevFrom, prevTo, days, granularity },
      current,
      previous,
      series,
      byWeekday,
      byHour,
    });
  } catch (err) {
    console.error("analytics.getVentas error:", err);
    res.status(500).json({ error: "Error al obtener analíticas de ventas" });
  }
}

// ─── 2. Origen de la venta ────────────────────────────────────────────────────
// GET /api/analytics/origen?dateFrom&dateTo
async function getOrigen(req, res) {
  try {
    const { from, to } = parseRange(req.query);
    const orders = await approvedOrdersIn(from, to, {
      product: {
        select: {
          id: true, name: true, cost: true, currency: true,
          supplier: { select: { id: true, name: true } },
          categories: { select: { id: true, name: true, parent: { select: { name: true } } } },
        },
      },
    });

    // Agrupaciones a nivel ORDEN (usan la facturación real: cupón e IVA incluidos)
    const groupOrders = (keyFn, labelFn = (k) => k) => {
      const map = {};
      for (const o of orders) {
        const key = keyFn(o) || "—";
        if (!map[key]) map[key] = { key, label: labelFn(key), ordenes: 0, ventasArs: 0, gananciaArs: 0, ventasUsd: 0, envioArs: 0 };
        const f = orderFinancials(o);
        map[key].ordenes += 1;
        map[key].ventasArs += f.revenueArs;
        map[key].gananciaArs += f.profitArs;
        map[key].ventasUsd += f.revenueUsd;
        map[key].envioArs += o.shippingCost || 0;
      }
      return Object.values(map)
        .map((g) => ({ ...g, ventasArs: round2(g.ventasArs), gananciaArs: round2(g.gananciaArs), ventasUsd: round2(g.ventasUsd), envioArs: round2(g.envioArs) }))
        .sort((a, b) => b.ventasArs - a.ventasArs || b.ordenes - a.ordenes);
    };

    const LABELS = {
      MINORISTA: "Minorista", MAYORISTA: "Mayorista",
      WEB: "Tienda online", MOSTRADOR: "Venta manual / mostrador",
      MERCADOPAGO: "Mercado Pago", EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia",
      COTIZACION: "Cotización", A_CONVENIR: "A convenir",
      RETIRO: "Retiro en el local", ENVIO: "Envío", CORREO_ARGENTINO: "Correo Argentino",
    };
    const label = (k) => LABELS[k] || k;

    // Agrupaciones a nivel LÍNEA (categoría y proveedor): facturación = precio × cantidad de las
    // líneas en pesos, sin prorratear cupón ni IVA (que son de la orden, no del producto).
    const groupItems = (keyFn) => {
      const map = {};
      for (const o of orders) {
        const seenOrder = new Set();
        for (const it of o.items) {
          const { key, label: lbl } = keyFn(it);
          if (!map[key]) map[key] = { key, label: lbl, ordenes: 0, unidades: 0, ventasArs: 0, costoArs: 0, gananciaArs: 0, ventasUsd: 0 };
          const g = map[key];
          if (!seenOrder.has(key)) { g.ordenes += 1; seenOrder.add(key); }
          g.unidades += it.quantity;
          if (it.currency === "USD") {
            g.ventasUsd += it.price * it.quantity;
          } else {
            const rev = it.price * it.quantity;
            const cost = it.quantity * unitCostArs(it);
            g.ventasArs += rev;
            g.costoArs += cost;
            g.gananciaArs += rev - cost;
          }
        }
      }
      return Object.values(map)
        .map((g) => ({
          ...g,
          ventasArs: round2(g.ventasArs), costoArs: round2(g.costoArs), gananciaArs: round2(g.gananciaArs), ventasUsd: round2(g.ventasUsd),
          margen: g.ventasArs > 0 ? round2((g.gananciaArs / g.ventasArs) * 100) : null,
        }))
        .sort((a, b) => b.ventasArs - a.ventasArs || b.unidades - a.unidades);
    };

    const totals = summarize(orders);
    const envioTotal = round2(orders.reduce((s, o) => s + (o.shippingCost || 0), 0));

    res.json({
      range: { from, to },
      totals,
      byCustomerType: groupOrders((o) => o.customerType, label),
      byChannel: groupOrders((o) => o.salesChannel, label),
      byPaymentMethod: groupOrders((o) => o.paymentMethod, label),
      byShipping: groupOrders((o) => o.shippingMethod, label),
      envio: { total: envioTotal, share: totals.ventasArs > 0 ? round2((envioTotal / totals.ventasArs) * 100) : 0 },
      byCategory: groupItems((it) => {
        const cat = it.product?.categories?.[0];
        if (!cat) return { key: "sin-categoria", label: it.product ? "Sin categoría" : "Producto eliminado" };
        return { key: `cat-${cat.id}`, label: cat.parent ? `${cat.parent.name} › ${cat.name}` : cat.name };
      }),
      bySupplier: groupItems((it) => {
        const sup = it.product?.supplier;
        if (!sup) return { key: "sin-proveedor", label: it.product ? "Sin proveedor asignado" : "Producto eliminado" };
        return { key: `sup-${sup.id}`, label: sup.name };
      }),
    });
  } catch (err) {
    console.error("analytics.getOrigen error:", err);
    res.status(500).json({ error: "Error al obtener analíticas de origen" });
  }
}

// ─── 3. Embudo y fricción ─────────────────────────────────────────────────────
// GET /api/analytics/embudo?dateFrom&dateTo
async function getEmbudo(req, res) {
  try {
    const { from, to } = parseRange(req.query);
    const now = new Date();
    const abandonedBefore = new Date(now.getTime() - DAY_MS);

    const [quotes, approved, carts, couponOrders, returns, activeCoupons] = await Promise.all([
      prisma.order.findMany({
        where: { paymentMethod: "COTIZACION", createdAt: { gte: from, lte: to } },
        select: { id: true, status: true, customerName: true, createdAt: true, updatedAt: true, total: true },
      }),
      approvedOrdersIn(from, to),
      prisma.cart.findMany({
        where: { items: { some: {} } },
        select: {
          id: true, updatedAt: true,
          customer: { select: { name: true, email: true, type: true } },
          items: { select: { productId: true, name: true, price: true, quantity: true, product: { select: { currency: true, images: true } } } },
        },
      }),
      prisma.order.findMany({
        where: { status: "APPROVED", couponId: { not: null }, createdAt: { gte: from, lte: to } },
        select: { id: true, total: true, couponDiscount: true, couponDiscountUsd: true, coupon: { select: { id: true, code: true, discountType: true, discountValue: true } } },
      }),
      prisma.returnRequest.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { id: true, status: true, reason: true, customerName: true, orderId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.coupon.count({ where: { active: true } }),
    ]);

    // Cotizaciones mayoristas
    const byStatus = {};
    for (const q of quotes) byStatus[q.status] = (byStatus[q.status] || 0) + 1;
    const resolved = quotes.filter((q) => ["APPROVED", "REJECTED", "CANCELLED"].includes(q.status));
    const respondidas = quotes.filter((q) => q.status !== "PENDING");
    const avgResponseHours = respondidas.length
      ? round2(respondidas.reduce((s, q) => s + (q.updatedAt - q.createdAt) / 36e5, 0) / respondidas.length)
      : null;
    const pendientes = quotes
      .filter((q) => q.status === "PENDING")
      .map((q) => ({ id: q.id, customerName: q.customerName, dias: Math.floor((now - q.createdAt) / DAY_MS), createdAt: q.createdAt }))
      .sort((a, b) => b.dias - a.dias)
      .slice(0, 10);

    // Entregas
    const byFulfillment = {};
    for (const o of approved) byFulfillment[o.fulfillmentStatus] = (byFulfillment[o.fulfillmentStatus] || 0) + 1;
    const delivered = approved.filter((o) => o.fulfillmentStatus === "ENTREGADO");
    const avgDaysToDeliver = delivered.length
      ? round2(delivered.reduce((s, o) => s + (o.updatedAt - o.createdAt) / DAY_MS, 0) / delivered.length)
      : null;
    const demorados = approved
      .filter((o) => o.fulfillmentStatus !== "ENTREGADO" && now - o.createdAt > 3 * DAY_MS)
      .map((o) => ({ id: o.id, customerName: o.customerName, fulfillmentStatus: o.fulfillmentStatus, shippingMethod: o.shippingMethod, dias: Math.floor((now - o.createdAt) / DAY_MS), total: o.total }))
      .sort((a, b) => b.dias - a.dias)
      .slice(0, 20);

    // Carritos: abandonado = con productos y sin movimiento hace más de 24 h
    const cartValue = (c) => c.items.reduce((s, i) => (i.product?.currency === "USD" ? s : s + i.price * i.quantity), 0);
    const cartValueUsd = (c) => c.items.reduce((s, i) => (i.product?.currency === "USD" ? s + i.price * i.quantity : s), 0);
    const abandoned = carts.filter((c) => c.updatedAt < abandonedBefore);
    const cartProducts = {};
    for (const c of abandoned) {
      for (const i of c.items) {
        if (!cartProducts[i.productId]) cartProducts[i.productId] = { productId: i.productId, name: i.name, image: i.product?.images?.[0] || null, unidades: 0, carritos: 0 };
        cartProducts[i.productId].unidades += i.quantity;
        cartProducts[i.productId].carritos += 1;
      }
    }
    const carritos = {
      activos: carts.length,
      abandonados: abandoned.length,
      valorArs: round2(abandoned.reduce((s, c) => s + cartValue(c), 0)),
      valorUsd: round2(abandoned.reduce((s, c) => s + cartValueUsd(c), 0)),
      topProductos: Object.values(cartProducts).sort((a, b) => b.carritos - a.carritos || b.unidades - a.unidades).slice(0, 10),
      masViejos: abandoned
        .map((c) => ({ customer: c.customer, dias: Math.floor((now - c.updatedAt) / DAY_MS), valorArs: round2(cartValue(c)), items: c.items.length }))
        .sort((a, b) => b.valorArs - a.valorArs)
        .slice(0, 10),
    };

    // Cupones
    const couponMap = {};
    for (const o of couponOrders) {
      const c = o.coupon;
      if (!c) continue;
      if (!couponMap[c.id]) couponMap[c.id] = { id: c.id, code: c.code, discountType: c.discountType, discountValue: c.discountValue, usos: 0, descuentoArs: 0, ventasArs: 0 };
      couponMap[c.id].usos += 1;
      couponMap[c.id].descuentoArs += o.couponDiscount || 0;
      couponMap[c.id].ventasArs += o.total || 0;
    }
    const cupones = {
      activos: activeCoupons,
      ordenesConCupon: couponOrders.length,
      ordenesAprobadas: approved.length,
      descuentoTotalArs: round2(couponOrders.reduce((s, o) => s + (o.couponDiscount || 0), 0)),
      lista: Object.values(couponMap).map((c) => ({ ...c, descuentoArs: round2(c.descuentoArs), ventasArs: round2(c.ventasArs) })).sort((a, b) => b.usos - a.usos),
    };

    // Devoluciones (arrepentimiento)
    const retByStatus = {};
    for (const r of returns) retByStatus[r.status] = (retByStatus[r.status] || 0) + 1;
    const devoluciones = {
      total: returns.length,
      byStatus: retByStatus,
      tasa: approved.length > 0 ? round2((returns.length / approved.length) * 100) : 0,
      recientes: returns.slice(0, 10).map((r) => ({ id: r.id, orderId: r.orderId, customerName: r.customerName, status: r.status, reason: (r.reason || "").slice(0, 160), createdAt: r.createdAt })),
    };

    res.json({
      range: { from, to },
      cotizaciones: {
        total: quotes.length,
        byStatus,
        aprobadas: byStatus.APPROVED || 0,
        tasaAprobacion: resolved.length > 0 ? round2(((byStatus.APPROVED || 0) / resolved.length) * 100) : null,
        avgResponseHours,
        pendientes,
      },
      entregas: { total: approved.length, byFulfillment, avgDaysToDeliver, demorados },
      carritos,
      cupones,
      devoluciones,
    });
  } catch (err) {
    console.error("analytics.getEmbudo error:", err);
    res.status(500).json({ error: "Error al obtener analíticas de embudo" });
  }
}

// ─── 4. Clientes ──────────────────────────────────────────────────────────────
// GET /api/analytics/clientes?dateFrom&dateTo
async function getClientes(req, res) {
  try {
    const { from, to, granularity } = parseRange(req.query);
    const now = new Date();

    const [allOrders, customers] = await Promise.all([
      prisma.order.findMany({
        where: { status: "APPROVED" },
        select: {
          id: true, customerId: true, customerName: true, customerEmail: true, customerType: true,
          total: true, totalUsd: true, ivaAmount: true, createdAt: true,
          items: { select: { price: true, quantity: true, currency: true, cost: true, product: { select: { cost: true, currency: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.customer.findMany({ select: { id: true, name: true, email: true, type: true, status: true, createdAt: true } }),
    ]);

    // Un comprador = cuenta (customerId) o, si compró sin cuenta, el email
    const buyers = {};
    for (const o of allOrders) {
      const key = o.customerId ? `c${o.customerId}` : `e${(o.customerEmail || "").toLowerCase()}`;
      const f = orderFinancials(o);
      if (!buyers[key]) buyers[key] = { key, customerId: o.customerId, name: o.customerName, email: o.customerEmail, type: o.customerType, ordenes: 0, totalArs: 0, totalUsd: 0, firstOrder: o.createdAt, lastOrder: o.createdAt };
      const b = buyers[key];
      b.ordenes += 1;
      b.totalArs += f.revenueArs;
      b.totalUsd += f.revenueUsd;
      if (o.createdAt > b.lastOrder) b.lastOrder = o.createdAt;
      if (o.createdAt < b.firstOrder) b.firstOrder = o.createdAt;
      b.name = o.customerName; // el más reciente
    }
    const buyerList = Object.values(buyers);
    const recurrentes = buyerList.filter((b) => b.ordenes >= 2);
    const avgLtv = buyerList.length ? round2(buyerList.reduce((s, b) => s + b.totalArs, 0) / buyerList.length) : 0;
    const avgOrders = buyerList.length ? round2(buyerList.reduce((s, b) => s + b.ordenes, 0) / buyerList.length) : 0;

    const inactive = (days) => buyerList.filter((b) => now - b.lastOrder > days * DAY_MS);
    const inactivos = {
      d60: inactive(60).length,
      d90: inactive(90).length,
      lista: inactive(60)
        .map((b) => ({ ...b, totalArs: round2(b.totalArs), totalUsd: round2(b.totalUsd), diasSinComprar: Math.floor((now - b.lastOrder) / DAY_MS) }))
        .sort((a, b) => b.totalArs - a.totalArs)
        .slice(0, 30),
    };

    // Período seleccionado
    const inRange = allOrders.filter((o) => o.createdAt >= from && o.createdAt <= to);
    const periodBuyers = {};
    for (const o of inRange) {
      const key = o.customerId ? `c${o.customerId}` : `e${(o.customerEmail || "").toLowerCase()}`;
      const f = orderFinancials(o);
      if (!periodBuyers[key]) periodBuyers[key] = { key, name: o.customerName, email: o.customerEmail, type: o.customerType, ordenes: 0, totalArs: 0, nuevo: buyers[key].firstOrder >= from };
      periodBuyers[key].ordenes += 1;
      periodBuyers[key].totalArs += f.revenueArs;
    }
    const periodList = Object.values(periodBuyers).sort((a, b) => b.totalArs - a.totalArs);
    const periodRevenue = periodList.reduce((s, b) => s + b.totalArs, 0);
    const top10 = periodList.slice(0, 10);
    const top10Revenue = top10.reduce((s, b) => s + b.totalArs, 0);

    // Altas de clientes en el período, por bucket
    const keys = bucketRange(from, to, granularity);
    const altas = Object.fromEntries(keys.map((k) => [k, { bucket: k, minoristas: 0, mayoristas: 0 }]));
    for (const c of customers) {
      if (c.createdAt < from || c.createdAt > to) continue;
      const b = altas[bucketKey(c.createdAt, granularity)];
      if (!b) continue;
      if (c.type === "MAYORISTA") b.mayoristas += 1; else b.minoristas += 1;
    }
    const customerIdsWithOrders = new Set(allOrders.map((o) => o.customerId).filter(Boolean));

    res.json({
      range: { from, to, granularity },
      base: {
        registrados: customers.length,
        mayoristas: customers.filter((c) => c.type === "MAYORISTA").length,
        pendientesAprobacion: customers.filter((c) => c.status === "PENDING").length,
        registradosSinCompra: customers.filter((c) => !customerIdsWithOrders.has(c.id)).length,
        compradores: buyerList.length,
        recurrentes: recurrentes.length,
        tasaRecurrencia: buyerList.length ? round2((recurrentes.length / buyerList.length) * 100) : 0,
        avgLtvArs: avgLtv,
        avgOrdenesPorComprador: avgOrders,
      },
      periodo: {
        compradores: periodList.length,
        nuevos: periodList.filter((b) => b.nuevo).length,
        recurrentes: periodList.filter((b) => !b.nuevo).length,
        ventasArs: round2(periodRevenue),
        top10ShareArs: periodRevenue > 0 ? round2((top10Revenue / periodRevenue) * 100) : 0,
        top10: top10.map((b) => ({ ...b, totalArs: round2(b.totalArs) })),
        altas: keys.map((k) => altas[k]),
        altasTotal: customers.filter((c) => c.createdAt >= from && c.createdAt <= to).length,
      },
      inactivos,
    });
  } catch (err) {
    console.error("analytics.getClientes error:", err);
    res.status(500).json({ error: "Error al obtener analíticas de clientes" });
  }
}

// ─── 5. Stock e inventario (foto actual, sin período) ─────────────────────────
// GET /api/analytics/stock
async function getStock(req, res) {
  try {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * DAY_MS);
    const d90 = new Date(now.getTime() - 90 * DAY_MS);

    const [products, items90] = await Promise.all([
      prisma.product.findMany({
        where: { active: true },
        select: {
          id: true, name: true, images: true, stock: true, stockUnlimited: true, cost: true, currency: true, createdAt: true,
          supplier: { select: { name: true } },
          categories: { select: { id: true, name: true, parent: { select: { name: true } } } },
          variants: { select: { stock: true, stockUnlimited: true, cost: true, currency: true } },
        },
      }),
      prisma.orderItem.findMany({
        where: { order: { status: "APPROVED", createdAt: { gte: d90 } } },
        select: { productId: true, quantity: true, order: { select: { createdAt: true } } },
      }),
    ]);

    const sold30 = {};
    const sold90 = {};
    for (const it of items90) {
      if (!it.productId) continue;
      sold90[it.productId] = (sold90[it.productId] || 0) + it.quantity;
      if (it.order.createdAt >= d30) sold30[it.productId] = (sold30[it.productId] || 0) + it.quantity;
    }

    // Stock y valor a costo por producto. Con variantes, el stock vive en las variantes.
    const rows = products.map((p) => {
      const hasVariants = p.variants.length > 0;
      let units = 0;
      let unlimited = p.stockUnlimited;
      let valueArs = 0;
      let valueUsd = 0;
      let sinCosto = false;
      if (hasVariants) {
        for (const v of p.variants) {
          if (v.stockUnlimited) { unlimited = true; continue; }
          const cost = v.cost ?? p.cost;
          const cur = v.currency || p.currency || "ARS";
          units += v.stock;
          if (cost === null || cost === undefined) sinCosto = true;
          else if (cur === "USD") valueUsd += v.stock * cost; else valueArs += v.stock * cost;
        }
      } else if (!p.stockUnlimited) {
        units = p.stock;
        if (p.cost === null || p.cost === undefined) sinCosto = true;
        else if ((p.currency || "ARS") === "USD") valueUsd = p.stock * p.cost; else valueArs = p.stock * p.cost;
      }
      const s30 = sold30[p.id] || 0;
      const s90 = sold90[p.id] || 0;
      const rate = s30 / 30;
      const cat = p.categories[0];
      return {
        id: p.id, name: p.name, image: p.images?.[0] || null, supplier: p.supplier?.name || null,
        category: cat ? (cat.parent ? `${cat.parent.name} › ${cat.name}` : cat.name) : "Sin categoría",
        currency: p.currency || "ARS",
        units, unlimited, valueArs: round2(valueArs), valueUsd: round2(valueUsd), sinCosto,
        sold30: s30, sold90: s90,
        diasDeStock: unlimited ? null : rate > 0 ? Math.round(units / rate) : null,
        createdAt: p.createdAt,
      };
    });

    const finite = rows.filter((r) => !r.unlimited);
    const inventario = {
      productos: products.length,
      productosIlimitados: rows.filter((r) => r.unlimited).length,
      unidades: finite.reduce((s, r) => s + r.units, 0),
      valorArs: round2(finite.reduce((s, r) => s + r.valueArs, 0)),
      valorUsd: round2(finite.reduce((s, r) => s + r.valueUsd, 0)),
      sinCosto: finite.filter((r) => r.sinCosto && r.units > 0).length,
      sinStock: finite.filter((r) => r.units <= 0).length,
    };

    const porAgotarse = finite
      .filter((r) => r.diasDeStock !== null && r.diasDeStock <= 30)
      .sort((a, b) => a.diasDeStock - b.diasDeStock)
      .slice(0, 30);

    const sinMovimiento = finite
      .filter((r) => r.units > 0 && r.sold90 === 0 && now - r.createdAt > 30 * DAY_MS)
      .sort((a, b) => b.valueArs - a.valueArs || b.valueUsd - a.valueUsd || b.units - a.units)
      .slice(0, 30);
    const capitalInmovilizado = {
      productos: finite.filter((r) => r.units > 0 && r.sold90 === 0 && now - r.createdAt > 30 * DAY_MS).length,
      valorArs: round2(finite.filter((r) => r.units > 0 && r.sold90 === 0 && now - r.createdAt > 30 * DAY_MS).reduce((s, r) => s + r.valueArs, 0)),
      valorUsd: round2(finite.filter((r) => r.units > 0 && r.sold90 === 0 && now - r.createdAt > 30 * DAY_MS).reduce((s, r) => s + r.valueUsd, 0)),
    };

    // Rotación por categoría: unidades vendidas en 30 días sobre unidades en stock
    const catMap = {};
    for (const r of finite) {
      if (!catMap[r.category]) catMap[r.category] = { label: r.category, productos: 0, unidades: 0, sold30: 0, valorArs: 0, valorUsd: 0 };
      const c = catMap[r.category];
      c.productos += 1;
      c.unidades += r.units;
      c.sold30 += r.sold30;
      c.valorArs += r.valueArs;
      c.valorUsd += r.valueUsd;
    }
    const rotacion = Object.values(catMap)
      .map((c) => ({ ...c, valorArs: round2(c.valorArs), valorUsd: round2(c.valorUsd), rotacion: c.unidades > 0 ? round2((c.sold30 / c.unidades) * 100) : null }))
      .sort((a, b) => b.valorArs - a.valorArs);

    res.json({ inventario, porAgotarse, sinMovimiento, capitalInmovilizado, rotacion });
  } catch (err) {
    console.error("analytics.getStock error:", err);
    res.status(500).json({ error: "Error al obtener analíticas de stock" });
  }
}

// ─── 6. Ofertas / campañas ────────────────────────────────────────────────────
// GET /api/analytics/ofertas
// Para cada campaña: unidades y facturación de SUS productos durante la vigencia, contra el mismo
// lapso inmediatamente anterior. Sirve para saber si la oferta vendió más o solo bajó el margen.
async function getOfertas(req, res) {
  try {
    const now = new Date();
    const offers = await prisma.offer.findMany({
      orderBy: { startsAt: "desc" },
      take: 20,
      select: {
        id: true, name: true, discountType: true, discountValue: true, appliesTo: true, startsAt: true, endsAt: true, active: true, applied: true,
        items: { select: { productId: true, skippedReason: true } },
      },
    });

    const result = [];
    for (const ofr of offers) {
      const productIds = ofr.items.filter((i) => !i.skippedReason).map((i) => i.productId);
      const base = { id: ofr.id, name: ofr.name, discountType: ofr.discountType, discountValue: ofr.discountValue, appliesTo: ofr.appliesTo, startsAt: ofr.startsAt, endsAt: ofr.endsAt, active: ofr.active, productos: productIds.length, excluidos: ofr.items.length - productIds.length };
      const estado = ofr.startsAt > now ? "programada" : ofr.endsAt < now ? "finalizada" : ofr.active ? "vigente" : "pausada";
      if (estado === "programada" || productIds.length === 0) { result.push({ ...base, estado, durante: null, antes: null }); continue; }

      const winTo = ofr.endsAt < now ? ofr.endsAt : now;
      const len = winTo.getTime() - ofr.startsAt.getTime();
      const prevFrom = new Date(ofr.startsAt.getTime() - len);
      const items = await prisma.orderItem.findMany({
        where: { productId: { in: productIds }, order: { status: "APPROVED", createdAt: { gte: prevFrom, lte: winTo } } },
        select: { quantity: true, price: true, cost: true, currency: true, product: { select: { cost: true, currency: true } }, order: { select: { id: true, createdAt: true } } },
      });
      const sum = (list) => {
        const acc = { unidades: 0, ventasArs: 0, gananciaArs: 0, ventasUsd: 0, ordenes: new Set() };
        for (const it of list) {
          acc.unidades += it.quantity;
          acc.ordenes.add(it.order.id);
          if (it.currency === "USD") acc.ventasUsd += it.price * it.quantity;
          else { const rev = it.price * it.quantity; acc.ventasArs += rev; acc.gananciaArs += rev - it.quantity * unitCostArs(it); }
        }
        return { unidades: acc.unidades, ordenes: acc.ordenes.size, ventasArs: round2(acc.ventasArs), gananciaArs: round2(acc.gananciaArs), ventasUsd: round2(acc.ventasUsd) };
      };
      const durante = sum(items.filter((i) => i.order.createdAt >= ofr.startsAt));
      const antes = sum(items.filter((i) => i.order.createdAt < ofr.startsAt));
      const delta = (a, b) => (b > 0 ? round2(((a - b) / b) * 100) : a > 0 ? null : 0);
      result.push({
        ...base, estado, diasMedidos: Math.max(1, Math.round(len / DAY_MS)), durante, antes,
        deltaUnidades: delta(durante.unidades, antes.unidades),
        deltaVentas: delta(durante.ventasArs, antes.ventasArs),
        deltaGanancia: delta(durante.gananciaArs, antes.gananciaArs),
      });
    }

    res.json({ ofertas: result });
  } catch (err) {
    console.error("analytics.getOfertas error:", err);
    res.status(500).json({ error: "Error al obtener analíticas de ofertas" });
  }
}


// ─── 7. Búsquedas y vistas de producto ────────────────────────────────────────
// GET /api/analytics/interes?dateFrom&dateTo
// Sale de store_events (lo registra el storefront). "Compraron" = sesiones que vieron el producto y
// después hicieron un pedido APROBADO que lo incluye (misma sesión del navegador, o misma cuenta de
// cliente si estaba logueado). Un visitante que vio y compró desde otro dispositivo sin loguearse
// no se puede vincular: la conversión real es igual o mayor a la que se muestra.
async function getInteres(req, res) {
  try {
    const { from, to } = parseRange(req.query);
    const [events, orders] = await Promise.all([
      prisma.storeEvent.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { id: true, type: true, sessionId: true, customerId: true, productId: true, term: true, results: true, path: true, device: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      // Pedidos aprobados desde el inicio del período (una vista de hoy puede convertir mañana)
      prisma.order.findMany({
        where: { status: "APPROVED", createdAt: { gte: from } },
        select: { id: true, sessionId: true, customerId: true, customerName: true, total: true, createdAt: true, items: { select: { productId: true } } },
      }),
    ]);

    // ── Búsquedas ──
    const searches = events.filter((e) => e.type === "SEARCH");
    const termMap = {};
    for (const e of searches) {
      const k = e.term || "";
      if (!termMap[k]) termMap[k] = { term: k, busquedas: 0, sesiones: new Set(), sinResultados: 0, resultados: [] };
      termMap[k].busquedas += 1;
      termMap[k].sesiones.add(e.sessionId);
      if (e.results === 0) termMap[k].sinResultados += 1;
      if (e.results !== null) termMap[k].resultados.push(e.results);
    }
    const terms = Object.values(termMap).map((t) => ({
      term: t.term, busquedas: t.busquedas, sesiones: t.sesiones.size, sinResultados: t.sinResultados,
      resultadosProm: t.resultados.length ? Math.round(t.resultados.reduce((s, r) => s + r, 0) / t.resultados.length) : null,
    }));
    const topTerms = [...terms].sort((a, b) => b.busquedas - a.busquedas).slice(0, 30);
    const sinResultados = terms.filter((t) => t.sinResultados > 0 && t.sinResultados >= t.busquedas / 2).sort((a, b) => b.busquedas - a.busquedas).slice(0, 30);

    // ── Vistas de producto ──
    const views = events.filter((e) => e.type === "PRODUCT_VIEW" && e.productId);
    const pageViews = events.filter((e) => e.type === "PAGE_VIEW");
    const prodMap = {};
    for (const e of views) {
      if (!prodMap[e.productId]) prodMap[e.productId] = { productId: e.productId, vistas: 0, sesiones: new Set() };
      prodMap[e.productId].vistas += 1;
      prodMap[e.productId].sesiones.add(e.sessionId);
    }
    // Compradores por producto: sesiones y cuentas que hicieron un pedido aprobado con ese producto
    const buyersByProduct = {};
    for (const o of orders) {
      for (const it of o.items) {
        if (!it.productId) continue;
        if (!buyersByProduct[it.productId]) buyersByProduct[it.productId] = { sessions: new Set(), customers: new Set() };
        if (o.sessionId) buyersByProduct[it.productId].sessions.add(o.sessionId);
        if (o.customerId) buyersByProduct[it.productId].customers.add(o.customerId);
      }
    }
    // Sesión → cuenta de cliente (última conocida), para vincular vistas logueadas con pedidos de esa cuenta
    const sessionCustomer = {};
    for (const e of views) if (e.customerId) sessionCustomer[e.sessionId] = e.customerId;

    const productIds = Object.keys(prodMap).map(Number);
    const allProductIds = Array.from(new Set([...productIds, ...orders.flatMap((o) => o.items.map((i) => i.productId).filter(Boolean))]));
    const products = allProductIds.length
      ? await prisma.product.findMany({ where: { id: { in: allProductIds } }, select: { id: true, name: true, slug: true, images: true, active: true } })
      : [];
    const pInfo = Object.fromEntries(products.map((p) => [p.id, p]));
    const topProducts = Object.values(prodMap).map((p) => {
      const b = buyersByProduct[p.productId];
      let compradores = 0;
      for (const s of p.sesiones) {
        const bought = b && (b.sessions.has(s) || (sessionCustomer[s] && b.customers.has(sessionCustomer[s])));
        if (bought) compradores += 1;
      }
      const visitantes = p.sesiones.size;
      const info = pInfo[p.productId];
      return {
        productId: p.productId, name: info?.name || "Producto eliminado", slug: info?.slug || null, image: info?.images?.[0] || null, active: info?.active ?? false,
        vistas: p.vistas, visitantes, compradores,
        conversion: visitantes > 0 ? round2((compradores / visitantes) * 100) : 0,
      };
    }).sort((a, b) => b.vistas - a.vistas).slice(0, 30);

    // ── Recorrido por visitante: quién entró, qué buscó, qué vio y si compró ──
    const sessMap = {};
    for (const e of events) {
      if (!sessMap[e.sessionId]) sessMap[e.sessionId] = { sessionId: e.sessionId, customerId: null, device: null, firstSeen: e.createdAt, lastSeen: e.createdAt, busquedas: 0, vistas: 0, paginas: 0, compras: 0, eventos: [] };
      const s = sessMap[e.sessionId];
      if (e.customerId) s.customerId = e.customerId;
      if (e.device) s.device = e.device;
      if (e.createdAt > s.lastSeen) s.lastSeen = e.createdAt;
      if (e.type === "SEARCH") s.busquedas += 1; else if (e.type === "PRODUCT_VIEW") s.vistas += 1; else s.paginas += 1;
      s.eventos.push({ at: e.createdAt, type: e.type, term: e.term, results: e.results, productId: e.productId, productName: e.productId ? (pInfo[e.productId]?.name || "Producto eliminado") : null, path: e.path, label: e.type === "PAGE_VIEW" ? pageLabel(e.path) : null });
    }
    // Compras: pedidos aprobados de la misma sesión (o de la misma cuenta logueada en esa sesión)
    for (const o of orders) {
      const bySession = o.sessionId && sessMap[o.sessionId] ? [sessMap[o.sessionId]] : [];
      const byCustomer = o.customerId ? Object.values(sessMap).filter((s) => s.customerId === o.customerId && !bySession.includes(s)) : [];
      for (const s of [...bySession, ...byCustomer]) {
        s.compras += 1;
        s.eventos.push({ at: o.createdAt, type: "COMPRA", orderId: o.id, total: o.total, productos: o.items.map((i) => pInfo[i.productId]?.name || "Producto").slice(0, 5) });
      }
    }
    const customerIds = Array.from(new Set(Object.values(sessMap).map((s) => s.customerId).filter(Boolean)));
    const customers = customerIds.length ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, email: true, type: true } }) : [];
    const cInfo = Object.fromEntries(customers.map((c) => [c.id, c]));
    const visitantes = Object.values(sessMap)
      .map((s) => ({
        ...s, id: s.sessionId.slice(0, 8), customer: s.customerId ? cInfo[s.customerId] || null : null,
        eventos: s.eventos.sort((a, b) => new Date(a.at) - new Date(b.at)).slice(-60),
      }))
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
      .slice(0, 150);

    res.json({
      range: { from, to },
      visitantes,
      resumen: {
        paginas: pageViews.length,
        busquedas: searches.length,
        terminosDistintos: terms.length,
        busquedasSinResultados: searches.filter((e) => e.results === 0).length,
        vistas: views.length,
        productosVistos: productIds.length,
        visitantes: new Set(events.map((e) => e.sessionId)).size,
      },
      topTerms, sinResultados, topProducts,
      desde: events.length ? events.reduce((m, e) => (e.createdAt < m ? e.createdAt : m), events[0].createdAt) : null,
    });
  } catch (err) {
    console.error("analytics.getInteres error:", err);
    res.status(500).json({ error: "Error al obtener búsquedas y vistas" });
  }
}

// Etiqueta legible de una ruta de la tienda (misma lógica que PresenceTracker en el frontend)
function pageLabel(path) {
  if (!path) return "Página";
  const [pathname, qs] = path.split("?");
  const params = new URLSearchParams(qs || "");
  if (pathname === "/") return "Inicio";
  if (pathname === "/catalogo") {
    const c = params.get("category");
    const s = params.get("search");
    if (s) return `Buscando "${s}"`;
    return c ? `Catálogo · ${c}` : "Catálogo";
  }
  const fixed = { "/carrito": "Carrito", "/checkout": "Checkout", "/login": "Iniciar sesión", "/registro": "Registro", "/favoritos": "Favoritos", "/pedidos": "Mis pedidos", "/cotizaciones": "Mis cotizaciones", "/perfil": "Perfil", "/sobre-nosotros": "Sobre nosotros", "/como-comprar": "Cómo comprar", "/arrepentimiento": "Arrepentimiento" };
  if (fixed[pathname]) return fixed[pathname];
  if (pathname.startsWith("/pago/")) return "Resultado de pago";
  if (pathname.startsWith("/pedidos/")) return "Detalle de pedido";
  if (pathname.startsWith("/pagar-cotizacion/")) return "Pagando cotización";
  return pathname;
}

// ─── 8. En vivo ───────────────────────────────────────────────────────────────
// GET /api/analytics/en-vivo — quién está en la tienda ahora y qué página mira (memoria del backend)
function getEnVivo(req, res) {
  const sessions = livePresence();
  const porPagina = {};
  for (const s of sessions) {
    const k = s.label || s.path;
    porPagina[k] = (porPagina[k] || 0) + 1;
  }
  res.json({
    ahora: new Date(),
    total: sessions.length,
    identificados: sessions.filter((s) => s.customerId).length,
    porPagina: Object.entries(porPagina).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    sesiones: sessions.map((s) => ({
      id: s.sessionId.slice(0, 8), customerId: s.customerId, customerName: s.customerName, customerEmail: s.customerEmail, customerType: s.customerType,
      path: s.path, label: s.label, device: s.device, isAdmin: s.isAdmin, secondsOnSite: s.secondsOnSite, secondsSinceSeen: s.secondsSinceSeen,
    })),
  });
}

module.exports = { getVentas, getOrigen, getEmbudo, getClientes, getStock, getOfertas, getInteres, getEnVivo };
