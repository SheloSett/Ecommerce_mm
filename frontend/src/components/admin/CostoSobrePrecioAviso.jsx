import { preciosBajoCosto } from "../../utils/costCheck";
import { formatPrice } from "../../utils/formatPrice";

// Aviso en la ficha del producto (edición y alta) cuando el costo queda por encima de algún precio de venta
// cargado (26/11/2026, ver utils/costCheck.js). Solo avisa: se puede guardar igual.
// prices: [{ label, value }] con los precios que se ven en el formulario.
export default function CostoSobrePrecioAviso({ cost, prices, currency = "ARS" }) {
  const { bajos, ceroDeMas } = preciosBajoCosto(cost, prices);
  if (bajos.length === 0) return null;
  // "el precio minorista ($ 9.999) y el precio mayorista ($ 6.599)"
  const partes = bajos.map((b) => `${b.label.toLowerCase()} (${formatPrice(b.price, currency)})`);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", el ")} y el ${partes[partes.length - 1]}` : partes[0];
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p className="font-semibold">
        ⚠ El costo ({formatPrice(Number(cost), currency)}) es mayor que el {lista}.
        {ceroDeMas && " ¿Tiene un cero de más?"}
      </p>
      <p className="mt-0.5 text-xs text-red-700">
        Se puede guardar igual, pero cada venta de este producto va a figurar a pérdida y la ganancia de los pedidos va a dar mal.
      </p>
    </div>
  );
}
