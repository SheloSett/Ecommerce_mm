// Aviso del descuento por monto (Black Friday, etc.) en el carrito lateral, la página del carrito y el
// checkout: "Sumá $35.000 y llevás 10% off" con una barra de avance, o "Ya tenés 10% off" en el último
// escalón. summary = cartPromoSummary() de utils/cartPromo.js. Sin promo vigente no muestra nada.
//
// Antes: verde fijo, con los colores del indicador de mínimo mayorista. Pedido de la clienta (23/11/2026):
// que se vea con el estilo de la promo, como las campañas. Ahora usa el estilo elegido en Productos →
// Descuento por monto (Black Friday, Cyber Monday, color propio...), en versión franja (.cc-bar +
// .cc-promo-note en category-cards.css). Esos estilos pintan su propio fondo: se ven igual en tema claro
// y oscuro.
import { formatPrice } from "../utils/formatPrice";
import { campaignStyle } from "./CampaignCard";
import { textColorFor } from "../utils/campaignCard";
import "./category-cards.css";

export default function CartPromoNotice({ summary }) {
  if (!summary?.available) return null;
  const { promo, percent, next } = summary;
  if (!next && !percent) return null;

  // La promo que se está anunciando: la del próximo escalón, o la que ya se tiene
  const shown = next ? next.promo : promo;
  const style = campaignStyle(shown);
  const colorVars = style === "color"
    ? { "--cc-bg": shown.cardColor || "#c2185b", "--cc-fg": textColorFor(shown.cardColor || "#c2185b") }
    : undefined;

  // Promo para algunos productos: " (en Audio y Cables)" — el monto y el % son solo de esos
  const scopeOf = (p) => (p?.scopeLabel ? ` (${p.scopeLabel.charAt(0).toLowerCase()}${p.scopeLabel.slice(1)})` : "");
  // Promo solo para mayoristas (pedido de la clienta, 25/11/2026): una línea arriba que lo dice
  const excl = shown.appliesTo === "MAYORISTA" ? <span className="cc-pn-excl">Exclusivo para mayoristas</span> : null;

  if (!next) {
    return (
      <div className={`cc-bar cc-${style} cc-promo-note`} style={colorVars}>
        {excl}
        <span className="cc-bar-text">🎉 Ya tenés {percent}% off por {promo.name}{scopeOf(promo)}</span>
      </div>
    );
  }

  const progreso = Math.min(100, Math.max(0, ((next.minAmount - next.missing) / next.minAmount) * 100));
  return (
    <div className={`cc-bar cc-${style} cc-promo-note`} style={colorVars}>
      {excl}
      <span className="cc-bar-text">
        🎉 {next.promo.name}: sumá {formatPrice(next.missing)}{scopeOf(next.promo)} y llevás {next.percent}% off
        {percent > 0 && <span style={{ opacity: 0.8, fontWeight: 400 }}> (hoy tenés {percent}%)</span>}
      </span>
      <div className="cc-pn-track">
        <div className="cc-pn-fill" style={{ width: `${progreso}%` }} />
      </div>
    </div>
  );
}

// COMENTADO (23/11/2026): la versión anterior, verde fijo para todas las promos. La clienta pidió que se
// vea con el estilo de cada promo ("no sé si es tan lindo que sea en verde"); la de arriba la reemplaza.
// export default function CartPromoNotice({ summary }) {
//   if (!summary?.available) return null;
//   const { promo, percent, next } = summary;
//   if (!next && !percent) return null;
//
//   if (!next) {
//     return (
//       <p className="text-xs font-semibold text-[#006b2c]">
//         🎉 Ya tenés {percent}% off por {promo.name}
//       </p>
//     );
//   }
//
//   const progreso = Math.min(100, Math.max(0, ((next.minAmount - next.missing) / next.minAmount) * 100));
//   return (
//     <div className="space-y-1.5">
//       <p className="text-xs font-semibold text-[#006b2c]">
//         🎉 {next.promo.name}: sumá {formatPrice(next.missing)} y llevás {next.percent}% off
//         {percent > 0 && <span className="font-normal text-[#565e74]"> (hoy tenés {percent}%)</span>}
//       </p>
//       <div className="w-full h-1.5 bg-[#dce9ff] rounded-full overflow-hidden">
//         <div className="h-full rounded-full bg-[#00873a] transition-all duration-500" style={{ width: `${progreso}%` }} />
//       </div>
//     </div>
//   );
// }
