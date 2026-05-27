import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSiteConfig } from "../context/SiteConfigContext";

export default function MaintenancePage() {
  const { maintenance, loading } = useSiteConfig();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !maintenance) {
      navigate("/", { replace: true });
    }
  }, [maintenance, loading, navigate]);

  return (
    // Antes: bg-slate-900 — actualizado a token del sistema de diseño
    <div className="min-h-screen bg-[#0b1c30] flex items-center justify-center px-4">
      <div className="text-center max-w-md">

        {/* Antes: emoji 🔧 animate-bounce — reemplazado por Material Symbol */}
        {/* <div className="text-6xl mb-6 animate-bounce">🔧</div> */}
        <div className="flex items-center justify-center mb-8">
          <span
            className="material-symbols-outlined text-[72px] text-[#62df7d] animate-bounce"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            build
          </span>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-white mb-4" style={{ fontFamily: "Outfit" }}>
          Estamos en mantenimiento
        </h1>

        <p className="text-white/50 text-lg mb-10 leading-relaxed">
          Estamos trabajando para mejorar tu experiencia.
          Volvemos pronto.
        </p>

        {/* Logo — antes: emoji ⚡ text-blue-400 — reemplazado por Material Symbol + token verde */}
        {/* <div className="flex items-center justify-center gap-2 text-slate-500">
          <span className="text-blue-400 text-xl">⚡</span>
          <span className="font-bold text-lg text-slate-300">IGWT Store</span>
        </div> */}
        <div className="flex items-center justify-center gap-2">
          <span
            className="material-symbols-outlined text-[#62df7d] text-[22px]"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            bolt
          </span>
          <span className="font-bold text-lg text-white/70">IGWT Store</span>
        </div>

      </div>
    </div>
  );
}
