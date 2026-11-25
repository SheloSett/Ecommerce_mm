import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CARD_STYLES, ICON_BY_STYLE, Flames, Bolts, Frost } from "./CategoryCard";
import { badgeParts, endsLabel, countdownParts, textColorFor } from "../utils/campaignCard";
import "./category-cards.css";

// ─── Tarjeta grande de una campaña vigente, arriba de las categorías del Home ──────────────────
// Usa los mismos estilos que las tarjetas de categoría (fuego, oferta, etc.), los de fecha especial
// (Black Friday, Cyber Monday; ver EVENT_STYLES) y "color": un fondo del color que elija el admin
// (cardColor). Se configura en Admin → Ofertas, en cada campaña.
// Enlaza al catálogo filtrado por la campaña.
//
// badge: { value, upTo } del público que mira (ver badgeFor en utils/campaignCard.js).
// preview: en el formulario del admin se dibuja como <div> (sin link) para la vista previa.

// Estilos de fecha especial: solo para campañas (las categorías no los tienen). Llevan una cinta
// con el nombre del evento que corre arriba de la tarjeta (ver Tape).
export const EVENT_STYLES = [
  { key: "blackfriday", label: "Black Friday", hint: "Negro con una cinta amarilla que corre y un brillo dorado que cruza", tape: "BLACK FRIDAY", sep: "★", icon: "shopping_bag" },
  { key: "cybermonday", label: "Cyber Monday", hint: "Violeta oscuro con grilla de neón, cinta cian y rosa y el título con glitch", tape: "CYBER MONDAY", sep: "✦", icon: "computer" },
];

// Todos los estilos que se pueden elegir para una tarjeta de campaña (o de una promo por monto): los de
// las categorías (con la explicación adaptada donde hace falta), los de fecha especial y "Color propio".
// Vivía en AdminOffers.jsx; se pasó acá para que Productos → Descuento por monto use la misma lista.
export const CAMPAIGN_CARD_STYLES = [
  ...CARD_STYLES.map((s) =>
    s.key === "sale"  ? { ...s, hint: "Rojo con el descuento en amarillo" } :
    s.key === "fresh" ? { ...s, hint: "Verde con un brillo que cruza" } : s
  ),
  ...EVENT_STYLES,
  { key: "color", label: "Color propio", hint: "El color que elijas; el texto sale blanco o negro según el fondo" },
];

// Estilo a dibujar: los de las categorías, los de fecha especial o "color"; cualquier otro → "sale".
// Exportada para el aviso del carrito de la promo por monto (CartPromoNotice.jsx), que usa el mismo estilo.
// Antes: function campaignStyle(offer) {
export function campaignStyle(offer) {
  const s = offer.cardStyle;
  return s === "color" || CARD_STYLES.some((x) => x.key === s) || EVENT_STYLES.some((x) => x.key === s) ? s : "sale";
}
const iconFor = (style) => ICON_BY_STYLE[style] || EVENT_STYLES.find((s) => s.key === style)?.icon || "sell";

// Cinta de los estilos de fecha especial: el nombre del evento repetido, corriendo. Van dos tiras
// iguales una atrás de la otra: al correr la mitad del ancho, la segunda queda donde arrancó la
// primera y el salto no se nota (ver cc-marquee en category-cards.css).
function Tape({ text, sep }) {
  return (
    <div className="cc-tape" aria-hidden="true">
      <div className="cc-tape-track">
        {[0, 1].map((k) => (
          <span key={k} className="cc-tape-run">
            {Array.from({ length: 10 }, (_, i) => <span key={i}>{text}<b>{sep}</b></span>)}
          </span>
        ))}
      </div>
    </div>
  );
}

// Hora actual que se actualiza cada segundo (solo mientras `enabled`), para la cuenta regresiva.
function useNow(enabled) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

const pad = (n) => String(n).padStart(2, "0");

