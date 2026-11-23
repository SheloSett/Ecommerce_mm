// Aviso del descuento por monto (Black Friday, etc.) en el carrito lateral, la página del carrito y el
// checkout: "Sumá $35.000 y llevás 10% off" con una barra de avance, o "Ya tenés 10% off" en el último
// escalón. summary = cartPromoSummary() de utils/cartPromo.js. Sin promo vigente no muestra nada.
// Colores: los mismos que el indicador de mínimo mayorista, que ya tienen su versión en modo oscuro.
import { formatPrice } from "../utils/formatPrice";

export default function CartPromoNotice({ summary }) {
  if (!summary?.available) return null;
  const { promo, percent, next } = summary;
  if (!next && !percent) return null;

  if (!next) {
    return (
      <p className="text-xs font-semibold text-[#006b2c]">
        🎉 Ya tenés {percent}% off por {promo.name}
      </p>
    );
  }

  const progreso = Math.min(100, Math.max(0, ((next.minAmount - next.missing) / next.minAmount) * 100));
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-[#006b2c]">
        🎉 {next.promo.name}: sumá {formatPrice(next.missing)} y llevás {next.percent}% off
        {percent > 0 && <span className="font-normal text-[#565e74]"> (hoy tenés {percent}%)</span>}
      </p>
      <div className="w-full h-1.5 bg-[#dce9ff] rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-[#00873a] transition-all duration-500" style={{ width: `${progreso}%` }} />
      </div>
    </div>
  );
}
