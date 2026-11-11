// Cómo se aplica un número de stock que llega del panel de productos (edición completa, edición rápida y
// editor de variantes).
//
// stock: lo que el admin escribió. stockBase: lo que la pantalla mostraba cuando abrió el formulario.
// Con stockBase se aplica la DIFERENCIA (escribió 15 donde decía 10 → +5): si mientras editaba entró una
// venta, no se pisa. Antes se guardaba el número tal cual, y guardar un producto (aunque fuera para
// cambiarle la descripción) devolvía el stock al de cuando se abrió el formulario, borrando las ventas
// del medio. Ahora el panel manda el stock solo si el admin lo cambió.
//
// Sin stockBase (una pantalla vieja que quedó abierta, otros usos) se carga el número tal cual, como antes.
// Un número vacío o inválido cuenta como 0, igual que antes. El resultado nunca queda negativo.
//
// Devuelve null si no vino stock; si no, { typed, delta } o { typed, setTo }, o { typed, none: true }
// cuando la diferencia es 0.
function panelStockChange(stock, stockBase) {
  if (stock === undefined || stock === null) return null;
  const typed = Math.max(0, parseInt(stock, 10) || 0);
  const base = parseInt(stockBase, 10);
  if (stockBase !== undefined && stockBase !== null && stockBase !== "" && Number.isInteger(base)) {
    const delta = typed - base;
    return delta === 0 ? { typed, none: true } : { typed, delta };
  }
  return { typed, setTo: typed };
}

// Opciones para services/stock.service.js adjustStock a partir de panelStockChange.
function panelStockOptions(change) {
  if (!change || change.none) return null;
  return change.delta !== undefined ? { delta: change.delta } : { setTo: change.setTo };
}

// Para la respuesta: si lo que quedó no es lo que escribió el admin (entró una venta o una compra
// mientras editaba), el panel se lo avisa. null si quedó lo que escribió.
function stockNotice(change, result) {
  if (!change || !result?.ok || result.after === change.typed) return null;
  return { typed: change.typed, after: result.after };
}

module.exports = { panelStockChange, panelStockOptions, stockNotice };
