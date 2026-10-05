// "Ordenar por" de los productos de un pedido: en el detalle del pedido (al verlo y al modificarlo)
// y en la hoja que se imprime (desde el detalle o desde la lista de órdenes). Se recuerda en el
// navegador (ORDER_ITEM_SORT_KEY).
//
// Módulo sin React a propósito: se testea con node --test (orderItemSort.test.js).

export const ORDER_ITEM_SORT_KEY = "igwt.pedido.ordenarPor";

export const ORDER_ITEM_SORTS = [
  { id: "carga",      label: "Como se cargó" },
  { id: "proveedor",  label: "Proveedor" },
  { id: "precioDesc", label: "Precio: mayor a menor" },
  { id: "precioAsc",  label: "Precio: menor a mayor" },
  { id: "nombre",     label: "Nombre" },
];

// Proveedor efectivo de una línea: el elegido para ese pedido ("Modificar pedido"), si no el de la
// variante, si no el del producto. Mismo criterio que la orden de compra.
export const itemSupplier = (item) => item?.supplier ?? item?.variant?.supplier ?? item?.product?.supplier ?? null;

const itemName = (item) => (item?.product?.name || item?.productName || item?.name || "").toString();
const byName = (a, b) => itemName(a).localeCompare(itemName(b), "es", { sensitivity: "base" });

// Devuelve una copia ordenada (no toca el array original). "carga" = como vino.
// opts.price(item) y opts.supplierName(item) permiten usarlo con las filas del modo edición, que
// tienen otra forma (precio de lista + % de descuento, proveedor elegido en un select).
export function sortOrderItems(items, criterion, opts = {}) {
  const list = [...(items || [])];
  const price = opts.price || ((i) => Number(i?.price) || 0);
  const supplierName = opts.supplierName || ((i) => itemSupplier(i)?.name || "");

  if (criterion === "proveedor") {
    // Alfabético por proveedor; "sin proveedor" al final; dentro de cada proveedor, por nombre.
    return list.sort((a, b) => {
      const sa = supplierName(a), sb = supplierName(b);
      if (!sa !== !sb) return sa ? -1 : 1;
      return sa.localeCompare(sb, "es", { sensitivity: "base" }) || byName(a, b);
    });
  }
  if (criterion === "precioDesc" || criterion === "precioAsc") {
    // Pesos y dólares no se comparan entre sí (no hay cotización): los de dólares van primero,
    // como en el catálogo, y cada bloque se ordena en la dirección elegida.
    const dir = criterion === "precioDesc" ? -1 : 1;
    return list.sort((a, b) => {
      const ua = (a?.currency || "ARS") === "USD" ? 1 : 0;
      const ub = (b?.currency || "ARS") === "USD" ? 1 : 0;
      if (ua !== ub) return ub - ua;
      return (price(a) - price(b)) * dir || byName(a, b);
    });
  }
  if (criterion === "nombre") return list.sort(byName);
  return list;
}

// Lee el criterio guardado (o "carga"). Seguro aunque el navegador no deje guardar.
export function loadOrderItemSort() {
  try {
    const v = localStorage.getItem(ORDER_ITEM_SORT_KEY);
    return ORDER_ITEM_SORTS.some((s) => s.id === v) ? v : "carga";
  } catch {
    return "carga";
  }
}
export function saveOrderItemSort(v) {
  try { localStorage.setItem(ORDER_ITEM_SORT_KEY, v); } catch { /* sin almacenamiento: no se recuerda */ }
}
