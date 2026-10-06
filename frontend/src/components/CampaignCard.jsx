import { Link } from "react-router-dom";
import { CARD_STYLES, ICON_BY_STYLE, Flames, Bolts, Frost } from "./CategoryCard";
import { badgeParts, endsLabel, textColorFor } from "../utils/campaignCard";
import "./category-cards.css";

// ─── Tarjeta grande de una campaña vigente, arriba de las categorías del Home ──────────────────
// Usa los mismos estilos que las tarjetas de categoría (fuego, oferta, etc.) más "color": un fondo
// del color que elija el admin (cardColor). Se configura en Admin → Ofertas, en cada campaña.
// Enlaza al catálogo filtrado por la campaña.
//
// badge: { value, upTo } del público que mira (ver badgeFor en utils/campaignCard.js).
// preview: en el formulario del admin se dibuja como <div> (sin link) para la vista previa.

export default function CampaignCard({ offer, badge, preview = false, solo = false }) {
  const style = offer.cardStyle === "color" || CARD_STYLES.some((s) => s.key === offer.cardStyle)
    ? offer.cardStyle
    : "sale";
  const parts = badgeParts(badge, offer.discountType);
  const ends = endsLabel(offer.endsAt);
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
          {ends && <span className="cc-hint">{ends}</span>}
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
