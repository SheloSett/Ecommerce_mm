import { Link } from "react-router-dom";
import { useSiteConfig } from "../context/SiteConfigContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { Flames, Bolts, Frost } from "./CategoryCard";
import { bannerTheme } from "../utils/bannerTheme";
import "./category-cards.css";

// Detecta si una URL es interna (relativa o al mismo origen) para usar React Router Link
// y evitar un page reload que rompe las conexiones SSE.
function isInternalUrl(url) {
  if (!url) return false;
  if (url.startsWith("/")) return true;
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin;
  } catch {
    return false;
  }
}

const BG_MAP = {
  blue:   "bg-blue-600",
  green:  "bg-emerald-600",
  amber:  "bg-amber-400",
  red:    "bg-red-600",
  slate:  "bg-slate-800",
  black:  "bg-black",
  purple: "bg-purple-600",
};

const TEXT_MAP = {
  white:  "text-white",
  black:  "text-black",
  yellow: "text-yellow-300",
  amber:  "text-amber-900",
  slate:  "text-slate-200",
};

// Adornos de los estilos especiales, detrás del texto. Llamas y relámpagos van repetidos: uno solo estirado
// a todo el ancho de la barra quedaba como una línea chata.
function BarDecor({ theme }) {
  if (theme === "fire") return <div className="cc-bar-row">{[0, 1, 2, 3].map((i) => <Flames key={i} />)}</div>;
  if (theme === "bolt") return <div className="cc-bar-row">{[0, 1, 2].map((i) => <Bolts key={i} />)}</div>;
  if (theme === "ice") return <Frost />;
  return null;
}

// preview: en el panel se dibuja quieto y con el link sin navegar, para no perder lo que no se guardó.
export function BannerRow({ banner, preview = false }) {
  const theme = bannerTheme(banner);
  const themed = theme.key !== "normal";
  // Con estilo especial mandan sus colores: el fondo y la letra elegidos son solo para "Normal".
  const colorCls = themed
    ? `cc-bar cc-${theme.key}`
    : `${BG_MAP[banner.bgColor] || "bg-blue-600"} ${TEXT_MAP[banner.textColor] || "text-white"}`;
  const textCls = themed ? "cc-bar-text" : "";
  const scrollDir = preview ? "none" : banner.scrollDir;

  const renderContent = () => {
    const { text, linkText, url } = banner;
    if (!linkText || !url || !text.includes(linkText)) return text;
    const idx = text.indexOf(linkText);
    // Si la URL es interna usar Link de React Router (client-side nav), si no usar <a>
    // con target="_blank" — evita un full reload que rompía las conexiones SSE persistentes
    const internal = isInternalUrl(url);
    const linkEl = preview ? (
      <span className="underline font-semibold">{linkText}</span>
    ) : internal ? (
      <Link to={url.replace(window.location.origin, "")} className="underline font-semibold hover:opacity-80 transition-opacity">
        {linkText}
      </Link>
    ) : (
      <a href={url} target="_blank" rel="noopener noreferrer" className="underline font-semibold hover:opacity-80 transition-opacity">
        {linkText}
      </a>
    );
    return (
      <>
        {text.slice(0, idx)}
        {linkEl}
        {text.slice(idx + linkText.length)}
      </>
    );
  };

  // Determinar clase de animación según el modo de scroll
  const animClass =
    scrollDir === "rtl"    ? "ann-rtl"    :
    scrollDir === "ltr"    ? "ann-ltr"    :
    scrollDir === "bounce" ? "ann-bounce" : "";

  const decor = themed && <BarDecor theme={theme.key} />;
  const body = (
    <>
      {themed && <span className="material-symbols-outlined cc-icon" aria-hidden="true">{theme.icon}</span>}
      {renderContent()}
    </>
  );

  // El modo "bounce" usa inline-block + translateX con calc — más confiable que position:absolute
  if (scrollDir === "bounce") {
    return (
      <div className={`${colorCls} text-sm py-2 overflow-hidden`}>
        {decor}
        <div className={`ann-bounce ${textCls}`}>{body}</div>
      </div>
    );
  }

  return (
    <div className={`${colorCls} text-sm py-2 ${scrollDir === "none" ? "text-center px-4" : "overflow-hidden"} ${preview ? "rounded-xl" : ""}`}>
      {decor}
      {scrollDir === "none" ? (
        <span className={textCls}>{body}</span>
      ) : (
        <span className={`${animClass} ${textCls}`}>
          {body}
        </span>
      )}
    </div>
  );
}

export default function AnnouncementBar() {
  const { announcement, loading } = useSiteConfig();
  const { customer } = useCustomerAuth();

  // No renderizar mientras la config del sitio sigue cargando — antes el banner aparecía con la
  // animación de scroll ya empezada (texto cortado a la mitad) durante el load inicial.
  if (loading) return null;
  if (!announcement || !Array.isArray(announcement) || announcement.length === 0) return null;

  const customerType = customer?.type || "MINORISTA";

  const visible = announcement.filter((b) => {
    if (!b.active || !b.text) return false;
    if (b.visibleFor === "AMBOS") return true;
    return b.visibleFor === customerType;
  });

  if (visible.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes ann-ltr { 0% { transform: translateX(-100%); } 100% { transform: translateX(100vw); } }
        @keyframes ann-rtl { 0% { transform: translateX(100vw); } 100% { transform: translateX(-100%); } }
        @keyframes ann-fade { from { opacity: 0; } to { opacity: 1; } }
        /* Rebote: el texto arranca a la izquierda y se desplaza hasta el borde derecho usando
           translateX(calc(100vw - 100%)). 100% se refiere al ancho del propio elemento, 100vw al viewport.
           Con animation-direction:alternate la animación va y vuelve → efecto rebote.
           Mucho más simple que el approach con position:absolute. */
        @keyframes ann-bounce-anim {
          0%   { transform: translateX(0); }
          100% { transform: translateX(calc(100vw - 100%)); }
        }
        .ann-ltr { display:inline-block; white-space:nowrap; animation: ann-ltr 22s linear infinite; }
        .ann-rtl { display:inline-block; white-space:nowrap; animation: ann-rtl 22s linear infinite; }
        .ann-bounce {
          display: inline-block;
          white-space: nowrap;
          animation: ann-bounce-anim 25s ease-in-out infinite alternate;
        }
        .ann-wrap { animation: ann-fade 0.35s ease-out; }
      `}</style>
      <div className="ann-wrap">
        {visible.map((b) => <BannerRow key={b.id} banner={b} />)}
      </div>
    </>
  );
}
