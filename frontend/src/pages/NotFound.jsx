import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

// Página para las direcciones que no existen (M7 de la auditoría). Antes cualquier URL desconocida
// redirigía al inicio: un link roto (de un email viejo, de Google) parecía funcionar y no se notaba, y
// Google lo indexaba como una copia del inicio. noindex: que no la guarde.
export default function NotFound() {
  return (
    <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
      <Helmet>
        <title>Página no encontrada | IGWT Store</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <Navbar />
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <span className="material-symbols-outlined text-[72px] text-[#bdcaba]">travel_explore</span>
        <h1 className="text-xl font-semibold text-[#0b1c30]">No encontramos esta página</h1>
        <p className="text-sm text-[#565e74] max-w-sm">
          El link puede estar mal escrito o la página ya no existe.
        </p>
        <div className="flex gap-4">
          <Link to="/catalogo" className="text-sm text-[#006b2c] hover:underline font-medium">Ver el catálogo</Link>
          <Link to="/" className="text-sm text-[#006b2c] hover:underline font-medium">Ir al inicio</Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
