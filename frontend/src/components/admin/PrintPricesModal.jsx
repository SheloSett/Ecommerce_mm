import { useEffect } from "react";

// Pregunta antes de imprimir una orden si la hoja lleva los precios. Mismo criterio que la casilla
// "Costos en la hoja" de la orden de compra: sin precios sirve para armar el pedido o entregarlo sin
// que se vean los montos. Lo usan la lista de órdenes (individual y masiva) y el detalle.
//
// title: texto del encabezado ("Imprimir orden #167", "Imprimir 3 órdenes").
// onChoose(withPrices): se llama con true/false al elegir; el que abre la ventana es el padre.
export default function PrintPricesModal({ title, onChoose, onCancel }) {
  // Escape cierra, como un cancelar. Enter imprime con precios (el botón tiene el foco).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-900">🖨️ {title}</h3>
        <p className="text-sm text-slate-600">
          ¿La hoja lleva los precios? Sin precios salen los productos y las cantidades, sin precio por
          unidad, sin total por línea y sin totales.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={onCancel}
            className="flex-1 min-w-[6rem] px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => onChoose(false)}
            className="flex-1 min-w-[7rem] px-4 py-2 rounded-xl text-sm font-bold border-2 border-blue-600 text-blue-700 hover:bg-blue-50"
          >
            Sin precios
          </button>
          <button
            autoFocus
            onClick={() => onChoose(true)}
            className="flex-1 min-w-[7rem] px-4 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700"
          >
            Con precios
          </button>
        </div>
      </div>
    </div>
  );
}
