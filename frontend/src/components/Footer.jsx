import { Link } from "react-router-dom";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useSiteConfig } from "../context/SiteConfigContext";

/* SOCIAL comentado — el banner de redes se movió al componente Home.jsx
const SOCIAL = [
  { name: "Instagram", href: "https://www.instagram.com/igwtstore/?hl=es", bg: "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400" },
  { name: "TikTok",    href: "https://www.tiktok.com/@igwtstore",           bg: "bg-black" },
  { name: "YouTube",   href: "https://www.youtube.com/@igwtstore7143",      bg: "bg-red-600" },
];
*/

// light=true: fondo claro (usado en página de Login), light=false (default): fondo oscuro
// noMargin=true: prop preservada por compatibilidad con páginas existentes que la pasan
export default function Footer({ light = false, noMargin = false }) {
  const { customer } = useCustomerAuth();
  // Los clientes MAYORISTA no tienen derecho a arrepentimiento por ley (Ley 24.240 aplica solo a consumidores finales)
  const isMayorista = customer?.type === "MAYORISTA";
  // Datos de contacto editables desde admin > Configuración > Contenido > Footer
  const { footerEmail, footerPhone, footerAddress } = useSiteConfig();

  // Clases según variante: oscura (default) o clara (login)
  // Antes: bg-slate-900 / bg-blue-50 — actualizado a tokens del sistema de diseño
  const w = light
    ? {
        wrap: "bg-blue-50 text-slate-500 border-t border-slate-200",
        heading: "text-[#006b2c] text-xs font-semibold uppercase tracking-widest mb-4",
        link: "text-slate-500 hover:text-[#006b2c] transition-colors",
        border: "border-slate-200",
        copy: "text-xs text-slate-400",
        desc: "text-slate-500 text-sm leading-relaxed",
        contact: "text-slate-500",
        iconColor: "text-[#006b2c]",
        socialLink: "text-slate-400 hover:text-[#006b2c] transition-colors",
        brandText: "text-slate-800 font-bold text-lg",
      }
    : {
        wrap: `bg-[#0b1c30] text-[#bdcaba]`,
        heading: "text-[#62df7d] text-xs font-semibold uppercase tracking-widest mb-4",
        link: "text-[#bdcaba] hover:text-[#62df7d] transition-colors",
        border: "border-white/10",
        copy: "text-xs text-[#bdcaba]/50",
        desc: "text-[#bdcaba]/70 text-sm leading-relaxed",
        contact: "text-[#bdcaba]",
        iconColor: "text-[#62df7d]",
        socialLink: "text-[#bdcaba] hover:text-white transition-colors",
        brandText: "text-white font-bold text-lg",
      };

  return (
    <footer className={w.wrap}>

      {/* ── Contenido principal del footer ── */}
      <div className="max-w-[1280px] mx-auto px-6 py-12">
        {/* Antes: brand col-span-2 md:col-span-2 — reducido a md:col-span-1 para liberar una columna para Pagos */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-6">

          {/* Marca */}
          <div className="col-span-2 md:col-span-1 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              {/* Antes: emoji ⚡ — reemplazado por Material Symbol bolt filled */}
              {/* <span className="text-blue-400">⚡</span> */}
              <span
                className={`material-symbols-outlined ${w.iconColor}`}
                style={{ fontVariationSettings: "'FILL' 1" }}
              >bolt</span>
              <span className={w.brandText}>IGWT Store</span>
            </div>
            <p className={w.desc}>
              Tu tienda de tecnología y accesorios. Calidad garantizada en cada producto.
            </p>
          </div>

          {/* Navegación */}
          <div>
            <h4 className={w.heading}>Navegación</h4>
            <ul className="space-y-3 text-sm">
              <li><Link to="/" className={w.link}>Inicio</Link></li>
              <li><Link to="/catalogo" className={w.link}>Catálogo</Link></li>
              {!customer && (
                <li><Link to="/registro" className={w.link}>Registrarse</Link></li>
              )}
            </ul>
          </div>

          {/* La tienda */}
          <div>
            <h4 className={w.heading}>La tienda</h4>
            <ul className="space-y-3 text-sm">
              <li><Link to="/sobre-nosotros" className={w.link}>Sobre nosotros</Link></li>
              <li><Link to="/como-comprar" className={w.link}>Cómo comprar</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className={w.heading}>Legal</h4>
            <ul className="space-y-3 text-sm">
              <li><Link to="/privacidad" className={w.link}>Política de privacidad</Link></li>
              <li><Link to="/terminos" className={w.link}>Términos y condiciones</Link></li>
              {!isMayorista && (
                <li>
                  <Link to="/arrepentimiento" className={w.link}>
                    Botón de arrepentimiento
                  </Link>
                </li>
              )}
            </ul>
          </div>

          {/* Contacto — columna propia */}
          <div>
            <h4 className={w.heading}>Contacto</h4>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-2">
                {/* Antes: emoji 📧 — reemplazado por Material Symbol */}
                {/* <span>📧</span> */}
                <span className={`material-symbols-outlined text-[16px] ${w.iconColor}`}>mail</span>
                <a href={`mailto:${footerEmail}`} className={`${w.link} break-all`}>{footerEmail}</a>
              </li>
              <li className="flex items-center gap-2">
                {/* Antes: emoji 📞 — reemplazado por Material Symbol */}
                {/* <span>📞</span> */}
                <span className={`material-symbols-outlined text-[16px] ${w.iconColor}`}>phone</span>
                <a href={`tel:${footerPhone}`} className={w.link}>{footerPhone}</a>
              </li>
              <li className="flex items-start gap-2">
                {/* Antes: emoji 📍 — reemplazado por Material Symbol */}
                {/* <span>📍</span> */}
                <span className={`material-symbols-outlined text-[16px] mt-0.5 ${w.iconColor}`}>location_on</span>
                <span className={w.contact}>{footerAddress}</span>
              </li>
            </ul>
          </div>

          {/* Pagos seguros — columna propia (antes estaba junto a Contacto) */}
          <div>
            <h4 className={w.heading}>Pagos seguros</h4>
            <p className="text-xs mb-2 opacity-70">Aceptamos MercadoPago y transferencias.</p>
            {/* Logos de medios de pago — SVG inline preservados */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {/* VISA */}
              <span className="inline-flex items-center justify-center w-10 h-6 rounded bg-[#1a1f71]">
                <svg viewBox="0 0 48 16" className="w-8" fill="none">
                  <text x="1" y="13" fontFamily="Arial" fontWeight="900" fontSize="14" fill="white" fontStyle="italic" letterSpacing="-0.5">VISA</text>
                </svg>
              </span>
              {/* Mastercard */}
              <span className="inline-flex items-center justify-center w-10 h-6 rounded bg-[#252525]">
                <svg viewBox="0 0 32 20" className="w-7">
                  <circle cx="11" cy="10" r="7.5" fill="#eb001b"/>
                  <circle cx="21" cy="10" r="7.5" fill="#f79e1b"/>
                  <path d="M16 4.2a7.5 7.5 0 0 1 0 11.6A7.5 7.5 0 0 1 16 4.2z" fill="#ff5f00"/>
                </svg>
              </span>
              {/* AMEX */}
              <span className="inline-flex items-center justify-center w-10 h-6 rounded bg-[#2e77bc]">
                <svg viewBox="0 0 40 16" className="w-9" fill="none">
                  <text x="2" y="12" fontFamily="Arial" fontWeight="900" fontSize="10" fill="white" letterSpacing="0.5">AMEX</text>
                </svg>
              </span>
              {/* CABAL */}
              <span className="inline-flex items-center justify-center w-10 h-6 rounded bg-[#1b2a4a]">
                <svg viewBox="0 0 42 16" className="w-9" fill="none">
                  <text x="2" y="12" fontFamily="Arial" fontWeight="900" fontSize="10" fill="white">CABAL</text>
                </svg>
              </span>
              {/* Pago Fácil */}
              <span className="inline-flex items-center justify-center px-1.5 h-6 rounded bg-[#f5a800]">
                <svg viewBox="0 0 60 16" className="w-12" fill="none">
                  <text x="1" y="12" fontFamily="Arial" fontWeight="900" fontSize="10" fill="#1b2a4a">Pago Fácil</text>
                </svg>
              </span>
              {/* Rapipago */}
              <span className="inline-flex items-center justify-center px-1.5 h-6 rounded bg-[#e8420e]">
                <svg viewBox="0 0 62 16" className="w-12" fill="none">
                  <text x="1" y="12" fontFamily="Arial" fontWeight="800" fontSize="10" fill="white">Rapipago</text>
                </svg>
              </span>
              {/* Naranja */}
              <span className="inline-flex items-center justify-center px-1.5 h-6 rounded bg-[#ff6200]">
                <svg viewBox="0 0 54 16" className="w-10" fill="none">
                  <text x="1" y="12" fontFamily="Arial" fontWeight="900" fontSize="10" fill="white">Naranja</text>
                </svg>
              </span>
              {/* MercadoPago */}
              <span className="inline-flex items-center justify-center px-1.5 h-6 rounded bg-[#009ee3]">
                <svg viewBox="0 0 80 16" className="w-16" fill="none">
                  <text x="1" y="12" fontFamily="Arial" fontWeight="700" fontSize="9" fill="white">MercadoPago</text>
                </svg>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs opacity-50">
              {/* Antes: emoji 🔒 — reemplazado por Material Symbol */}
              {/* <p className="text-xs text-slate-500">🔒 Tus datos están protegidos.</p> */}
              <span className="material-symbols-outlined text-[14px]">lock</span>
              <span>Tus datos están protegidos.</span>
            </div>
          </div>

        </div>

        {/* ── Barra inferior ── */}
        <div className={`border-t ${w.border} mt-10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3`}>
          {/* Columna izquierda: copyright + crédito del desarrollador */}
          <div className="flex flex-col items-center sm:items-start gap-1">
            <span className={w.copy}>© {new Date().getFullYear()} IGWT Store. Todos los derechos reservados.</span>
            {/* Crédito desarrollador — SheloSettDev */}
            <div className="flex items-center gap-2 text-xs opacity-50 hover:opacity-80 transition-opacity">
              <span className={`${w.copy} !text-xs`}>Desarrollado por</span>
              <a
                href="https://www.instagram.com/SheloSettDev"
                target="_blank" rel="noopener noreferrer"
                className={`${w.socialLink} flex items-center gap-1 text-xs`}
                title="Instagram"
              >
                {/* Instagram del desarrollador */}
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                </svg>
                SheloSettDev
              </a>
              <span className={`${w.copy} !text-xs`}>·</span>
              <a
                href="mailto:shelosettDev@gmail.com"
                className={`${w.socialLink} text-xs`}
                title="Email del desarrollador"
              >
                shelosettDev@gmail.com
              </a>
              <span className={`${w.copy} !text-xs`}>·</span>
              <a
                href="https://wa.me/5491136557290"
                target="_blank" rel="noopener noreferrer"
                className={`${w.socialLink} flex items-center gap-1 text-xs`}
                title="WhatsApp del desarrollador"
              >
                {/* WhatsApp icon del desarrollador */}
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                WhatsApp
              </a>
            </div>
          </div>
          <div className="flex items-center gap-5">
            {/* Instagram */}
            <a href="https://www.instagram.com/igwtstore/?hl=es" target="_blank" rel="noopener noreferrer"
              className={`${w.socialLink} flex items-center gap-1.5 text-xs`}>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
              Instagram
            </a>
            {/* TikTok */}
            <a href="https://www.tiktok.com/@igwtstore" target="_blank" rel="noopener noreferrer"
              className={`${w.socialLink} flex items-center gap-1.5 text-xs`}>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.17 8.17 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/>
              </svg>
              TikTok
            </a>
            {/* YouTube */}
            <a href="https://www.youtube.com/@igwtstore7143" target="_blank" rel="noopener noreferrer"
              className={`${w.socialLink} flex items-center gap-1.5 text-xs`}>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              YouTube
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
