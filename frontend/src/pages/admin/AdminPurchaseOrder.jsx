import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import PurchaseRoutePanel, { orderGroupsByRoute, stopPrefix, stopWalk, routeSummaryHtml, useCostVisibility } from "../../components/admin/PurchaseRoutePanel";
import { ordersApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";
import { formatPrice } from "../../utils/formatPrice";
import { photoSizeCss, photoSizeControlsHtml, PHOTO_SIZE_KEYS } from "../../utils/printPhotoSize";

const formatDate = (d) =>
  new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ── Helpers de item ─────────────────────────────────────────────────────────
// Costo efectivo: el del ítem del pedido (editado por el admin) si tiene; si no, el de la
// variante; si no, el del producto. Permite ajustar el costo real del proveedor por pedido.
const itemCost  = (item) => (item.cost ?? item.variant?.cost ?? item.product?.cost ?? 0);
// Moneda de ese costo. El costo guardado en el ítem es un snapshot en la moneda de la línea
// vendida; el costo maestro de la variante/producto vive en Product.currency (la variante no tiene
// moneda propia, la hereda). Antes no se miraba y TODO salía con formato de pesos: un producto de
// USD 500 se imprimía como "$ 500,00".
const itemCostCurrency = (item) =>
  ((item.cost != null ? (item.currency || "ARS") : (item.product?.currency || "ARS")) === "USD" ? "USD" : "ARS");

// ── Plata por moneda ────────────────────────────────────────────────────────
// Pesos y dólares NUNCA se suman entre sí (no hay cotización en el sistema, ver formatPrice).
// Los totales de la orden de compra son un { ARS, USD } y se muestran en un renglón por moneda.
const emptyMoney = () => ({ ARS: 0, USD: 0 });
const addMoney = (acc, item, qty = item.quantity) => {
  acc[itemCostCurrency(item)] += itemCost(item) * qty;
  return acc;
};
// Solo las monedas con monto. Si no hay nada, muestra "$ 0" para no dejar el renglón vacío.
const moneyParts = (m) => {
  const parts = [];
  if (m.ARS || !m.USD) parts.push(formatPrice(m.ARS, "ARS"));
  if (m.USD) parts.push(formatPrice(m.USD, "USD"));
  return parts;
};
const moneyHtml = (m) => moneyParts(m).join("<br>");
// Foto: la específica de la variante si tiene, si no la primera del producto.
const itemPhoto = (item) => (item.variant?.images?.[0]) || item.product?.images?.[0] || null;
// Calle y teléfono del proveedor, junto al nombre (en pantalla y en la hoja impresa). Vacío si no
// tiene ninguno cargado. Antes no se mostraban y la dirección se escribía dentro del nombre.
const supplierContact = (g) => [g.street && `📍 ${g.street}`, g.phone && `📞 ${g.phone}`].filter(Boolean).join(" · ");

// Página de "Orden de compra a proveedores": el admin selecciona qué productos del pedido
// hay que comprar y genera una hoja de impresión agrupada por proveedor (con costo/cantidad).
// Es solo para imprimir — no toca la base de datos ni el stock del producto publicado.
export default function AdminPurchaseOrder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set()); // ids de order_items tildados

  useEffect(() => {
    let alive = true;
    setLoading(true);
    ordersApi.getById(id)
      .then((res) => {
        if (!alive) return;
        setOrder(res.data);
        // Por defecto todos los items quedan seleccionados
        setSelected(new Set((res.data.items || []).map((i) => i.id)));
      })
      .catch(() => toast.error("No se pudo cargar el pedido"))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  // Agrupar items por proveedor. "Sin proveedor" (key "none") va último.
  const groups = useMemo(() => {
    const map = new Map();
    for (const item of (order?.items || [])) {
      // Proveedor de la VARIANTE si lo tiene (item.variant lo adjunta el backend), sino el del producto.
      // Antes: const sup = item.product?.supplier;
      // Antes: item.variant?.supplier ?? item.product?.supplier — ahora primero el proveedor elegido
      // para la línea en "Modificar pedido" (OrderItem.supplierId).
      const sup  = item.supplier ?? item.variant?.supplier ?? item.product?.supplier;
      const key  = sup?.id != null ? `s${sup.id}` : "none";
      const name = sup?.name || "Sin proveedor";
      if (!map.has(key)) map.set(key, { key, name, street: sup?.street || "", phone: sup?.phone || "", items: [] });
      map.get(key).items.push(item);
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [order]);

  const toggle = (itemId) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });

  const toggleGroup = (group, allSelected) =>
    setSelected((prev) => {
      const next = new Set(prev);
      group.items.forEach((i) => (allSelected ? next.delete(i.id) : next.add(i.id)));
      return next;
    });

  // Orden de los proveedores (alfabético o por recorrido a pie, ver PurchaseRoutePanel). Entran al
  // recorrido los que tienen algo seleccionado; "Sin proveedor" no tiene dirección y va al final.
  const [route, setRoute] = useState(null);
  const routeGroups = useMemo(() => groups
    .filter((g) => g.key !== "none")
    .map((g) => ({
      key: g.key,
      name: g.name,
      street: g.street,
      units: g.items.reduce((s, i) => (selected.has(i.id) ? s + i.quantity : s), 0),
    }))
    .filter((g) => g.units > 0), [groups, selected]);
  const orderedGroups = useMemo(() => orderGroupsByRoute(groups, route), [groups, route]);
  // Costos en la hoja impresa, por proveedor (por defecto sí). Ver useCostVisibility.
  const { showsCosts, setShowsCosts, setAllCosts } = useCostVisibility();
  const costsAll  = groups.every((g) => showsCosts(g.key));
  const costsNone = groups.every((g) => !showsCosts(g.key));

  const allItems = order?.items || [];
  const allSelected = allItems.length > 0 && allItems.every((i) => selected.has(i.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(allItems.map((i) => i.id)));

  // Subtotal de un grupo considerando solo los items seleccionados, separado por moneda
  const groupSubtotal = (group) =>
    group.items.reduce((acc, i) => (selected.has(i.id) ? addMoney(acc, i) : acc), emptyMoney());

  const grandTotal = groups.reduce((acc, g) => {
    const sub = groupSubtotal(g);
    acc.ARS += sub.ARS; acc.USD += sub.USD;
    return acc;
  }, emptyMoney());
  const selectedCount = selected.size;

  // ── Impresión ───────────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!order || selectedCount === 0) return;

    // Solo grupos con al menos un item seleccionado, en el orden elegido (alfabético o recorrido)
    // Antes: const printGroups = groups
    const printGroups = orderedGroups
      .map((g) => ({ ...g, items: g.items.filter((i) => selected.has(i.id)) }))
      .filter((g) => g.items.length > 0);

    const groupsHtml = printGroups.map((g) => {
      // Sin costos: la línea queda sin precio ni total y el proveedor sin subtotal.
      const withCosts = showsCosts(g.key);
      const rows = g.items.map((item) => {
        const photo = itemPhoto(item);
        // class="ph": el tamaño se elige en la hoja (Chico / Mediano / Grande, ver printPhotoSize.js).
        // Antes: width:48px;height:48px fijos, y la celda de la foto de 56px.
        const imgHtml = photo
          ? `<img src="${getImageUrl(photo)}" alt="" class="ph" style="object-fit:cover;border-radius:6px;border:1px solid #e2e8f0" />`
          : `<div class="ph" style="background:#f1f5f9;border-radius:6px;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:18px">📦</div>`;
        const cost = itemCost(item);
        const cur  = itemCostCurrency(item);
        const lineTotal = cost * item.quantity;
        const variantHtml = item.variantLabel
          ? `<div style="font-size:10px;color:#64748b;margin-top:1px">${item.variantLabel.split(" | ").join(" · ")}</div>`
          : "";
        return `
        <tr>
          <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle;width:calc(var(--ph) + 16px)">${imgHtml}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle">
            <div style="font-weight:600;font-size:12px;color:#1e293b">${item.product?.name || "Producto"}</div>
            ${variantHtml}
          </td>
          <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;text-align:center;vertical-align:middle;white-space:nowrap">
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Cant.</div>
            <div style="font-size:15px;font-weight:800;color:#1e293b">${item.quantity}</div>
          </td>
          <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:middle;white-space:nowrap">
            ${withCosts ? `
            <div style="font-size:10px;color:#94a3b8">${formatPrice(cost, cur)} c/u</div>
            <div style="font-size:12px;font-weight:700;color:#1e293b">${formatPrice(lineTotal, cur)}</div>` : ""}
          </td>
        </tr>`;
      }).join("");

      const subtotal = g.items.reduce((acc, i) => addMoney(acc, i), emptyMoney());
      const subtotalHtml = withCosts
        ? `<div style="text-align:right;padding:5px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;font-size:11px">
          Subtotal ${g.name}: <strong style="font-size:13px;color:#1e293b">${moneyHtml(subtotal)}</strong>
        </div>`
        : "";
      // Con recorrido: número de parada delante del nombre y metros desde la parada anterior.
      const contact = [supplierContact(g), stopWalk(route, g.key)].filter(Boolean).join(" · ");
      return `
      <section style="margin-bottom:12px;break-inside:avoid">
        <div style="background:#1e293b;color:#fff;padding:5px 10px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:baseline;gap:4px 12px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase">${stopPrefix(route, g.key)}🏭 ${g.name}</span>
          ${contact ? `<span style="font-size:11px;font-weight:600">${contact}</span>` : ""}
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none">
          <tbody>${rows}</tbody>
        </table>
        ${subtotalHtml}
      </section>`;
    }).join("");

    // El TOTAL suma solo los proveedores que se imprimen con costos (si sumara los otros, dejaría
    // adivinar lo que se ocultó). Si ninguno lleva costos, la hoja sale sin total.
    // Antes: const printTotal = printGroups.reduce(...) sobre todos los proveedores
    const costGroups = printGroups.filter((g) => showsCosts(g.key));
    const printTotal = costGroups.reduce(
      (acc, g) => g.items.reduce((a, i) => addMoney(a, i), acc), emptyMoney());
    const withoutCosts = printGroups.filter((g) => !showsCosts(g.key)).map((g) => g.name);
    const totalHtml = costGroups.length === 0 ? "" : `
    <div style="font-size:16px;font-weight:900;text-align:right;line-height:1.35">TOTAL: ${moneyHtml(printTotal)}
      ${withoutCosts.length ? `<div style="font-size:10px;font-weight:600;opacity:.85">sin contar: ${withoutCosts.join(", ")}</div>` : ""}
    </div>`;
    const totalUnits = printGroups.reduce(
      (s, g) => s + g.items.reduce((ss, i) => ss + i.quantity, 0), 0);

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Orden de compra — Pedido #${order.id}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #1e293b; background: #f1f5f9; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 720px; max-width: 100%; margin: 0 auto; background: #fff; padding: 28px; }
    .header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 2px solid #1e40af; margin-bottom: 16px; }
    .logo-name { font-size: 18px; font-weight: 900; color: #1e40af; white-space: nowrap; }
    .doc-title { background: #1e40af; color: #fff; border-radius: 8px; padding: 5px 14px; font-size: 13px; font-weight: 900; white-space: nowrap; }
    .meta { font-size: 10px; color: #94a3b8; text-align: right; margin-top: 4px; white-space: nowrap; }
    .grand { margin-top: 8px; padding: 10px 16px; background: #1e40af; color: #fff; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
    .footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #cbd5e1; font-size: 9px; text-align: center; }
    /* @page + medidas en mm: ancla la hoja al ancho imprimible real de un A4 para que el
       navegador imprima al 100% (sin agrandar el contenido como pasaba antes). */
    @page { size: A4 portrait; margin: 12mm; }
    @media print {
      html, body { width: 186mm; background: #fff; }
      .page { width: 186mm; max-width: 186mm; padding: 0; margin: 0 auto; }
      section { break-inside: avoid; }
      .print-btn { display: none !important; }
    }
    ${photoSizeCss(48)}
  </style>
</head>
<body>
<div class="print-btn" style="position:fixed;top:12px;right:12px;z-index:9999;display:flex;align-items:center;gap:8px">
  ${photoSizeControlsHtml(PHOTO_SIZE_KEYS.purchases, 48)}
  <button onclick="window.print()" style="background:#1e40af;color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer">🖨️ Imprimir</button>
</div>
<div class="page">
  <div class="header">
    <div><div class="logo-name">⚡ IGWT Store</div></div>
    <div>
      <div class="doc-title">Orden de compra · Pedido #${order.id}</div>
      <div class="meta">${formatDate(order.createdAt)}${order.customerName ? ` · ${order.customerName}` : ""}</div>
    </div>
  </div>

  ${routeSummaryHtml(route, Object.fromEntries(printGroups.map((g) => [g.key, g.name])))}

  ${groupsHtml}

  <div class="grand">
    <div style="font-size:11px;opacity:.85">${totalUnits} unidad(es) a comprar</div>
    ${totalHtml}
  </div>

  <div class="footer">Orden de compra generada el ${new Date().toLocaleString("es-AR")} · IGWT Store · Documento interno</div>
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, "_blank", "width=860,height=800");
    if (win) win.onload = () => { win.focus(); URL.revokeObjectURL(url); };
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (!order) {
    return (
      <AdminLayout>
        <div className="text-center py-32 text-slate-400">
          <p className="text-lg">Pedido no encontrado</p>
          <button onClick={() => navigate("/admin/ordenes")} className="mt-4 text-blue-600 hover:underline text-sm">
            ← Volver a pedidos
          </button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/admin/ordenes/${order.id}`)}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 transition-colors"
              title="Volver al pedido"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Orden de compra</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Pedido #{order.id} · seleccioná qué productos comprar al proveedor</p>
            </div>
          </div>
          <button
            onClick={handlePrint}
            disabled={selectedCount === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Imprimir orden de compra
          </button>
        </div>

        {/* Toolbar: seleccionar todo + resumen */}
        <div className="flex items-center justify-between gap-3 flex-wrap bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
          <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Seleccionar todo
              </span>
            </label>
            {/* Costos en la hoja impresa para todos los proveedores de una vez (a medias si hay de los dos) */}
            <label className="flex items-center gap-2 cursor-pointer select-none" title="Destildalo para imprimir la hoja sin costos">
              <input
                type="checkbox"
                checked={costsAll}
                ref={(el) => { if (el) el.indeterminate = !costsAll && !costsNone; }}
                onChange={() => setAllCosts(groups.map((g) => g.key), !costsAll)}
                className="w-4 h-4 accent-blue-600"
              />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Costos en la hoja</span>
            </label>
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-semibold">{selectedCount}</span> de {allItems.length} seleccionados ·
            <span className="ml-1">Total: <span className="font-bold text-slate-800 dark:text-slate-100">{moneyParts(grandTotal).join(" + ")}</span></span>
          </div>
        </div>

        {/* Orden de los proveedores: alfabético o por recorrido a pie */}
        <PurchaseRoutePanel groups={routeGroups} onChange={setRoute} />

        {/* Grupos por proveedor, en el orden elegido */}
        {/* Antes: {groups.map((group) => { */}
        {orderedGroups.map((group) => {
          const groupAllSelected = group.items.every((i) => selected.has(i.id));
          return (
            <div key={group.key} className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
              {/* Cabecera del proveedor */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={groupAllSelected}
                    onChange={() => toggleGroup(group, groupAllSelected)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <div className="min-w-0">
                    <span className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      {stopPrefix(route, group.key) && (
                        <span className="text-blue-600 dark:text-blue-400">{stopPrefix(route, group.key).trim()}</span>
                      )}
                      🏭 {group.name}
                      {group.key === "none" && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 px-1.5 py-0.5 rounded">
                          sin asignar
                        </span>
                      )}
                    </span>
                    {supplierContact(group) && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{supplierContact(group)}</div>
                    )}
                  </div>
                </label>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                  {/* Si se destilda, la hoja impresa sale sin los costos de este proveedor */}
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showsCosts(group.key)}
                      onChange={(e) => setShowsCosts(group.key, e.target.checked)}
                      className="w-3.5 h-3.5 accent-blue-600"
                    />
                    Costos en la hoja
                  </label>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    Subtotal: <span className="font-bold text-slate-800 dark:text-slate-100">{moneyParts(groupSubtotal(group)).join(" + ")}</span>
                  </span>
                </div>
              </div>

              {/* Items del proveedor */}
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {group.items.map((item) => {
                  const isSel = selected.has(item.id);
                  const photo = itemPhoto(item);
                  const cost = itemCost(item);
                  const cur  = itemCostCurrency(item);
                  return (
                    <label
                      key={item.id}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${isSel ? "bg-blue-50/40 dark:bg-blue-500/5" : "opacity-55 hover:opacity-100"}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(item.id)}
                        className="w-4 h-4 accent-blue-600 shrink-0"
                      />
                      {/* Foto */}
                      {photo ? (
                        <img src={getImageUrl(photo)} alt="" className="w-12 h-12 object-cover rounded-lg border border-slate-200 dark:border-slate-600 shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xl shrink-0">📦</div>
                      )}
                      {/* Nombre + variante */}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.product?.name || "Producto"}</div>
                        {item.variantLabel && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{item.variantLabel.split(" | ").join(" · ")}</div>
                        )}
                        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{formatPrice(cost, cur)} c/u</div>
                      </div>
                      {/* Cantidad */}
                      <div className="text-center shrink-0">
                        <div className="text-[9px] uppercase tracking-wide text-slate-400">Cant.</div>
                        <div className="text-base font-bold text-slate-800 dark:text-slate-100">{item.quantity}</div>
                      </div>
                      {/* Subtotal línea */}
                      <div className="text-right shrink-0 w-24">
                        <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{formatPrice(cost * item.quantity, cur)}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Total final */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 bg-blue-600 text-white rounded-xl">
          <span className="text-sm opacity-90">Total de la compra ({selectedCount} ítem{selectedCount !== 1 ? "s" : ""})</span>
          <span className="text-xl font-extrabold text-right leading-tight">
            {moneyParts(grandTotal).map((t) => <div key={t}>{t}</div>)}
          </span>
        </div>
      </div>
    </AdminLayout>
  );
}
