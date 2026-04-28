import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { customersApi } from "../services/api";

export default function Register() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
    documentType: "DNI",
    cuit: "",
    // company: "",  // eliminado — campo innecesario según el negocio
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.password || !form.phone.trim() || !form.cuit.trim()) {
      toast.error("Nombre, email, contraseña, teléfono y número de documento son requeridos");
      return;
    }

    if (form.password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    if (form.password !== form.confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    try {
      // Enviamos sin confirmPassword (solo el backend necesita password)
      const { confirmPassword, ...data } = form;
      await customersApi.register(data);
      setSubmitted(true);
    } catch (err) {
      const msg = err.response?.data?.error || "Error al enviar la solicitud";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {submitted ? (
            // Estado: solicitud enviada exitosamente
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">¡Solicitud enviada!</h2>
              <p className="text-slate-500 mb-6">
                Tu solicitud de registro fue recibida. El administrador la revisará y
                te contactaremos a <span className="font-semibold text-slate-700">{form.email}</span>.
              </p>
              <Link
                to="/"
                className="inline-block bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-blue-700 transition-colors"
              >
                Volver al inicio
              </Link>
            </div>
          ) : (
            // Formulario de registro
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-slate-800">Crear cuenta</h1>
                <p className="text-slate-500 text-sm mt-1">
                  Completá el formulario y el admin aprobará tu acceso
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Nombre */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nombre completo <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Juan Pérez"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="juan@ejemplo.com"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                {/* Contraseña */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Contraseña <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                {/* Confirmar contraseña */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Confirmar contraseña <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={form.confirmPassword}
                    onChange={handleChange}
                    placeholder="Repetí tu contraseña"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                {/* Teléfono */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Teléfono <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="+54 11 1234-5678"
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                {/* Tipo de documento + número */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Documento <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    {/* Selector de tipo */}
                    <div className="flex rounded-xl border border-slate-300 overflow-hidden text-sm">
                      {["DNI", "CUIT", "CUIL"].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setForm((p) => ({ ...p, documentType: type }))}
                          className={`px-3 py-2.5 font-medium transition-colors ${
                            form.documentType === type
                              ? "bg-blue-600 text-white"
                              : "bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                    {/* Número de documento */}
                    <input
                      type="text"
                      name="cuit"
                      value={form.cuit}
                      onChange={handleChange}
                      placeholder={
                        form.documentType === "DNI" ? "12345678" : "20-12345678-9"
                      }
                      className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                  </div>
                </div>

                {/* Empresa eliminada — no se solicita en el registro */}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60"
                >
                  {loading ? "Enviando..." : "Solicitar registro"}
                </button>
              </form>

              <p className="text-center text-sm text-slate-500 mt-6">
                ¿Ya tenés cuenta?{" "}
                <Link to="/login" className="text-blue-600 hover:underline">
                  Iniciá sesión
                </Link>
              </p>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