// Cuenta regresiva: casilleros de días / horas / minutos / segundos. Con menos de 3 días se pone
// roja y titila (ver .cc-countdown-urgent en category-cards.css).
function Countdown({ parts }) {
  const units = [
    ...(parts.days > 0 ? [[parts.days, parts.days === 1 ? "día" : "días"]] : []),
    [pad(parts.hours), "h"],
    [pad(parts.minutes), "min"],
    [pad(parts.seconds), "seg"],
  ];
  // Urgente: etiqueta corta para que la pastilla roja entre en un renglón también en el celular.
  const label = !parts.urgent ? "Termina en" : parts.days === 0 ? "¡Último día!" : "¡Últimos días!";
  return (
    <div className={`cc-countdown${parts.urgent ? " cc-countdown-urgent" : ""}`} role="timer">
      <span className="cc-countdown-label">{label}</span>
      <span className="cc-countdown-units">
        {units.map(([v, l]) => (
          <span key={l} className="cc-cd-unit">
            <span className="cc-cd-num">{v}</span>
            <span className="cc-cd-lbl">{l}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

// ─── Chip de campaña: versión miniatura para el filtro "Ofertas y Stock" del catálogo ───────────
// Igual que CategoryChip (CategoryCard.jsx) pero con las reglas de la tarjeta de campaña de abajo:
// estilo desconocido → "sale", y "color" pinta el fondo con el color propio (cardColor). Así cada
// campaña se ve en el filtro con el mismo estilo que se le configuró en Admin → Ofertas.
export function CampaignChip({ offer, className = "" }) {
  const style = campaignStyle(offer);
  const colorVars = style === "color"
    ? { "--cc-bg": offer.cardColor || "#c2185b", "--cc-fg": textColorFor(offer.cardColor || "#c2185b") }
    : undefined;
  return (
    <span className={`cc-chip cc-${style} ${className}`} style={colorVars}>
      {style === "fire" && <Flames />}
      {style === "ice" && <Frost />}
      <span className="material-symbols-outlined cc-icon">{iconFor(style)}</span>
      <span className="cc-name">{offer.name}</span>
    </span>
  );
}

// Promo por monto (Productos → Descuento por monto) con la misma tarjeta (23/11/2026):
//   tiers → los escalones [{ minAmount, percent }], que se muestran en el cuerpo ("Desde $100.000 · 5% OFF")
//   to    → a dónde lleva (la promo no tiene productos propios: al catálogo)
//   cta   → el texto del botón (por defecto "Ver ofertas")
const money = (n) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

// Antes: export default function CampaignCard({ offer, badge, preview = false, solo = false }) {
export default function CampaignCard({ offer, badge, preview = false, solo = false, tiers = null, to = null, cta = null }) {
  const style = campaignStyle(offer);
  const event = EVENT_STYLES.find((s) => s.key === style);
  const parts = badgeParts(badge, offer.discountType);
  const withCountdown = offer.showCountdown !== false;
  const now = useNow(withCountdown);
  const countdown = withCountdown ? countdownParts(offer.endsAt, now) : null;
  const ends = endsLabel(offer.endsAt, now);
  const icon = iconFor(style);

  // Color propio: el fondo y el color del texto (oscuro si el fondo es claro) van como variables CSS.
  const colorVars = style === "color"
    ? { "--cc-bg": offer.cardColor || "#c2185b", "--cc-fg": textColorFor(offer.cardColor || "#c2185b") }
    : undefined;

  const className = `cc-card cc-campaign cc-${style}${solo ? " cc-campaign-solo" : ""} group`;
  const content = (
    <>
      {style === "fire" && (
        <>
          <Flames back />
          <Flames />
          {[0, 1, 2, 3, 4, 5].map((i) => <i key={i} className="cc-spark" aria-hidden="true" />)}
        </>
      )}
      {style === "bolt" && <Bolts />}
      {style === "ice" && <Frost />}
      {style === "cybermonday" && <div className="cc-cyber-grid" aria-hidden="true" />}
      {event && <Tape text={event.tape} sep={event.sep} />}

      <div className="cc-camp-body">
        <span className="material-symbols-outlined cc-icon">{icon}</span>
        {/* Promo por monto solo para mayoristas (pedido de la clienta, 25/11/2026): que diga que es exclusiva */}
        {tiers?.length > 0 && offer.appliesTo === "MAYORISTA" && (
          <span className="cc-hint cc-camp-excl">Exclusivo para mayoristas</span>
        )}
        <p className="cc-name">{offer.name || "Nombre de la campaña"}</p>
        {offer.description && <p className="cc-camp-desc">{offer.description}</p>}
        {/* Promo para algunas categorías o productos: para cuáles vale (ej. "En Audio y Cables") */}
        {tiers?.length > 0 && offer.scopeLabel && <p className="cc-camp-desc">{offer.scopeLabel}</p>}
        {/* Escalones de la promo por monto: cada uno en una pastilla con los colores del estilo (cc-hint) */}
        {tiers?.length > 0 && (
          <ul className="cc-camp-tiers">
            {tiers.map((t) => (
              <li key={t.minAmount} className="cc-hint">
                {/* Monto y % en partes que no se cortan por dentro: si no entra, baja entero el "10% OFF" */}
                {/* Antes: "Desde $X" (pedido de la clienta, 24/11/2026: "a partir de") */}
                <span>A partir de {money(t.minAmount)}</span> · <b>{t.percent}% OFF</b>
              </li>
            ))}
          </ul>
        )}
        <div className="cc-camp-meta">
          {/* Antes: siempre el chip "Quedan N días"; ahora la cuenta regresiva, si la campaña la tiene */}
          {countdown ? <Countdown parts={countdown} /> : ends && <span className="cc-hint">{ends}</span>}
          <span className="cc-camp-cta">
            {/* Antes: siempre "Ver ofertas" */}
            {cta || "Ver ofertas"}
            <span className="material-symbols-outlined">chevron_right</span>
          </span>
        </div>
      </div>

      {parts && (
        <div className="cc-camp-badge">
          {parts.prefix && <span className="cc-camp-upto">{parts.prefix}</span>}
          <span className={`cc-camp-amount${parts.amount.length > 4 ? " cc-camp-amount-long" : ""}`}>{parts.amount}</span>
          <span className="cc-camp-off">{parts.suffix}</span>
        </div>
      )}
    </>
  );

  if (preview) return <div className={className} style={colorVars}>{content}</div>;
  return (
    // Antes: to={`/catalogo?offerId=${offer.id}`} siempre
    <Link to={to || `/catalogo?offerId=${offer.id}`} className={className} style={colorVars}>
      {content}
    </Link>
  );
}
