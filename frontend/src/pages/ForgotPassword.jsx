import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { customersApi } from "../services/api";

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
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            {/* Ícono */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
            </div>

            {sent ? (
              /* Estado: email enviado */
              <div className="text-center">
                <h1 className="text-2xl font-bold text-slate-800 mb-3">Revisá tu email</h1>
                <p className="text-slate-500 text-sm leading-relaxed mb-6">
                  Si existe una cuenta con <strong className="text-slate-700">{email}</strong>, vas a recibir un link para restablecer tu contraseña en los próximos minutos.
                </p>
                <p className="text-xs text-slate-400 mb-6">El link expira en 1 hora. Revisá también la carpeta de spam.</p>
                <Link
                  to="/login"
                  className="block w-full text-center py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors text-sm"
                >
                  Volver al inicio de sesión
                </Link>
              </div>
            ) : (
              /* Formulario */
              <>
                <div className="text-center mb-8">
                  <h1 className="text-2xl font-bold text-slate-800">¿Olvidaste tu contraseña?</h1>
                  <p className="text-slate-500 text-sm mt-1">
                    Ingresá tu email y te enviamos un link para restablecerla.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email de tu cuenta</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@email.com"
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60"
                  >
                    {loading ? "Enviando..." : "Enviar link de reseteo"}
                  </button>
                </form>

                <div className="text-center mt-6">
                  <Link to="/login" className="text-sm text-blue-600 hover:text-blue-700 transition-colors">
                    ← Volver al inicio de sesión
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
