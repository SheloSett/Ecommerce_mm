import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CARD_STYLES, ICON_BY_STYLE, Flames, Bolts, Frost } from "./CategoryCard";
import { badgeParts, endsLabel, countdownParts, textColorFor } from "../utils/campaignCard";
import "./category-cards.css";

// ─── Tarjeta grande de una campaña vigente, arriba de las categorías del Home ──────────────────
// Usa los mismos estilos que las tarjetas de categoría (fuego, oferta, etc.) más "color": un fondo
// del color que elija el admin (cardColor). Se configura en Admin → Ofertas, en cada campaña.
// Enlaza al catálogo filtrado por la campaña.
//
// badge: { value, upTo } del público que mira (ver badgeFor en utils/campaignCard.js).
// preview: en el formulario del admin se dibuja como <div> (sin link) para la vista previa.

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

export default function CampaignCard({ offer, badge, preview = false, solo = false }) {
  const style = offer.cardStyle === "color" || CARD_STYLES.some((s) => s.key === offer.cardStyle)
    ? offer.cardStyle
    : "sale";
  const parts = badgeParts(badge, offer.discountType);
  const withCountdown = offer.showCountdown !== false;
  const now = useNow(withCountdown);
  const countdown = withCountdown ? countdownParts(offer.endsAt, now) : null;
  const ends = endsLabel(offer.endsAt, now);
  const icon = ICON_BY_STYLE[style] || "sell";

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
