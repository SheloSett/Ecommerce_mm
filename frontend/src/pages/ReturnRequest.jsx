import { useState } from "react";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { returnsApi } from "../services/api";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

export default function ReturnRequest() {
  const { customer } = useCustomerAuth();

  const [form, setForm] = useState({
    customerName:  customer?.name  || "",
    customerEmail: customer?.email || "",
    customerPhone: customer?.phone || "",
    reason:        "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.customerName.trim() || !form.customerEmail.trim() || !form.reason.trim()) {
      return toast.error("Completá todos los campos obligatorios.");
    }
    if (form.reason.trim().length < 10) {
      return toast.error("El mensaje debe tener al menos 10 caracteres.");
    }

    setSubmitting(true);
    try {
      await returnsApi.create({
        customerName:  form.customerName.trim(),
        customerEmail: form.customerEmail.trim(),
        customerPhone: form.customerPhone.trim(),
        reason:        form.reason.trim(),
      });
      setSubmitted(true);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al enviar la solicitud.");
    } finally {
      setSubmitting(false);
    }
  }

  // Clases de input reutilizables — antes se usaba la clase CSS global "input"
  const inputClass = "w-full bg-white border border-[#bdcaba]/50 rounded-xl px-4 py-2.5 text-sm text-[#0b1c30] placeholder-[#565e74]/50 focus:outline-none focus:ring-2 focus:ring-[#006b2c]/30 focus:border-[#006b2c] transition-colors";

  return (
    // Antes: bg-slate-50 — actualizado a token del sistema de diseño
    // <div className="min-h-screen flex flex-col bg-slate-50">
    <div className="ds-page min-h-screen flex flex-col bg-[#f8f9ff]">
      <Navbar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-12">

        {/* Encabezado */}
        <div className="mb-8">
          {/* Antes: <h1 className="text-2xl font-bold text-slate-800 mb-2"> */}
          <div className="flex items-center gap-3 mb-2">
            <span
              className="material-symbols-outlined text-[#006b2c] text-[28px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >assignment_return</span>
            <h1 className="text-2xl font-bold text-[#0b1c30]" style={{ fontFamily: "Outfit" }}>
              Botón de Arrepentimiento
            </h1>
          </div>
          {/* Antes: <p className="text-slate-500 text-sm leading-relaxed"> */}
          <p className="text-[#565e74] text-sm leading-relaxed ml-10">
            Según la <strong className="text-[#0b1c30]">Ley 24.240 de Defensa del Consumidor</strong>, tenés derecho a arrepentirte
            de una compra realizada por medios electrónicos dentro de los{" "}
            <strong className="text-[#0b1c30]">10 días corridos</strong> a partir de la fecha de recepción del producto.{" "}
            Pasado ese tiempo, no se aceptarán las devoluciones.
          </p>
        </div>

        {/* Aviso condición — antes: bg-amber-50 border-amber-200 */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex gap-3">
          {/* Antes: emoji ⚠️ — reemplazado por Material Symbol */}
          {/* <span className="text-amber-500 text-xl shrink-0">⚠️</span> */}
          <span className="material-symbols-outlined text-amber-500 text-[22px] shrink-0 mt-0.5"
            style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
          <div>
            <p className="font-semibold text-amber-800 text-sm mb-1">Condición de devolución</p>
            <p className="text-amber-700 text-sm leading-relaxed">
              Toda la mercadería debe encontrarse en el <strong>mismo estado en que fue recibida</strong>,
              sin uso y en perfecto estado, con su embalaje original e intacto.
              No se aceptarán devoluciones de productos usados, dañados o sin su embalaje original.
            </p>
          </div>
        </div>

        {/* Formulario / confirmación */}
        {submitted ? (
          // Antes: <div className="card p-10 text-center"> — reemplazado por clases inline del sistema de diseño
          // <div className="card p-10 text-center">
          <div className="bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] p-10 text-center">
            {/* Antes: emoji ✅ — reemplazado por Material Symbol */}
            {/* <div className="text-5xl mb-4">✅</div> */}
            <span
              className="material-symbols-outlined text-[64px] text-[#00873a] mb-4 block"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >check_circle</span>
            {/* Antes: <h2 className="text-xl font-bold text-slate-800 mb-2"> */}
            <h2 className="text-xl font-bold text-[#0b1c30] mb-2">Solicitud enviada</h2>
            {/* Antes: <p className="text-slate-500 text-sm mb-6"> */}
            <p className="text-[#565e74] text-sm mb-6">
              Recibimos tu solicitud. Te contactaremos a la brevedad al email{" "}
              <strong className="text-[#0b1c30]">{form.customerEmail}</strong> con la resolución.
            </p>
            {/* Antes: <button className="btn-secondary text-sm"> — reemplazado por clases inline */}
            {/* <button className="btn-secondary text-sm"> */}
            <button
              onClick={() => { setSubmitted(false); setForm((p) => ({ ...p, reason: "" })); }}
              className="px-6 py-2.5 bg-[#eff4ff] text-[#0b1c30] border border-[#bdcaba]/50 rounded-xl text-sm font-semibold hover:bg-[#dce9ff] transition-colors"
            >
              Volver
            </button>
          </div>
        ) : (
          // Antes: <div className="card p-6"> — reemplazado por clases inline del sistema de diseño
          // <div className="card p-6">
          <div className="bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] p-6">
            {/* Antes: <h2 className="font-semibold text-slate-700 mb-6"> */}
            <h2 className="font-semibold text-[#0b1c30] mb-6">Nueva solicitud de devolución</h2>

            <form onSubmit={handleSubmit} className="space-y-4">

              <div>
                {/* Antes: <label className="block text-sm font-medium text-slate-600 mb-1"> */}
                <label className="block text-sm font-medium text-[#565e74] mb-1.5">
                  Nombre <span className="text-[#ba1a1a]">*</span>
                </label>
                {/* Antes: <input className="input" ... /> — reemplazado por clases inline del sistema de diseño */}
                {/* <input className="input" ... /> */}
                <input
                  type="text"
                  name="customerName"
                  value={form.customerName}
                  onChange={handleChange}
                  placeholder="Tu nombre completo"
                  className={inputClass}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#565e74] mb-1.5">
                  Email <span className="text-[#ba1a1a]">*</span>
                </label>
                <input
                  type="email"
                  name="customerEmail"
                  value={form.customerEmail}
                  onChange={handleChange}
                  placeholder="tu@email.com"
                  className={inputClass}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#565e74] mb-1.5">
                  Teléfono
                </label>
                <input
                  type="tel"
                  name="customerPhone"
                  value={form.customerPhone}
                  onChange={handleChange}
                  placeholder="Ej: 11 1234-5678"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#565e74] mb-1.5">
                  Mensaje <span className="text-[#ba1a1a]">*</span>
                </label>
                <textarea
                  name="reason"
                  value={form.reason}
                  onChange={handleChange}
                  rows={5}
                  maxLength={1000}
                  placeholder="Indicá el número de pedido y el motivo de la devolución…"
                  className={`${inputClass} resize-none`}
                  required
                />
                {/* Antes: <p className="text-xs text-slate-400 mt-1 text-right"> */}
                <p className="text-xs text-[#565e74]/50 mt-1 text-right">{form.reason.length}/1000</p>
              </div>

              {/* Antes: <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500"> */}
              <div className="bg-[#eff4ff] border border-[#bdcaba]/30 rounded-xl p-3 text-xs text-[#565e74]">
                Al enviar esta solicitud confirmás que la mercadería se encuentra en el mismo estado
                en que la recibiste, en perfecto estado y con su embalaje original.
              </div>

              {/* Antes: <button className="btn-primary w-full"> — reemplazado por clases inline del sistema de diseño */}
              {/* <button className="btn-primary w-full"> */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-[#00873a] text-white font-bold rounded-xl hover:brightness-110 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Enviando…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">send</span>
                    Enviar solicitud
                  </>
                )}
              </button>

            </form>
          </div>
        )}

      </main>

      <Footer />
    </div>
  );
}
