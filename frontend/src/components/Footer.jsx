import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <footer className="bg-slate-900 text-slate-400 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
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
            <h4 className="text-white font-semibold mb-3">Pagos seguros</h4>
            <p className="text-sm">Aceptamos pagos a través de MercadoPago.</p>
            <p className="text-xs mt-2">🔒 Tus datos están protegidos.</p>
          </div>
        </div>
        <div className="border-t border-slate-800 mt-8 pt-6 text-xs text-center">
          © {new Date().getFullYear()} IGWT Store. Todos los derechos reservados.
        </div>
      </div>
    </footer>
  );
}
