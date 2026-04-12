export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        {/* Icono animado */}
        <div className="text-6xl mb-6 animate-bounce">🔧</div>

        {/* Título */}
        <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
          Estamos en mantenimiento
        </h1>

        {/* Mensaje */}
        <p className="text-slate-400 text-lg mb-8 leading-relaxed">
          Estamos trabajando para mejorar tu experiencia.
          Volvemos pronto.
        </p>

        {/* Logo del local */}
        <div className="flex items-center justify-center gap-2 text-slate-500">
          <span className="text-blue-400 text-xl">⚡</span>
          <span className="font-bold text-lg text-slate-300">IGWT Store</span>
        </div>
      </div>
    </div>
  );
}
