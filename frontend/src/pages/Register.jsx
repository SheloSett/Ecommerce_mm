import { useState } from "react";
// useNavigate: para redirigir al catálogo tras el registro (la cuenta ahora se crea al instante)
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { customersApi } from "../services/api";
import { useCustomerAuth } from "../context/CustomerAuthContext";

// Clase base compartida para inputs con icono a la izquierda
const inputCls =
  "w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all";

const inputClsRight =
  "w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all";

// Íconos inline (heroicons style) para los campos del formulario
function IconWrap({ children }) {
  return (
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
      {children}
    </span>
  );
}

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
  const navigate = useNavigate();
  // updateCustomerWithToken guarda token + datos en localStorage y estado → deja al usuario logueado
  const { updateCustomerWithToken } = useCustomerAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

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
      // Antes: await customersApi.register(data); setSubmitted(true);
      // Ahora la cuenta se crea al instante (sin aprobación del admin) y el backend devuelve un
      // token → dejamos al usuario logueado y lo mandamos al catálogo directamente.
      const res = await customersApi.register(data);
      if (res.data?.token && res.data?.customer) {
        updateCustomerWithToken(res.data.token, res.data.customer);
        toast.success("¡Cuenta creada! Ya estás conectado.");
        navigate("/catalogo");
      } else {
        // Fallback: si el backend todavía no devuelve token (versión anterior), mostrar la
        // pantalla de "solicitud enviada" como antes.
        setSubmitted(true);
      }
    } catch (err) {
      const msg = err.response?.data?.error || "Error al enviar la solicitud";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ds-page min-h-screen flex flex-col">
      <Navbar />

      {/* ── Layout split-screen: panel oscuro (izquierda) + formulario (derecha) ── */}
      <main className="flex-grow flex flex-col lg:flex-row min-h-[calc(100vh-64px)]">

        {/* Panel izquierdo: branding — solo visible en desktop */}
        <section className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden items-center justify-center px-12">
          {/* Glow de fondo decorativo */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
          </div>

          <div className="relative z-10 max-w-lg">
            <h1 className="text-5xl font-bold text-white mb-4 leading-tight tracking-tight">
              Impulsando tu negocio con precisión técnica.
            </h1>
            <p className="text-lg text-slate-400 mb-10 leading-relaxed">
              Únete a la red de mayoristas y minoristas de IGWT Store.
              Hardware de alta gama con soporte prioritario.
            </p>

            {/* Feature cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10">
                <div className="text-3xl mb-3">⚡</div>
                <h3 className="font-semibold text-white mb-1">Eficiencia</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Gestión de pedidos simplificada para profesionales.
                </p>
              </div>
              <div className="bg-white/5 backdrop-blur-sm p-5 rounded-2xl border border-white/10">
                <div className="text-3xl mb-3">🛡️</div>
                <h3 className="font-semibold text-white mb-1">Confianza</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Garantía oficial y soporte técnico especializado.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Panel derecho: formulario de registro */}
        <section className="w-full lg:w-1/2 flex items-start lg:items-center justify-center bg-white px-6 py-10 md:px-12 overflow-y-auto">
          <div className="w-full max-w-md">

            {submitted ? (
              /* Estado: solicitud enviada exitosamente */
              <div className="text-center py-12">
                <div className="text-6xl mb-4">✅</div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">¡Solicitud enviada!</h2>
                <p className="text-slate-500 mb-6">
                  Tu solicitud fue recibida. El administrador la revisará y te
                  contactaremos a{" "}
                  <span className="font-semibold text-slate-700">{form.email}</span>.
                </p>
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
                >
                  Volver al inicio
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              </div>
            ) : (
              /* Formulario de registro — diseño Stitch */
              <>
                {/* Encabezado */}
                <div className="mb-8 flex flex-col lg:items-start items-center text-center lg:text-left">
                  <span className="text-xl font-bold text-blue-600 mb-2">⚡ IGWT Store</span>
                  <h2 className="text-2xl font-bold text-slate-800">Crear una nueva cuenta</h2>
                  <p className="text-slate-500 text-sm mt-1">
                    Completá el formulario para solicitar tu acceso.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">

                  {/* Nombre completo */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-0.5">
                      Nombre completo
                    </label>
                    <div className="relative">
                      <IconWrap>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                        </svg>
                      </IconWrap>
                      <input
                        type="text"
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        placeholder="Ej: Juan Pérez"
                        className={inputCls}
                        required
                      />
                    </div>
                  </div>

                  {/* Email + Teléfono */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-0.5">
                        Email
                      </label>
                      <div className="relative">
                        <IconWrap>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                          </svg>
                        </IconWrap>
                        <input
                          type="email"
                          name="email"
                          value={form.email}
                          onChange={handleChange}
                          placeholder="email@ejemplo.com"
                          className={inputCls}
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-0.5">
                        Teléfono
                      </label>
                      <div className="relative">
                        <IconWrap>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                          </svg>
                        </IconWrap>
                        <input
                          type="tel"
                          name="phone"
                          value={form.phone}
                          onChange={handleChange}
                          placeholder="+54 11 1234-5678"
                          className={inputCls}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contraseña */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-0.5">
                      Contraseña
                    </label>
                    <div className="relative">
                      <IconWrap>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      </IconWrap>
                      <input
                        type={showPassword ? "text" : "password"}
                        name="password"
                        value={form.password}
                        onChange={handleChange}
                        placeholder="Mínimo 6 caracteres"
                        className={inputClsRight}
                        required
                      />
                      <EyeButton show={showPassword} onToggle={setShowPassword} />
                    </div>
                  </div>

                  {/* Confirmar contraseña */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-0.5">
                      Confirmar contraseña
                    </label>
                    <div className="relative">
                      <IconWrap>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      </IconWrap>
                      <input
                        type={showConfirm ? "text" : "password"}
                        name="confirmPassword"
                        value={form.confirmPassword}
                        onChange={handleChange}
                        placeholder="Repetí tu contraseña"
                        className={inputClsRight}
                        required
                      />
                      <EyeButton show={showConfirm} onToggle={setShowConfirm} />
                    </div>
                  </div>

                  {/* Tipo de documento + Número */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-0.5">
                        Tipo de documento
                      </label>
                      <div className="relative">
                        <IconWrap>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
                          </svg>
                        </IconWrap>
                        <select
                          name="documentType"
                          value={form.documentType}
                          onChange={handleChange}
                          className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all appearance-none cursor-pointer"
                        >
                          <option value="DNI">DNI</option>
                          <option value="CUIT">CUIT</option>
                          <option value="CUIL">CUIL</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 px-0.5">
                        Número
                      </label>
                      <input
                        type="text"
                        name="cuit"
                        value={form.cuit}
                        onChange={handleChange}
                        placeholder={form.documentType === "DNI" ? "12345678" : "20-12345678-9"}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        required
                      />
                    </div>
                  </div>

                  {/* Empresa eliminada — no se solicita en el registro */}

                  {/* Nota informativa */}
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex gap-3 items-start">
                    <span className="text-blue-500 text-base flex-shrink-0 mt-0.5">ℹ️</span>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Tu cuenta será revisada por nuestro equipo antes de ser activada para asegurar los beneficios de categoría profesional.
                    </p>
                  </div>

                  {/* Botón submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all active:scale-[0.98] shadow-md flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {loading ? (
                      "Enviando..."
                    ) : (
                      <>
                        Solicitar acceso
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </>
                    )}
                  </button>
                </form>

                {/* Link al login */}
                <p className="text-center text-sm text-slate-500 mt-6">
                  ¿Ya tenés cuenta?{" "}
                  <Link to="/login" className="text-blue-600 font-semibold hover:underline">
                    Iniciá sesión
                  </Link>
                </p>
              </>
            )}
          </div>
        </section>
      </main>

      <Footer noMargin />
    </div>
  );
}
