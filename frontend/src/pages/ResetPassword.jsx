import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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

// Toggle ojo (mostrar/ocultar contraseña)
function EyeButton({ show, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle((v) => !v)}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
      tabIndex={-1}
    >
      {show ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )}
    </button>
  );
}

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ newPassword: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.newPassword.length < 6) return toast.error("La contraseña debe tener al menos 6 caracteres");
    if (form.newPassword !== form.confirm) return toast.error("Las contraseñas no coinciden");

    setLoading(true);
    try {
      await customersApi.resetPassword(token, form.newPassword);
      toast.success("Contraseña restablecida. Ahora podés iniciar sesión.");
      navigate("/login");
    } catch (err) {
      const msg = err.response?.data?.error || "El enlace expiró o no es válido.";
      toast.error(msg);
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
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Nueva contraseña</h1>
            <p className="text-slate-500 text-sm mt-1">Elegí una contraseña nueva para tu cuenta.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Nueva contraseña */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Nueva contraseña
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </span>
                <input
                  type={showNew ? "text" : "password"}
                  value={form.newPassword}
                  onChange={(e) => setForm((p) => ({ ...p, newPassword: e.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                  required
                />
                <EyeButton show={showNew} onToggle={setShowNew} />
              </div>
            </div>

            {/* Confirmar contraseña */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Confirmar contraseña
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </span>
                <input
                  type={showConfirm ? "text" : "password"}
                  value={form.confirm}
                  onChange={(e) => setForm((p) => ({ ...p, confirm: e.target.value }))}
                  placeholder="Repetí la contraseña"
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                  required
                />
                <EyeButton show={showConfirm} onToggle={setShowConfirm} />
              </div>
              {/* Validación en tiempo real */}
              {form.confirm && form.newPassword !== form.confirm && (
                <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
              )}
            </div>

            {/* Botón submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-all active:scale-[0.98] uppercase tracking-wider text-sm shadow-md disabled:opacity-60 mt-2"
            >
              {loading ? "Guardando..." : "Guardar nueva contraseña"}
            </button>
          </form>

          {/* Link para solicitar nuevo link */}
          <div className="text-center mt-5">
            <Link
              to="/olvide-mi-contrasena"
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Solicitar un nuevo link
            </Link>
          </div>
        </div>

        {/* Tarjetas de soporte (solo desktop) */}
        <SupportCards />
      </main>

      <Footer light />
    </div>
  );
}
