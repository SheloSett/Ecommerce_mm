import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { analyticsApi, getImageUrl } from "../../services/api";
import { LineChart, ColumnChart, BarList, ShareBar, StatTile, DeltaBadge, pctDelta } from "../../components/admin/charts";

// ─── Formato ──────────────────────────────────────────────────────────────────
const fmtArs = (v) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v ?? 0);
const fmtUsd = (v) => `USD ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(v ?? 0)}`;
const fmtNum = (v) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(v ?? 0);
const fmtPct = (v) => (v === null || v === undefined ? "—" : `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(v)} %`);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Etiqueta corta de un bucket ("2026-09-03" → "03/09", "2026-09" → "sep 26")
function bucketLabel(key, granularity) {
  const parts = key.split("-");
  if (granularity === "month") return `${MESES[Number(parts[1]) - 1]} ${parts[0].slice(2)}`;
  const lbl = `${parts[2]}/${parts[1]}`;
  return granularity === "week" ? `sem ${lbl}` : lbl;
}

// Fecha local YYYY-MM-DD (sin pasar por UTC, para no correrse un día)
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PRESETS = [
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
  { key: "90d", label: "90 días" },
  { key: "mes", label: "Este mes" },
  { key: "mes_ant", label: "Mes anterior" },
  { key: "anio", label: "Este año" },
];

function presetRange(key) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (n) => new Date(today.getTime() - n * 86400000);
  switch (key) {
    case "7d": return [ymd(daysAgo(6)), ymd(today)];
    case "90d": return [ymd(daysAgo(89)), ymd(today)];
    case "mes": return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
    case "mes_ant": return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
    case "anio": return [ymd(new Date(now.getFullYear(), 0, 1)), ymd(new Date(now.getFullYear(), 11, 31))];
    default: return [ymd(daysAgo(29)), ymd(today)];
  }
}

const TABS = [
  { key: "", label: "Ventas", icon: "📈" },
  { key: "origen", label: "Origen", icon: "🧭" },
  { key: "embudo", label: "Embudo", icon: "🔻" },
  { key: "clientes", label: "Clientes", icon: "👥" },
  { key: "stock", label: "Stock", icon: "📦" },
  { key: "ofertas", label: "Ofertas", icon: "🏷️" },
  { key: "interes", label: "Búsquedas y vistas", icon: "🔍" },
  { key: "envivo", label: "En vivo", icon: "🟢" },
];

// Pestañas que NO dependen del período (foto actual / por campaña)
const SIN_PERIODO = ["stock", "ofertas", "envivo"];

// ─── Piezas de UI ─────────────────────────────────────────────────────────────
function Section({ title, subtitle, children, right }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
        <div>
          <h2 className="font-bold text-slate-800">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="p-4 sm:p-6">{children}</div>
    </section>
  );
}

