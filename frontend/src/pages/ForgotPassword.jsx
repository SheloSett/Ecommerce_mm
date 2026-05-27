import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { customersApi } from "../services/api";

// Tarjetas de soporte que aparecen debajo del card (solo desktop)
function SupportCards() {
  return (
    <div className="hidden md:grid grid-cols-3 gap-6 mt-10 max-w-[900px] mx-auto w-full px-4">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 flex items-start gap-4 shadow-sm">
        <span className="text-2xl flex-shrink-0">🛡️</span>
        <div>
          <h3 className="font-semibold text-slate-800 mb-1">Seguridad Avanzada</h3>
          <p className="text-xs text-slate-500 leading-relaxed">Tus datos están protegidos con encriptación para garantizar total privacidad.</p>
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl border border-slate-200 flex items-start gap-4 shadow-sm">
        <span className="text-2xl flex-shrink-0">💬</span>
        <div>
          <h3 className="font-semibold text-slate-800 mb-1">Soporte 24/7</h3>
          <p className="text-xs text-slate-500 leading-relaxed">Si tenés problemas para acceder, nuestro equipo está listo para ayudarte.</p>
        </div>
      </div>
      <div className="bg-white p-6 rounded-2xl border border-slate-200 flex items-start gap-4 shadow-sm">
        <span className="text-2xl flex-shrink-0">📱</span>
        <div>
          <h3 className="font-semibold text-slate-800 mb-1">Acceso Multiplataforma</h3>
          <p className="text-xs text-slate-500 leading-relaxed">Actualizá tu contraseña y accedé desde todos tus dispositivos.</p>
        </div>
      </div>
    </div>
  );
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.error("Ingresá tu email");
    setLoading(true);
    try {
      await customersApi.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch {
      toast.error("Ocurrió un error. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ds-page min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      {/* Glow decorativo de fondo */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-400/15 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-400/10 rounded-full blur-[120px] translate-y-1/2 -translate-x-1/2" />
      </div>

      <main className="flex-grow flex flex-col items-center justify-center px-4 py-12">

        {/* Card principal */}
        <div className="w-full max-w-[440px] bg-white border border-slate-200 rounded-2xl p-10 shadow-[0_4px_24px_rgba(15,23,42,0.07)]">

          {/* Ícono */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
          </div>

          {sent ? (
            /* Estado: email enviado */
            <div className="text-center">
              <h1 className="text-2xl font-bold text-slate-800 mb-3">Revisá tu email</h1>
              <p className="text-slate-500 text-sm leading-relaxed mb-2">
                Si existe una cuenta con{" "}
                <strong className="text-slate-700">{email}</strong>, vas a recibir
                un link para restablecer tu contraseña en los próximos minutos.
              </p>
              <p className="text-xs text-slate-400 mb-8">El link expira en 1 hora. Revisá también la carpeta de spam.</p>
              <Link
                to="/login"
                className="w-full inline-flex items-center justify-center gap-2 py-4 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-all active:scale-[0.98] uppercase tracking-wider text-sm shadow-md"
              >
                Volver al inicio de sesión
              </Link>
            </div>
          ) : (
            /* Formulario: ingresá tu email */
            <>
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-slate-800">¿Olvidaste tu contraseña?</h1>
                <p className="text-slate-500 text-sm mt-2 leading-relaxed">
                  Ingresá tu email y te enviamos un link para restablecerla.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                    Email de tu cuenta
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@email.com"
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-all active:scale-[0.98] uppercase tracking-wider text-sm shadow-md disabled:opacity-60"
                >
                  {loading ? "Enviando..." : "Enviar link de recuperación"}
                </button>
              </form>

              <div className="text-center mt-5">
                <Link to="/login" className="text-sm text-slate-500 hover:text-slate-700 transition-colors">
                  ← Volver al inicio de sesión
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Tarjetas de soporte (solo desktop) */}
        <SupportCards />
      </main>

      <Footer light />
    </div>
  );
}
