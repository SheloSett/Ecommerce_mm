import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { ordersApi, getImageUrl } from "../../services/api";
import toast from "react-hot-toast";

const formatPrice = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n ?? 0);

const formatDate = (d) =>
  new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// ── Helpers de item ─────────────────────────────────────────────────────────
// Costo efectivo: el del ítem del pedido (editado por el admin) si tiene; si no, el de la
// variante; si no, el del producto. Permite ajustar el costo real del proveedor por pedido.
const itemCost  = (item) => (item.cost ?? item.variant?.cost ?? item.product?.cost ?? 0);
// Foto: la específica de la variante si tiene, si no la primera del producto.
const itemPhoto = (item) => (item.variant?.images?.[0]) || item.product?.images?.[0] || null;

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
      const sup  = item.product?.supplier;
      const key  = sup?.id != null ? `s${sup.id}` : "none";
      const name = sup?.name || "Sin proveedor";
      if (!map.has(key)) map.set(key, { key, name, items: [] });
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

  const allItems = order?.items || [];
  const allSelected = allItems.length > 0 && allItems.every((i) => selected.has(i.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(allItems.map((i) => i.id)));

  // Subtotal de un grupo considerando solo los items seleccionados
  const groupSubtotal = (group) =>
    group.items.reduce((s, i) => (selected.has(i.id) ? s + itemCost(i) * i.quantity : s), 0);

  const grandTotal = groups.reduce((s, g) => s + groupSubtotal(g), 0);
  const selectedCount = selected.size;

  // ── Impresión ───────────────────────────────────────────────────────────────
  const handlePrint = () => {
    if (!order || selectedCount === 0) return;

    // Solo grupos con al menos un item seleccionado
    const printGroups = groups
      .map((g) => ({ ...g, items: g.items.filter((i) => selected.has(i.id)) }))
      .filter((g) => g.items.length > 0);

    const groupsHtml = printGroups.map((g) => {
      const rows = g.items.map((item) => {
        const photo = itemPhoto(item);
        const imgHtml = photo
          ? `<img src="${getImageUrl(photo)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0" />`
          : `<div style="width:48px;height:48px;background:#f1f5f9;border-radius:6px;border:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:18px">📦</div>`;
        const cost = itemCost(item);
        const lineTotal = cost * item.quantity;
        const variantHtml = item.variantLabel
          ? `<div style="font-size:10px;color:#64748b;margin-top:1px">${item.variantLabel.split(" | ").join(" · ")}</div>`
          : "";
        return `
        <tr>
          <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle;width:56px">${imgHtml}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle">
            <div style="font-weight:600;font-size:12px;color:#1e293b">${item.product?.name || "Producto"}</div>
            ${variantHtml}
          </td>
          <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;text-align:center;vertical-align:middle;white-space:nowrap">
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Cant.</div>
            <div style="font-size:15px;font-weight:800;color:#1e293b">${item.quantity}</div>
          </td>
          <td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:middle;white-space:nowrap">
            <div style="font-size:10px;color:#94a3b8">${formatPrice(cost)} c/u</div>
            <div style="font-size:12px;font-weight:700;color:#1e293b">${formatPrice(lineTotal)}</div>
          </td>
        </tr>`;
      }).join("");

      const subtotal = g.items.reduce((s, i) => s + itemCost(i) * i.quantity, 0);
      return `
      <section style="margin-bottom:12px;break-inside:avoid">
        <div style="background:#1e293b;color:#fff;padding:5px 10px;border-radius:6px 6px 0 0;font-size:11px;font-weight:800;letter-spacing:.03em;text-transform:uppercase">
          🏭 ${g.name}
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none">
          <tbody>${rows}</tbody>
        </table>
        <div style="text-align:right;padding:5px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;font-size:11px">
          Subtotal ${g.name}: <strong style="font-size:13px;color:#1e293b">${formatPrice(subtotal)}</strong>
        </div>
      </section>`;
    }).join("");

    const printTotal = printGroups.reduce(
      (s, g) => s + g.items.reduce((ss, i) => ss + itemCost(i) * i.quantity, 0), 0);
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
  </style>
</head>
<body>
<div class="print-btn" style="position:fixed;top:12px;right:12px;z-index:9999">
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

  ${groupsHtml}

  <div class="grand">
    <div style="font-size:11px;opacity:.85">${totalUnits} unidad(es) a comprar</div>
    <div style="font-size:16px;font-weight:900">TOTAL: ${formatPrice(printTotal)}</div>
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
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-semibold">{selectedCount}</span> de {allItems.length} seleccionados ·
            <span className="ml-1">Total: <span className="font-bold text-slate-800 dark:text-slate-100">{formatPrice(grandTotal)}</span></span>
          </div>
        </div>

        {/* Grupos por proveedor */}
        {groups.map((group) => {
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
                  <span className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                    🏭 {group.name}
                    {group.key === "none" && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 px-1.5 py-0.5 rounded">
                        sin asignar
                      </span>
                    )}
                  </span>
                </label>
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  Subtotal: <span className="font-bold text-slate-800 dark:text-slate-100">{formatPrice(groupSubtotal(group))}</span>
                </span>
              </div>

              {/* Items del proveedor */}
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {group.items.map((item) => {
                  const isSel = selected.has(item.id);
                  const photo = itemPhoto(item);
                  const cost = itemCost(item);
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
                        <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{formatPrice(cost)} c/u</div>
                      </div>
                      {/* Cantidad */}
                      <div className="text-center shrink-0">
                        <div className="text-[9px] uppercase tracking-wide text-slate-400">Cant.</div>
                        <div className="text-base font-bold text-slate-800 dark:text-slate-100">{item.quantity}</div>
                      </div>
                      {/* Subtotal línea */}
                      <div className="text-right shrink-0 w-24">
                        <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{formatPrice(cost * item.quantity)}</div>
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
          <span className="text-xl font-extrabold">{formatPrice(grandTotal)}</span>
        </div>
      </div>
    </AdminLayout>
  );
}