function Table({ cols, rows, empty = "Sin datos en este período", keyFn }) {
  if (!rows || rows.length === 0) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            {cols.map((c) => (
              <th key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""} whitespace-nowrap`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={keyFn ? keyFn(r, i) : r.key ?? r.id ?? i} className="border-b border-slate-50 hover:bg-slate-50">
              {cols.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right whitespace-nowrap" : ""} ${c.className || ""}`} style={c.align === "right" ? { fontVariantNumeric: "tabular-nums" } : undefined}>
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductCell({ name, image, sub }) {
  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-slate-100">
        {image ? <img src={getImageUrl(image)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-sm">📦</div>}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-800">{name}</p>
        {sub && <p className="truncate text-xs text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function Note({ children }) {
  return <p className="mt-3 text-xs text-slate-400">{children}</p>;
}

// Desglose por orden (tipo de cliente, canal, medio de pago, envío): barra de participación + tabla
function BreakdownSection({ title, subtitle, data, hasUsd }) {
  return (
    <Section title={title} subtitle={subtitle}>
      <ShareBar items={data} valueKey="ventasArs" format={fmtArs} />
      <div className="mt-4">
        <Table
          rows={data}
          cols={[
            { key: "label", label: "" },
            { key: "ordenes", label: "Órdenes", align: "right", render: (r) => fmtNum(r.ordenes) },
            { key: "ventasArs", label: "Ventas $", align: "right", render: (r) => fmtArs(r.ventasArs) },
            { key: "gananciaArs", label: "Ganancia $", align: "right", render: (r) => <span className={r.gananciaArs >= 0 ? "text-emerald-600" : "text-red-500"}>{fmtArs(r.gananciaArs)}</span> },
            ...(hasUsd ? [{ key: "ventasUsd", label: "Ventas USD", align: "right", render: (r) => (r.ventasUsd > 0 ? fmtUsd(r.ventasUsd) : "—") }] : []),
          ]}
        />
      </div>
    </Section>
  );
}

// ─── Pestaña: Ventas ──────────────────────────────────────────────────────────
function VentasTab({ data, granularity, setGranularity }) {
  const { current: c, previous: p, series, byWeekday, byHour, range } = data;
  const labels = series.map((s) => bucketLabel(s.bucket, range.granularity));
  const hasUsd = c.ventasUsd > 0 || p.ventasUsd > 0;
  const GRAN = [{ key: "day", label: "Día" }, { key: "week", label: "Semana" }, { key: "month", label: "Mes" }];

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Ventas $" value={fmtArs(c.ventasArs)} delta={pctDelta(c.ventasArs, p.ventasArs)} />
        <StatTile label="Ganancia $" value={fmtArs(c.gananciaArs)} delta={pctDelta(c.gananciaArs, p.gananciaArs)} hint="Ventas − IVA − costo" />
        <StatTile label="Órdenes" value={fmtNum(c.ordenes)} delta={pctDelta(c.ordenes, p.ordenes)} />
        <StatTile label="Ticket promedio $" value={fmtArs(c.ticketArs)} delta={pctDelta(c.ticketArs, p.ticketArs)} />
        <StatTile label="Unidades" value={fmtNum(c.unidades)} delta={pctDelta(c.unidades, p.unidades)} />
        {hasUsd
          ? <StatTile label="Ventas USD" value={fmtUsd(c.ventasUsd)} delta={pctDelta(c.ventasUsd, p.ventasUsd)} hint={`${c.ordenesUsd} órdenes con dólares`} />
          : <StatTile label="Gastos $" value={fmtArs(c.gastosArs)} hint="Cargados en Caja" />}
      </div>
      <p className="-mt-4 text-xs text-slate-400">Comparado contra el período anterior de la misma duración ({fmtDate(range.prevFrom)} → {fmtDate(range.prevTo)}).</p>

      <Section
        title="Ventas y ganancia en el tiempo"
        subtitle="Facturación en pesos por período, ganancia neta de IVA y costo, y gastos cargados en Caja"
        right={(
          <div className="flex gap-1">
            {GRAN.map((g) => (
              <button key={g.key} onClick={() => setGranularity(g.key)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${(granularity || range.granularity) === g.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{g.label}</button>
            ))}
          </div>
        )}
      >
        <LineChart
          labels={labels}
          series={[
            { name: "Ventas $", values: series.map((s) => s.ventasArs) },
            { name: "Ganancia $", values: series.map((s) => s.gananciaArs) },
            { name: "Gastos $", values: series.map((s) => s.gastosArs) },
          ]}
          format={fmtArs}
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-500">Ver tabla</summary>
          <div className="mt-2">
            <Table
              rows={series}
              keyFn={(r) => r.bucket}
              cols={[
                { key: "bucket", label: "Período", render: (r) => bucketLabel(r.bucket, range.granularity) },
                { key: "ordenes", label: "Órdenes", align: "right" },
                { key: "ventasArs", label: "Ventas $", align: "right", render: (r) => fmtArs(r.ventasArs) },
                { key: "gananciaArs", label: "Ganancia $", align: "right", render: (r) => fmtArs(r.gananciaArs) },
                { key: "gastosArs", label: "Gastos $", align: "right", render: (r) => fmtArs(r.gastosArs) },
                ...(hasUsd ? [{ key: "ventasUsd", label: "Ventas USD", align: "right", render: (r) => fmtUsd(r.ventasUsd) }] : []),
              ]}
            />
          </div>
        </details>
      </Section>

      <Section title="Órdenes por período" subtitle="Cantidad de pedidos aprobados">
        <ColumnChart labels={labels} values={series.map((s) => s.ordenes)} format={(v) => `${fmtNum(v)} órdenes`} height={180} />
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Ventas por día de la semana" subtitle="Cuándo se concentran las compras (hora argentina)">
          <ColumnChart labels={DIAS} values={byWeekday.map((w) => w.ventasArs)} format={fmtArs} extra={(i) => `${byWeekday[i].ordenes} órdenes`} height={180} />
        </Section>
        <Section title="Ventas por hora del día" subtitle="Útil para elegir a qué hora publicar ofertas o mandar mails">
          <ColumnChart labels={byHour.map((h) => `${h.hour}`)} values={byHour.map((h) => h.ventasArs)} format={fmtArs} extra={(i) => `${byHour[i].ordenes} órdenes a las ${byHour[i].hour}:00`} height={180} />
        </Section>
      </div>
    </>
  );
}

// ─── Pestaña: Origen ──────────────────────────────────────────────────────────
function OrigenTab({ data }) {
  const hasUsd = data.totals.ventasUsd > 0;
  const rankCols = [
    { key: "label", label: "" },
    { key: "unidades", label: "Unid.", align: "right", render: (r) => fmtNum(r.unidades) },
    { key: "ordenes", label: "Órdenes", align: "right", render: (r) => fmtNum(r.ordenes) },
    { key: "ventasArs", label: "Ventas $", align: "right", render: (r) => fmtArs(r.ventasArs) },
    { key: "gananciaArs", label: "Ganancia $", align: "right", render: (r) => <span className={r.gananciaArs >= 0 ? "text-emerald-600" : "text-red-500"}>{fmtArs(r.gananciaArs)}</span> },
    { key: "margen", label: "Margen", align: "right", render: (r) => fmtPct(r.margen) },
    ...(hasUsd ? [{ key: "ventasUsd", label: "Ventas USD", align: "right", render: (r) => (r.ventasUsd > 0 ? fmtUsd(r.ventasUsd) : "—") }] : []),
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Ventas $" value={fmtArs(data.totals.ventasArs)} />
        <StatTile label="Órdenes" value={fmtNum(data.totals.ordenes)} />
        <StatTile label="Costo de envío cobrado" value={fmtArs(data.envio.total)} hint={`${fmtPct(data.envio.share)} de las ventas`} />
        <StatTile label="Margen bruto" value={fmtPct(data.totals.ventasArs > 0 ? (data.totals.gananciaArs / data.totals.ventasArs) * 100 : null)} hint="Ganancia sobre ventas en pesos" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <BreakdownSection title="Minorista vs mayorista" subtitle="Según el tipo de cliente al momento del pedido" data={data.byCustomerType} hasUsd={hasUsd} />
        <BreakdownSection title="Canal de venta" subtitle="Tienda online vs ventas cargadas a mano desde el panel" data={data.byChannel} hasUsd={hasUsd} />
        <BreakdownSection title="Medio de pago" data={data.byPaymentMethod} hasUsd={hasUsd} />
        <BreakdownSection title="Envío vs retiro" subtitle="El costo de envío no forma parte de las ventas: se cobra aparte" data={data.byShipping} hasUsd={hasUsd} />
      </div>
      <Section title="Ventas por categoría" subtitle="Precio × cantidad de las líneas en pesos, sin prorratear cupón ni IVA. Un producto cuenta en su primera categoría.">
        <BarList items={data.byCategory.slice(0, 12)} valueKey="ventasArs" format={fmtArs} sub={(r) => `${fmtNum(r.unidades)} unidades · margen ${fmtPct(r.margen)}`} />
        <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Ver tabla completa</summary><div className="mt-2"><Table rows={data.byCategory} cols={rankCols} /></div></details>
      </Section>
      <Section title="Ventas y margen por proveedor" subtitle="Qué proveedor deja más plata, no solo cuál vende más">
        <BarList items={data.bySupplier.slice(0, 12)} valueKey="gananciaArs" format={fmtArs} sub={(r) => `${fmtArs(r.ventasArs)} en ventas · ${fmtNum(r.unidades)} unidades · margen ${fmtPct(r.margen)}`} />
        <Note>Las barras muestran la ganancia; el detalle de ventas y unidades está en el subtítulo de cada una.</Note>
        <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Ver tabla completa</summary><div className="mt-2"><Table rows={data.bySupplier} cols={rankCols} /></div></details>
      </Section>
    </>
  );
}

// ─── Pestaña: Embudo ──────────────────────────────────────────────────────────
const QUOTE_STATUS = { PENDING: "Pendientes", QUOTE_APPROVED: "Aprobadas, sin pagar", PAYMENT_REVIEW: "Pago en revisión", APPROVED: "Pagadas", REJECTED: "Rechazadas", CANCELLED: "Canceladas" };
const FULFILL = { PENDIENTE: "Pendiente", EN_PREPARACION: "En preparación", ENVIADO: "Enviado", ENTREGADO: "Entregado" };
const RET_STATUS = { PENDING: "Pendiente", APPROVED: "Aprobada", REJECTED: "Rechazada" };
const statusItems = (obj, names, order) => (order || Object.keys(obj)).filter((k) => obj[k]).map((k) => ({ key: k, label: names[k] || k, value: obj[k] }));

function EmbudoTab({ data }) {
  const { cotizaciones: q, entregas: e, carritos: ca, cupones: cu, devoluciones: d } = data;
  return (
    <>
      <Section title="Cotizaciones mayoristas" subtitle="Pedidos que entraron como cotización en el período, y en qué quedaron">
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Recibidas" value={fmtNum(q.total)} />
          <StatTile label="Pagadas" value={fmtNum(q.aprobadas)} hint={`${fmtPct(q.tasaAprobacion)} de las resueltas`} />
          <StatTile label="Pendientes" value={fmtNum(q.byStatus.PENDING || 0)} />
          <StatTile label="Tiempo de respuesta" value={q.avgResponseHours === null ? "—" : q.avgResponseHours < 48 ? `${fmtNum(q.avgResponseHours)} h` : `${(q.avgResponseHours / 24).toLocaleString("es-AR", { maximumFractionDigits: 1 })} días`} hint="Promedio hasta el primer cambio de estado" />
        </div>
        <ShareBar items={statusItems(q.byStatus, QUOTE_STATUS, Object.keys(QUOTE_STATUS))} format={fmtNum} />
        {q.pendientes.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sin responder, las más viejas</p>
            <Table rows={q.pendientes} cols={[
              { key: "id", label: "#", render: (r) => <Link to={`/admin/ordenes/${r.id}`} className="font-semibold text-blue-600 hover:underline">#{r.id}</Link> },
              { key: "customerName", label: "Cliente" },
              { key: "dias", label: "Días esperando", align: "right", render: (r) => <span className={r.dias >= 3 ? "font-bold text-red-500" : ""}>{r.dias}</span> },
            ]} />
          </div>
        )}
      </Section>

      <Section title="Preparación y entrega" subtitle="Estado de entrega de los pedidos aprobados en el período">
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Pedidos aprobados" value={fmtNum(e.total)} />
          <StatTile label="Entregados" value={fmtNum(e.byFulfillment.ENTREGADO || 0)} hint={e.total ? `${fmtPct(((e.byFulfillment.ENTREGADO || 0) / e.total) * 100)} del total` : undefined} />
          <StatTile label="Días hasta entregar" value={e.avgDaysToDeliver === null ? "—" : e.avgDaysToDeliver.toLocaleString("es-AR", { maximumFractionDigits: 1 })} hint="Promedio aproximado (última actualización del pedido)" />
          <StatTile label="Demorados" value={fmtNum(e.demorados.length)} hint="Más de 3 días sin entregar" upIsGood={false} />
        </div>
        <ShareBar items={statusItems(e.byFulfillment, FULFILL, Object.keys(FULFILL))} format={fmtNum} />
        {e.demorados.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pedidos con más de 3 días sin entregar</p>
            <Table rows={e.demorados} cols={[
              { key: "id", label: "#", render: (r) => <Link to={`/admin/ordenes/${r.id}`} className="font-semibold text-blue-600 hover:underline">#{r.id}</Link> },
              { key: "customerName", label: "Cliente" },
              { key: "fulfillmentStatus", label: "Estado", render: (r) => FULFILL[r.fulfillmentStatus] || r.fulfillmentStatus },
              { key: "shippingMethod", label: "Entrega", render: (r) => ({ RETIRO: "Retiro", ENVIO: "Envío", CORREO_ARGENTINO: "Correo Arg." }[r.shippingMethod] || r.shippingMethod) },
              { key: "dias", label: "Días", align: "right", render: (r) => <span className="font-bold text-red-500">{r.dias}</span> },
            ]} />
          </div>
        )}
      </Section>

      <Section title="Carritos abandonados" subtitle="Carritos con productos y sin movimiento hace más de 24 horas (foto actual, no depende del período)" right={<Link to="/admin/clientes?tab=carts" className="text-xs font-semibold text-blue-600 hover:underline">Ver carritos activos →</Link>}>
        <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Carritos con productos" value={fmtNum(ca.activos)} />
          <StatTile label="Abandonados" value={fmtNum(ca.abandonados)} />
          <StatTile label="Valor abandonado $" value={fmtArs(ca.valorArs)} hint={ca.valorUsd > 0 ? `+ ${fmtUsd(ca.valorUsd)}` : undefined} />
          <StatTile label="Tasa de abandono" value={fmtPct(ca.activos ? (ca.abandonados / ca.activos) * 100 : null)} hint="Sobre los carritos con productos" upIsGood={false} />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Productos que más quedan en carritos</p>
            <Table rows={ca.topProductos} keyFn={(r) => r.productId} cols={[
              { key: "name", label: "Producto", render: (r) => <ProductCell name={r.name} image={r.image} /> },
              { key: "carritos", label: "Carritos", align: "right" },
              { key: "unidades", label: "Unid.", align: "right" },
            ]} empty="No hay carritos abandonados" />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Carritos abandonados de mayor valor</p>
            <Table rows={ca.masViejos} cols={[
              { key: "customer", label: "Cliente", render: (r) => <><p className="font-medium text-slate-800">{r.customer?.name}</p><p className="text-xs text-slate-400">{r.customer?.email}</p></> },
              { key: "items", label: "Ítems", align: "right" },
              { key: "dias", label: "Días", align: "right" },
              { key: "valorArs", label: "Valor $", align: "right", render: (r) => fmtArs(r.valorArs) },
            ]} empty="No hay carritos abandonados" />
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Cupones" subtitle="Uso de cupones en los pedidos aprobados del período">
          <div className="mb-4 grid grid-cols-3 gap-4">
            <StatTile label="Pedidos con cupón" value={fmtNum(cu.ordenesConCupon)} hint={cu.ordenesAprobadas ? `${fmtPct((cu.ordenesConCupon / cu.ordenesAprobadas) * 100)} de los pedidos` : undefined} />
            <StatTile label="Descuento otorgado" value={fmtArs(cu.descuentoTotalArs)} />
            <StatTile label="Cupones activos" value={fmtNum(cu.activos)} />
          </div>
          <Table rows={cu.lista} cols={[
            { key: "code", label: "Cupón", render: (r) => <><span className="font-mono font-semibold text-slate-800">{r.code}</span><span className="ml-2 text-xs text-slate-400">{r.discountType === "PERCENTAGE" ? `${r.discountValue} %` : fmtArs(r.discountValue)}</span></> },
            { key: "usos", label: "Usos", align: "right" },
            { key: "descuentoArs", label: "Descuento", align: "right", render: (r) => fmtArs(r.descuentoArs) },
            { key: "ventasArs", label: "Ventas que trajo", align: "right", render: (r) => fmtArs(r.ventasArs) },
          ]} empty="Ningún pedido del período usó cupón" />
        </Section>

        <Section title="Arrepentimiento / devoluciones" subtitle="Solicitudes creadas en el período" right={<Link to="/admin/devoluciones" className="text-xs font-semibold text-blue-600 hover:underline">Gestionar →</Link>}>
          <div className="mb-4 grid grid-cols-3 gap-4">
            <StatTile label="Solicitudes" value={fmtNum(d.total)} />
            <StatTile label="Tasa" value={fmtPct(d.tasa)} hint="Sobre pedidos aprobados" upIsGood={false} />
            <StatTile label="Pendientes" value={fmtNum(d.byStatus.PENDING || 0)} />
          </div>
          <Table rows={d.recientes} cols={[
            { key: "customerName", label: "Cliente", render: (r) => <><p className="font-medium text-slate-800">{r.customerName}</p>{r.orderId && <p className="text-xs text-slate-400">Pedido #{r.orderId}</p>}</> },
            { key: "reason", label: "Motivo", className: "max-w-[260px] text-xs text-slate-500" },
            { key: "status", label: "Estado", render: (r) => RET_STATUS[r.status] || r.status },
            { key: "createdAt", label: "Fecha", align: "right", render: (r) => fmtDate(r.createdAt) },
          ]} empty="Sin solicitudes en el período" />
        </Section>
      </div>
    </>
  );
}

// ─── Pestaña: Clientes ────────────────────────────────────────────────────────
function ClientesTab({ data }) {
  const { base: b, periodo: p, inactivos: inac, range } = data;
  const labels = p.altas.map((a) => bucketLabel(a.bucket, range.granularity));
  const tipo = (t) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t === "MAYORISTA" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{t === "MAYORISTA" ? "Mayorista" : "Minorista"}</span>;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Compradores (histórico)" value={fmtNum(b.compradores)} hint="Cuentas o emails con al menos una compra" />
        <StatTile label="Volvieron a comprar" value={fmtPct(b.tasaRecurrencia)} hint={`${fmtNum(b.recurrentes)} con 2 o más pedidos`} />
        <StatTile label="Compra promedio histórica" value={fmtArs(b.avgLtvArs)} hint={`${b.avgOrdenesPorComprador.toLocaleString("es-AR", { maximumFractionDigits: 1 })} pedidos por comprador`} />
        <StatTile label="Registrados" value={fmtNum(b.registrados)} hint={`${fmtNum(b.mayoristas)} mayoristas · ${fmtNum(b.pendientesAprobacion)} pendientes`} />
        <StatTile label="Registrados sin comprar" value={fmtNum(b.registradosSinCompra)} hint="Cuentas que nunca completaron un pedido" upIsGood={false} />
        <StatTile label="Inactivos +60 días" value={fmtNum(inac.d60)} hint={`${fmtNum(inac.d90)} hace más de 90 días`} upIsGood={false} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Compradores del período" subtitle="Quiénes compraron en el rango elegido: nuevos (primera compra) vs recurrentes">
          <div className="mb-4 grid grid-cols-3 gap-4">
            <StatTile label="Compradores" value={fmtNum(p.compradores)} />
            <StatTile label="Nuevos" value={fmtNum(p.nuevos)} />
            <StatTile label="Recurrentes" value={fmtNum(p.recurrentes)} />
          </div>
          <ShareBar items={[{ key: "nuevos", label: "Nuevos", value: p.nuevos }, { key: "rec", label: "Recurrentes", value: p.recurrentes }]} format={fmtNum} />
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            Los 10 clientes que más compraron explican <span className="font-bold text-slate-800">{fmtPct(p.top10ShareArs)}</span> de las ventas en pesos del período.
          </div>
        </Section>
        <Section title="Altas de clientes" subtitle="Cuentas creadas en el período">
          <p className="mb-2 text-2xl font-extrabold text-slate-800">{fmtNum(p.altasTotal)}</p>
          <LineChart labels={labels} series={[{ name: "Minoristas", values: p.altas.map((a) => a.minoristas) }, { name: "Mayoristas", values: p.altas.map((a) => a.mayoristas) }]} format={fmtNum} height={200} area={false} />
        </Section>
      </div>

      <Section title="Top 10 del período" subtitle="Por ventas en pesos">
        <Table rows={p.top10} cols={[
          { key: "name", label: "Cliente", render: (r) => <><p className="font-medium text-slate-800">{r.name}</p><p className="text-xs text-slate-400">{r.email}</p></> },
          { key: "type", label: "Tipo", render: (r) => tipo(r.type) },
          { key: "nuevo", label: "", render: (r) => (r.nuevo ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Nuevo</span> : null) },
          { key: "ordenes", label: "Órdenes", align: "right" },
          { key: "totalArs", label: "Ventas $", align: "right", render: (r) => fmtArs(r.totalArs) },
        ]} />
      </Section>

      <Section title="Clientes que dejaron de comprar" subtitle="Compraron alguna vez y llevan más de 60 días sin hacerlo, ordenados por lo que gastaron. Lista lista para una acción comercial.">
        <Table rows={inac.lista} cols={[
          { key: "name", label: "Cliente", render: (r) => <><p className="font-medium text-slate-800">{r.name}</p><p className="text-xs text-slate-400">{r.email}</p></> },
          { key: "type", label: "Tipo", render: (r) => tipo(r.type) },
          { key: "ordenes", label: "Órdenes", align: "right" },
          { key: "totalArs", label: "Total comprado", align: "right", render: (r) => <>{fmtArs(r.totalArs)}{r.totalUsd > 0 && <span className="ml-1 text-xs text-slate-400">+ {fmtUsd(r.totalUsd)}</span>}</> },
          { key: "lastOrder", label: "Última compra", align: "right", render: (r) => fmtDate(r.lastOrder) },
          { key: "diasSinComprar", label: "Días", align: "right", render: (r) => <span className={r.diasSinComprar > 90 ? "font-bold text-red-500" : "font-semibold text-amber-600"}>{r.diasSinComprar}</span> },
        ]} empty="Todos los compradores compraron en los últimos 60 días" />
      </Section>
    </>
  );
}

// ─── Pestaña: Stock ───────────────────────────────────────────────────────────
function StockTab({ data }) {
  const { inventario: inv, porAgotarse, sinMovimiento, capitalInmovilizado: cap, rotacion } = data;
  const dias = (d) => (d === null ? "—" : d === 0 ? <span className="font-bold text-red-500">Sin stock</span> : <span className={`font-bold ${d <= 7 ? "text-red-500" : d <= 15 ? "text-amber-600" : "text-slate-700"}`}>{d} días</span>);
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Inventario a costo $" value={fmtArs(inv.valorArs)} hint="Productos en pesos, sin los de stock ilimitado" />
        <StatTile label="Inventario a costo USD" value={fmtUsd(inv.valorUsd)} hint="Productos en dólares" />
        <StatTile label="Unidades en stock" value={fmtNum(inv.unidades)} />
        <StatTile label="Productos activos" value={fmtNum(inv.productos)} hint={`${fmtNum(inv.productosIlimitados)} con stock ilimitado`} />
        <StatTile label="Sin stock" value={fmtNum(inv.sinStock)} upIsGood={false} />
        <StatTile label="Con stock y sin costo" value={fmtNum(inv.sinCosto)} hint="No entran en el valor del inventario" upIsGood={false} />
      </div>

      <Section title="Se agotan en menos de 30 días" subtitle="Según el ritmo de venta de los últimos 30 días. Sirve para armar la próxima orden de compra antes de quedarse sin stock." right={<Link to="/admin/compras" className="text-xs font-semibold text-blue-600 hover:underline">Ir a Compras →</Link>}>
        <Table rows={porAgotarse} cols={[
          { key: "name", label: "Producto", render: (r) => <ProductCell name={r.name} image={r.image} sub={r.supplier || "Sin proveedor"} /> },
          { key: "category", label: "Categoría", className: "text-xs text-slate-500" },
          { key: "units", label: "Stock", align: "right", render: (r) => fmtNum(r.units) },
          { key: "sold30", label: "Vend. 30 d", align: "right", render: (r) => fmtNum(r.sold30) },
          { key: "diasDeStock", label: "Alcanza", align: "right", render: (r) => dias(r.diasDeStock) },
        ]} empty="Ningún producto con ventas recientes se agota en los próximos 30 días" />
      </Section>

      <Section title="Sin ventas en 90 días" subtitle={`Capital inmovilizado: ${fmtNum(cap.productos)} productos con stock, sin ninguna venta en 90 días y con más de un mes cargados. Valor a costo: ${fmtArs(cap.valorArs)}${cap.valorUsd > 0 ? ` + ${fmtUsd(cap.valorUsd)}` : ""}.`}>
        <Table rows={sinMovimiento} cols={[
          { key: "name", label: "Producto", render: (r) => <ProductCell name={r.name} image={r.image} sub={r.supplier || "Sin proveedor"} /> },
          { key: "category", label: "Categoría", className: "text-xs text-slate-500" },
          { key: "units", label: "Stock", align: "right", render: (r) => fmtNum(r.units) },
          { key: "valueArs", label: "A costo", align: "right", render: (r) => (r.sinCosto ? <span className="text-xs text-amber-600">sin costo</span> : r.currency === "USD" ? fmtUsd(r.valueUsd) : fmtArs(r.valueArs)) },
        ]} empty="Todo el stock tuvo movimiento en los últimos 90 días" />
      </Section>

      <Section title="Rotación por categoría" subtitle="Unidades vendidas en 30 días sobre unidades en stock: más alto = el stock gira más rápido">
        <BarList items={rotacion.filter((r) => r.rotacion !== null).sort((a, b) => b.rotacion - a.rotacion).slice(0, 15)} valueKey="rotacion" format={fmtPct} sub={(r) => `${fmtNum(r.sold30)} vendidas / ${fmtNum(r.unidades)} en stock · ${fmtNum(r.productos)} productos · inventario ${fmtArs(r.valorArs)}${r.valorUsd > 0 ? ` + ${fmtUsd(r.valorUsd)}` : ""}`} />
      </Section>
    </>
  );
}

// ─── Pestaña: Ofertas ─────────────────────────────────────────────────────────
function OfertasTab({ data }) {
  const ESTADO = { vigente: "bg-emerald-50 text-emerald-700", pausada: "bg-amber-50 text-amber-700", finalizada: "bg-slate-100 text-slate-500", programada: "bg-blue-50 text-blue-700" };
  if (data.ofertas.length === 0) {
    return <Section title="Ofertas / campañas"><p className="py-6 text-center text-sm text-slate-400">Todavía no hay campañas de oferta. Se crean desde Productos → Ofertas / Campañas.</p></Section>;
  }
  return (
    <>
      <Note>Cada campaña compara lo que vendieron SUS productos durante la vigencia contra el mismo lapso inmediatamente anterior. Facturación = precio × cantidad de las líneas en pesos. Si los productos ya vendían bien antes, una suba chica con menos ganancia significa que la oferta solo bajó el margen.</Note>
      {data.ofertas.map((o) => (
        <section key={o.id} className="card p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-bold text-slate-800">{o.name}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {o.discountType === "PERCENTAGE" ? `${o.discountValue} % off` : `${fmtArs(o.discountValue)} off`} · {o.appliesTo === "AMBOS" ? "minorista y mayorista" : o.appliesTo.toLowerCase()} · {fmtDate(o.startsAt)} → {fmtDate(o.endsAt)} · {fmtNum(o.productos)} productos{o.excluidos > 0 ? ` (${o.excluidos} excluidos)` : ""}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO[o.estado]}`}>{o.estado}</span>
          </div>
          {o.durante ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: "Unidades", now: o.durante.unidades, before: o.antes.unidades, delta: o.deltaUnidades, fmt: fmtNum },
                { label: "Ventas $", now: o.durante.ventasArs, before: o.antes.ventasArs, delta: o.deltaVentas, fmt: fmtArs },
                { label: "Ganancia $", now: o.durante.gananciaArs, before: o.antes.gananciaArs, delta: o.deltaGanancia, fmt: fmtArs },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{m.label}</p>
                  <p className="mt-1 text-xl font-extrabold text-slate-800">{m.fmt(m.now)}</p>
                  <p className="mt-1 text-xs text-slate-500"><DeltaBadge delta={m.delta} /> <span className="ml-1">antes: {m.fmt(m.before)}</span></p>
                </div>
              ))}
              <p className="text-xs text-slate-400 sm:col-span-3">Medido sobre {o.diasMedidos} días de campaña contra los {o.diasMedidos} días previos · {fmtNum(o.durante.ordenes)} órdenes durante, {fmtNum(o.antes.ordenes)} antes.</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">{o.estado === "programada" ? "Todavía no empezó." : "Sin productos para medir."}</p>
          )}
        </section>
      ))}
    </>
  );
}

// ─── Pestaña: Búsquedas y vistas ──────────────────────────────────────────────
function InteresTab({ data }) {
  const { resumen: r, topTerms, sinResultados, topProducts } = data;
  const conv = (p) => (
    <div className="min-w-[150px]">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100" style={{ gap: 2 }}>
        <div style={{ width: `${p.conversion}%`, background: "var(--viz-good)" }} />
        <div style={{ width: `${100 - p.conversion}%`, background: "var(--viz-muted-mark)" }} />
      </div>
      <p className="mt-1 text-xs text-slate-500" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span className="font-semibold text-emerald-700">{fmtPct(p.conversion)} compró</span> · {fmtPct(100 - p.conversion)} no
      </p>
    </div>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Visitantes" value={fmtNum(r.visitantes)} hint={`${fmtNum(r.paginas || 0)} páginas vistas`} />
        <StatTile label="Búsquedas" value={fmtNum(r.busquedas)} hint={`${fmtNum(r.terminosDistintos)} términos distintos`} />
        <StatTile label="Sin resultados" value={fmtNum(r.busquedasSinResultados)} hint={r.busquedas ? `${fmtPct((r.busquedasSinResultados / r.busquedas) * 100)} de las búsquedas` : undefined} upIsGood={false} />
        <StatTile label="Vistas de producto" value={fmtNum(r.vistas)} hint={`${fmtNum(r.productosVistos)} productos distintos`} />
        <StatTile label="Vistas por visitante" value={r.visitantes ? (r.vistas / r.visitantes).toLocaleString("es-AR", { maximumFractionDigits: 1 }) : "—"} />
        <StatTile label="Búsquedas por visitante" value={r.visitantes ? (r.busquedas / r.visitantes).toLocaleString("es-AR", { maximumFractionDigits: 1 }) : "—"} />
      </div>
      {data.desde && <p className="-mt-4 text-xs text-slate-400">Se registra desde el {fmtDate(data.desde)}. Los períodos anteriores no tienen datos porque el registro es nuevo.</p>}

      <Section title="Productos más vistos" subtitle="Vistas de la ficha del producto y qué porcentaje de los que la vieron terminó comprándolo (pedido aprobado, misma sesión o misma cuenta)">
        <Table rows={topProducts} keyFn={(p) => p.productId} cols={[
          { key: "name", label: "Producto", render: (p) => <ProductCell name={p.name} image={p.image} sub={!p.active ? "Inactivo" : undefined} /> },
          { key: "vistas", label: "Vistas", align: "right", render: (p) => fmtNum(p.vistas) },
          { key: "visitantes", label: "Visitantes", align: "right", render: (p) => fmtNum(p.visitantes) },
          { key: "compradores", label: "Compraron", align: "right", render: (p) => fmtNum(p.compradores) },
          { key: "conversion", label: "Compraron vs no", render: conv },
        ]} empty="Todavía no hay vistas registradas en este período" />
      </Section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Palabras más buscadas" subtitle="Lo que la gente escribe en el buscador de la tienda">
          <BarList items={topTerms.slice(0, 15).map((t) => ({ key: t.term, label: t.term, value: t.busquedas, sesiones: t.sesiones, resultadosProm: t.resultadosProm }))} format={(v) => `${fmtNum(v)}`} sub={(t) => `${fmtNum(t.sesiones)} visitantes · ${t.resultadosProm === null ? "?" : fmtNum(t.resultadosProm)} resultados en promedio`} />
          {topTerms.length > 15 && (
            <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-500">Ver las 30 primeras</summary><div className="mt-2"><Table rows={topTerms} keyFn={(t) => t.term} cols={[
              { key: "term", label: "Búsqueda", className: "font-medium text-slate-800" },
              { key: "busquedas", label: "Veces", align: "right" },
              { key: "sesiones", label: "Visitantes", align: "right" },
              { key: "resultadosProm", label: "Resultados", align: "right", render: (t) => (t.resultadosProm === null ? "—" : fmtNum(t.resultadosProm)) },
            ]} /></div></details>
          )}
        </Section>
        <Section title="Búsquedas sin resultados" subtitle="Productos que la gente busca y no encuentra: oportunidades de catálogo o de nombres / sinónimos">
          <Table rows={sinResultados} keyFn={(t) => t.term} cols={[
            { key: "term", label: "Búsqueda", className: "font-medium text-slate-800" },
            { key: "busquedas", label: "Veces", align: "right" },
            { key: "sesiones", label: "Visitantes", align: "right" },
          ]} empty="Ninguna búsqueda se quedó sin resultados" />
        </Section>
      </div>

      <Section title="Quiénes entraron y qué vieron" subtitle="Un visitante por fila (un navegador). Tocá una fila para ver su recorrido paso a paso: páginas, búsquedas, productos y si terminó comprando.">
        <VisitantesList visitantes={data.visitantes || []} />
      </Section>
    </>
  );
}

const DEVICE_ICON_SM = { celular: "📱", tablet: "📱", escritorio: "🖥️" };
const fmtTime = (d) => new Date(d).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

function VisitantesList({ visitantes }) {
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("todos");
  const list = visitantes.filter((v) => filter === "todos" || (filter === "clientes" && v.customer) || (filter === "buscaron" && v.busquedas > 0) || (filter === "compraron" && v.compras > 0));
  if (visitantes.length === 0) return <p className="py-6 text-center text-sm text-slate-400">Todavía no hay visitas registradas en este período</p>;
  const eventLine = (e) => {
    if (e.type === "SEARCH") return <><span className="font-semibold text-slate-800">Buscó</span> "{e.term}" <span className={e.results === 0 ? "text-red-500" : "text-slate-400"}>· {e.results === null ? "?" : e.results} resultados</span></>;
    if (e.type === "PRODUCT_VIEW") return <><span className="font-semibold text-slate-800">Vio</span> {e.productName}</>;
    if (e.type === "COMPRA") return <><span className="font-semibold text-emerald-700">Compró</span> <Link to={`/admin/ordenes/${e.orderId}`} className="text-blue-600 hover:underline">pedido #{e.orderId}</Link> · {fmtArs(e.total)} · {e.productos.join(", ")}</>;
    return <><span className="font-semibold text-slate-800">Entró a</span> {e.label || e.path}</>;
  };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {[["todos", `Todos (${visitantes.length})`], ["clientes", `Con cuenta (${visitantes.filter((v) => v.customer).length})`], ["buscaron", `Buscaron algo (${visitantes.filter((v) => v.busquedas > 0).length})`], ["compraron", `Compraron (${visitantes.filter((v) => v.compras > 0).length})`]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${filter === k ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Visitante</th>
              <th className="px-3 py-2">Última actividad</th>
              <th className="px-3 py-2">Qué hizo</th>
              <th className="px-3 py-2">Dispositivo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <>
                <tr key={v.sessionId} onClick={() => setOpen(open === v.sessionId ? null : v.sessionId)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    {v.customer ? (
                      <><p className="font-medium text-slate-800">{v.customer.name}</p><p className="text-xs text-slate-400">{v.customer.email} · {v.customer.type === "MAYORISTA" ? "Mayorista" : "Minorista"}</p></>
                    ) : (
                      <><p className="font-medium text-slate-600">Visitante anónimo</p><p className="font-mono text-xs text-slate-400">#{v.id}</p></>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDateTime(v.lastSeen)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {v.paginas > 0 && <span className="mr-2">{v.paginas} página{v.paginas !== 1 ? "s" : ""}</span>}
                    {v.busquedas > 0 && <span className="mr-2 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">{v.busquedas} búsqueda{v.busquedas !== 1 ? "s" : ""}</span>}
                    {v.vistas > 0 && <span className="mr-2 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{v.vistas} producto{v.vistas !== 1 ? "s" : ""}</span>}
                    {v.compras > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">{v.compras} compra{v.compras !== 1 ? "s" : ""}</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{v.device ? <>{DEVICE_ICON_SM[v.device]} {v.device}</> : "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-400">{open === v.sessionId ? "▲" : "▼"}</td>
                </tr>
                {open === v.sessionId && (
                  <tr key={`${v.sessionId}-d`} className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={5} className="px-3 py-3">
                      <ol className="space-y-1.5 border-l-2 border-slate-200 pl-4">
                        {v.eventos.map((e, i) => (
                          <li key={i} className="text-sm text-slate-600">
                            <span className="mr-2 font-mono text-xs text-slate-400" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(e.at)}</span>
                            {eventLine(e)}
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Pestaña: En vivo ─────────────────────────────────────────────────────────
const DEVICE_ICON = { celular: "📱", tablet: "📱", escritorio: "🖥️" };
function secs(s) {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}
function EnVivoTab({ data, refreshedAt }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">En la tienda ahora</p>
          <p className="mt-1 flex items-center gap-2 text-3xl font-extrabold text-slate-800">
            <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" /></span>
            {fmtNum(data.total)}
          </p>
        </div>
        <StatTile label="Clientes identificados" value={fmtNum(data.identificados)} hint="Con sesión iniciada" />
        <StatTile label="Visitantes anónimos" value={fmtNum(data.total - data.identificados)} />
        <StatTile label="Mirando un producto" value={fmtNum(data.sesiones.filter((s) => (s.path || "").startsWith("/producto/")).length)} />
      </div>
      <p className="-mt-4 text-xs text-slate-400">Se actualiza solo cada 10 segundos{refreshedAt ? ` · última actualización ${refreshedAt.toLocaleTimeString("es-AR")}` : ""}. Un visitante deja de contarse a los 75 segundos sin señal (cerró la pestaña o la dejó en segundo plano).</p>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title="Dónde están">
          <BarList items={data.porPagina.map((p) => ({ key: p.label, label: p.label, value: p.n }))} format={(v) => `${fmtNum(v)}`} />
        </Section>
        <div className="xl:col-span-2">
          <Section title="Quiénes están" subtitle="Cada fila es un navegador. Los anónimos se identifican por un código de sesión.">
            <Table rows={data.sesiones} keyFn={(s) => s.id} cols={[
              { key: "who", label: "Visitante", render: (s) => s.customerId ? (
                <><p className="font-medium text-slate-800">{s.customerName}</p><p className="text-xs text-slate-400">{s.customerEmail} · {s.customerType === "MAYORISTA" ? "Mayorista" : "Minorista"}</p></>
              ) : (
                <><p className="font-medium text-slate-600">Visitante anónimo</p><p className="font-mono text-xs text-slate-400">#{s.id}{s.isAdmin ? " · navegador con sesión admin (vos)" : ""}</p></>
              ) },
              { key: "label", label: "Está mirando", render: (s) => <><p className="text-slate-800">{s.label || s.path}</p><p className="truncate text-xs text-slate-400 max-w-[260px]">{s.path}</p></> },
              { key: "device", label: "Dispositivo", render: (s) => <span title={s.device}>{DEVICE_ICON[s.device] || "🖥️"} {s.device}</span> },
              { key: "secondsOnSite", label: "En el sitio", align: "right", render: (s) => secs(s.secondsOnSite) },
              { key: "secondsSinceSeen", label: "Última señal", align: "right", render: (s) => `hace ${secs(s.secondsSinceSeen)}` },
            ]} empty="No hay nadie en la tienda en este momento" />
          </Section>
        </div>
      </div>
    </>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function AdminAnalytics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "";
  const [preset, setPreset] = useState("30d");
  const [[dateFrom, dateTo], setRange] = useState(() => presetRange("30d"));
  const [granularity, setGranularity] = useState(null);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const reqId = useRef(0);

  const usesPeriod = !SIN_PERIODO.includes(tab);
  const cacheKey = usesPeriod ? `${tab}|${dateFrom}|${dateTo}|${tab === "" ? granularity || "" : ""}` : tab;

  const fetchTab = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const params = { dateFrom, dateTo, ...(tab === "" && granularity ? { granularity } : {}) };
      const call = { "": () => analyticsApi.ventas(params), origen: () => analyticsApi.origen(params), embudo: () => analyticsApi.embudo(params), clientes: () => analyticsApi.clientes(params), stock: () => analyticsApi.stock(), ofertas: () => analyticsApi.ofertas(), interes: () => analyticsApi.interes(params), envivo: () => analyticsApi.enVivo() }[tab];
      if (!call) return;
      const res = await call();
      if (id !== reqId.current) return;
      setData((prev) => ({ ...prev, [cacheKey]: res.data }));
      setRefreshedAt(new Date());
    } catch (err) {
      if (id !== reqId.current) return;
      console.error(err);
      setError(err.response?.data?.error || "No se pudieron cargar las analíticas");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [tab, dateFrom, dateTo, granularity, cacheKey]);

  useEffect(() => {
    if (data[cacheKey]) { setLoading(false); return; }
    fetchTab();
  }, [cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // En vivo: se refresca solo cada 10 s mientras la pestaña está abierta y visible
  useEffect(() => {
    if (tab !== "envivo") return;
    const tick = () => { if (document.visibilityState === "visible") fetchTab(); };
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, [tab, fetchTab]);

  const current = data[cacheKey];
  const applyPreset = (key) => { setPreset(key); setRange(presetRange(key)); };
  const setTab = (key) => setSearchParams(key ? { tab: key } : {});

  const content = useMemo(() => {
    if (!current) return null;
    switch (tab) {
      case "": return <VentasTab data={current} granularity={granularity} setGranularity={setGranularity} />;
      case "origen": return <OrigenTab data={current} />;
      case "embudo": return <EmbudoTab data={current} />;
      case "clientes": return <ClientesTab data={current} />;
      case "stock": return <StockTab data={current} />;
      case "ofertas": return <OfertasTab data={current} />;
      case "interes": return <InteresTab data={current} />;
      case "envivo": return <EnVivoTab data={current} refreshedAt={refreshedAt} />;
      default: return null;
    }
  }, [current, tab, granularity, refreshedAt]);

  return (
    <AdminLayout title="Analíticas">
      <div className="space-y-6">
        {/* Pestañas */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${tab === t.key ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"}`}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {/* Filtro de período — una sola fila, aplica a todo lo de abajo */}
        {usesPeriod && (
          <div className="card flex flex-wrap items-center gap-2 p-3 sm:p-4">
            <span className="mr-1 text-sm font-semibold text-slate-600">Período</span>
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => applyPreset(p.key)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${preset === p.key ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{p.label}</button>
            ))}
            <span className="mx-1 hidden h-5 border-l border-slate-200 sm:block" />
            <input type="date" value={dateFrom} max={dateTo} onChange={(e) => { setPreset(null); setRange([e.target.value, dateTo]); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <span className="text-sm text-slate-400">→</span>
            <input type="date" value={dateTo} min={dateFrom} onChange={(e) => { setPreset(null); setRange([dateFrom, e.target.value]); }} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {loading && current && <span className="ml-auto text-xs text-slate-400">Actualizando…</span>}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error} <button onClick={fetchTab} className="ml-2 font-semibold underline">Reintentar</button>
          </div>
        )}

        {!current && loading && (
          <div className="flex justify-center py-24"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" /></div>
        )}

        {/* Mientras recarga se mantiene el render anterior atenuado: sin saltos de layout */}
        {current && (
          <div className={`space-y-6 transition-opacity ${loading && tab !== "envivo" ? "opacity-50" : "opacity-100"}`}>
            {content}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
