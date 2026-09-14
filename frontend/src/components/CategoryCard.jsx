import { Link } from "react-router-dom";
import "./category-cards.css";

// ─── Tarjeta de categoría del Home ────────────────────────────────────────────
// El estilo (cardStyle), si va destacada (featured) y los textos (badgeText / ribbonText) se
// configuran por categoría desde Admin → Categorías. "normal" es la tarjeta de siempre.
//
// Estilos: normal | fire | sale | fresh | premium | bolt | neon | ice
//   fire    → llamas SVG animadas en la mitad inferior
//   sale    → rojo con cinta diagonal (ribbonText)
//   fresh   → verde con brillo que cruza + etiqueta "Nuevo"
//   premium → negro con esquinas doradas
//   bolt    → azul eléctrico con relámpagos
//   neon    → borde RGB girando
//   ice     → hielo con escarcha y copos
// Las animaciones se apagan solas con "reducir movimiento" (ver category-cards.css).

export const CARD_STYLES = [
  { key: "normal",  label: "Normal",    hint: "La tarjeta azul de siempre" },
  { key: "fire",    label: "Fuego",     hint: "Llamas animadas. Para oportunidades, hot sale" },
  { key: "sale",    label: "Oferta",    hint: "Rojo con cinta diagonal. Usa el texto de la cinta" },
  { key: "fresh",   label: "Nuevo",     hint: "Verde con brillo y etiqueta Nuevo. Para lo recién llegado" },
  { key: "premium", label: "Premium",   hint: "Negro con detalles dorados. Para líneas caras o de marca" },
  { key: "bolt",    label: "Rayo",      hint: "Azul eléctrico con relámpagos. Para ofertas relámpago" },
  { key: "neon",    label: "Neón",      hint: "Borde RGB girando, estética gamer" },
  { key: "ice",     label: "Congelado", hint: "Hielo con copos. Para precios congelados" },
];

const ICON_BY_STYLE = {
  fire: "local_fire_department",
  sale: "sell",
  fresh: "auto_awesome",
  premium: "workspace_premium",
  bolt: "bolt",
  neon: "sports_esports",
  ice: "ac_unit",
};

function Flames({ back = false }) {
  return (
    <div className={`cc-flames${back ? " cc-flames-back" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 400 110" preserveAspectRatio="none">
        <path className="cc-flame cc-f1" fill="#ff5a14" fillOpacity="0.9" d="M0 110 C 20 80, 28 60, 24 34 C 40 52, 52 70, 48 96 C 62 78, 70 50, 62 18 C 84 44, 94 78, 88 110 Z" />
        <path className="cc-flame cc-f2" fill="#ff7a1a" fillOpacity="0.9" d="M80 110 C 100 84, 112 58, 104 28 C 122 48, 132 66, 128 88 C 142 70, 150 44, 144 10 C 166 40, 176 78, 168 110 Z" />
        <path className="cc-flame cc-f3" fill="#ff5a14" fillOpacity="0.92" d="M160 110 C 178 86, 188 62, 182 30 C 200 54, 210 74, 204 96 C 220 76, 226 48, 216 14 C 240 42, 250 80, 244 110 Z" />
        <path className="cc-flame cc-f4" fill="#ff7a1a" fillOpacity="0.9" d="M236 110 C 256 84, 266 60, 258 26 C 276 46, 288 68, 282 92 C 298 70, 306 44, 296 8 C 320 40, 332 78, 324 110 Z" />
        <path className="cc-flame cc-f5" fill="#ff5a14" fillOpacity="0.9" d="M316 110 C 334 88, 344 64, 338 32 C 356 54, 366 72, 360 94 C 374 76, 384 50, 376 20 C 396 46, 404 80, 400 110 Z" />
        <path className="cc-flame cc-f2" fill="#ffc046" fillOpacity="0.8" d="M30 110 C 44 92, 50 74, 46 56 C 58 70, 64 86, 62 110 Z" />
        <path className="cc-flame cc-f4" fill="#ffc046" fillOpacity="0.8" d="M120 110 C 134 94, 140 78, 136 60 C 148 74, 156 90, 152 110 Z" />
        <path className="cc-flame cc-f1" fill="#ffc046" fillOpacity="0.8" d="M206 110 C 220 94, 226 76, 222 58 C 236 74, 242 90, 238 110 Z" />
        <path className="cc-flame cc-f3" fill="#ffc046" fillOpacity="0.8" d="M290 110 C 304 94, 310 78, 306 60 C 318 74, 326 90, 322 110 Z" />
        <path className="cc-flame cc-f5" fill="#ffe08a" fillOpacity="0.85" d="M358 110 C 370 96, 376 82, 372 66 C 384 78, 390 94, 388 110 Z" />
      </svg>
    </div>
  );
}

function Bolts() {
  return (
    <div className="cc-bolts" aria-hidden="true">
      <svg viewBox="0 0 200 120" preserveAspectRatio="none">
        <path className="cc-b1" fill="none" stroke="#e0f2fe" strokeWidth="2.5" strokeLinejoin="round" d="M28 0 L18 34 L34 30 L22 70 L44 38 L28 42 L40 0" />
        <path className="cc-b2" fill="none" stroke="#bfdbfe" strokeWidth="2" strokeLinejoin="round" d="M172 0 L164 28 L178 24 L166 60 L186 32 L172 36 L182 0" />
      </svg>
    </div>
  );
}

function Frost() {
  return (
    <>
      <div className="cc-frost" aria-hidden="true">
        <svg viewBox="0 0 400 100" preserveAspectRatio="none">
          <path fill="#ffffff" fillOpacity="0.55" d="M0 100 L0 70 L30 40 L60 66 L95 30 L130 62 L160 44 L200 74 L235 36 L270 64 L300 48 L340 72 L370 42 L400 68 L400 100 Z" />
          <path fill="#ffffff" fillOpacity="0.85" d="M0 100 L0 84 L40 62 L80 82 L120 58 L160 80 L200 66 L240 84 L280 60 L320 82 L360 64 L400 84 L400 100 Z" />
        </svg>
      </div>
      <i className="cc-flake" aria-hidden="true">❄</i>
      <i className="cc-flake" aria-hidden="true">❄</i>
      <i className="cc-flake" aria-hidden="true">❄</i>
      <i className="cc-flake" aria-hidden="true">❄</i>
    </>
  );
}

export default function CategoryCard({ cat, icon }) {
  const style = CARD_STYLES.some((s) => s.key === cat.cardStyle) ? cat.cardStyle : "normal";
  const featured = cat.featured === true;
  const badge = (cat.badgeText || "").trim();
  const ribbon = (cat.ribbonText || "").trim();
  const iconName = style !== "normal" ? ICON_BY_STYLE[style] : icon;

  return (
    <Link
      to={`/catalogo?category=${cat.slug}`}
      className={`cc-card cc-${style}${featured ? " cc-featured" : ""} group`}
    >
      {style === "fire" && (
        <>
          <Flames back />
          <Flames />
          {[0, 1, 2, 3, 4, 5].map((i) => <i key={i} className="cc-spark" aria-hidden="true" />)}
        </>
      )}
      {style === "bolt" && <Bolts />}
      {style === "ice" && <Frost />}
      {style === "sale" && ribbon && <span className="cc-ribbon">{ribbon}</span>}
      {style === "fresh" && <span className="cc-pill">Nuevo</span>}
      <span className="material-symbols-outlined cc-icon" style={{ fontSize: featured ? 36 : 32 }}>
        {iconName}
      </span>
      <p className="cc-name">{cat.name}</p>
      {badge && <span className="cc-hint">{badge}</span>}
    </Link>
  );
}
