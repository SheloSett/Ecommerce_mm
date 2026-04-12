import { Link } from "react-router-dom";

/* SOCIAL comentado — el banner de redes se movió al componente Home.jsx
const SOCIAL = [
  { name: "Instagram", href: "https://www.instagram.com/igwtstore/?hl=es", bg: "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400" },
  { name: "TikTok",    href: "https://www.tiktok.com/@igwtstore",           bg: "bg-black" },
  { name: "YouTube",   href: "https://www.youtube.com/@igwtstore7143",      bg: "bg-red-600" },
];
*/

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400 mt-16">

      {/* ── Links del footer ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div className="col-span-2 md:col-span-1">
            <h3 className="text-white font-bold text-lg mb-3">
              <span className="text-blue-400">⚡</span> IGWT Store
            </h3>
            <p className="text-sm leading-relaxed">
              Tu tienda de tecnología y accesorios. Calidad garantizada en cada producto.
            </p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Navegación</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/" className="hover:text-white transition-colors">Inicio</Link></li>
              <li><Link to="/catalogo" className="hover:text-white transition-colors">Catálogo</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/privacidad" className="hover:text-white transition-colors">Política de privacidad</Link></li>
              <li><Link to="/terminos" className="hover:text-white transition-colors">Términos y condiciones</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Pagos seguros</h4>
            <p className="text-sm">Aceptamos pagos a través de MercadoPago.</p>
            <p className="text-sm mt-1">Transferencias bancarias.</p>
            <p className="text-xs mt-2">🔒 Tus datos están protegidos.</p>
          </div>
          <div>
            <h4 className="text-white font-semibold mb-3">Contacto</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <span>📧</span>
                <a href="mailto:info@igwtstore.com.ar" className="hover:text-white transition-colors">info@igwtstore.com.ar</a>
              </li>
              <li className="flex items-center gap-2">
                <span>📞</span>
                <a href="tel:1150395166" className="hover:text-white transition-colors">1150395166</a>
              </li>
              <li className="flex items-center gap-2">
                <span>📍</span>
                <span>Av La Plata 744 Timbre 3</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-800 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <span>© {new Date().getFullYear()} IGWT Store. Todos los derechos reservados.</span>
          <div className="flex items-center gap-4">
            <a href="https://www.instagram.com/igwtstore/?hl=es" target="_blank" rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
              </svg>
              Instagram
            </a>
            <a href="https://www.tiktok.com/@igwtstore" target="_blank" rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.17 8.17 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/>
              </svg>
              TikTok
            </a>
            <a href="https://www.youtube.com/@igwtstore7143" target="_blank" rel="noopener noreferrer"
              className="hover:text-white transition-colors flex items-center gap-1.5">
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
