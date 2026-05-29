import { Link } from "react-router-dom";
import { useSiteConfig } from "../context/SiteConfigContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";

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

function BannerRow({ banner }) {
  const bgCls   = BG_MAP[banner.bgColor]   || "bg-blue-600";
  const textCls = TEXT_MAP[banner.textColor] || "text-white";

  const renderContent = () => {
    const { text, linkText, url } = banner;
    if (!linkText || !url || !text.includes(linkText)) return text;
    const idx = text.indexOf(linkText);
    // Si la URL es interna usar Link de React Router (client-side nav), si no usar <a>
    // con target="_blank" — evita un full reload que rompía las conexiones SSE persistentes
    const internal = isInternalUrl(url);
    const linkEl = internal ? (
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
    banner.scrollDir === "rtl"    ? "ann-rtl"    :
    banner.scrollDir === "ltr"    ? "ann-ltr"    :
    banner.scrollDir === "bounce" ? "ann-bounce" : null;

  // El modo "bounce" usa inline-block + translateX con calc — más confiable que position:absolute
  if (banner.scrollDir === "bounce") {
    return (
      <div className={`${bgCls} ${textCls} text-sm py-2 overflow-hidden`}>
        <div className="ann-bounce">{renderContent()}</div>
      </div>
    );
  }

  return (
    <div className={`${bgCls} ${textCls} text-sm py-2 ${banner.scrollDir === "none" ? "text-center px-4" : "overflow-hidden"}`}>
      {banner.scrollDir === "none" ? (
        <span>{renderContent()}</span>
      ) : (
        <span className={animClass}>
          {renderContent()}
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
