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

// Estilo a dibujar: los de las categorías, los de fecha especial o "color"; cualquier otro → "sale".
function campaignStyle(offer) {
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

export default function CampaignCard({ offer, badge, preview = false, solo = false }) {
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
        <p className="cc-name">{offer.name || "Nombre de la campaña"}</p>
        {offer.description && <p className="cc-camp-desc">{offer.description}</p>}
        <div className="cc-camp-meta">
          {/* Antes: siempre el chip "Quedan N días"; ahora la cuenta regresiva, si la campaña la tiene */}
          {countdown ? <Countdown parts={countdown} /> : ends && <span className="cc-hint">{ends}</span>}
          <span className="cc-camp-cta">
            Ver ofertas
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
    <Link to={`/catalogo?offerId=${offer.id}`} className={className} style={colorVars}>
      {content}
    </Link>
  );
}
