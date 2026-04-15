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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Navbar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">

        {/* Encabezado legal */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Botón de Arrepentimiento</h1>
          <p className="text-slate-500 text-sm leading-relaxed">
            Según la <strong>Ley 24.240 de Defensa del Consumidor</strong>, tenés derecho a arrepentirte
            de una compra realizada por medios electrónicos dentro de los{" "}
            <strong>10 días corridos</strong> a partir de la fecha de recepción del producto.{" "}
            Pasado ese tiempo, no se aceptarán las devoluciones.
          </p>
        </div>

        {/* Aviso condición */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex gap-3">
          <span className="text-amber-500 text-xl shrink-0">⚠️</span>
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
          <div className="card p-10 text-center">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Solicitud enviada</h2>
            <p className="text-slate-500 text-sm mb-6">
              Recibimos tu solicitud. Te contactaremos a la brevedad al email{" "}
              <strong>{form.customerEmail}</strong> con la resolución.
            </p>
            <button
              onClick={() => { setSubmitted(false); setForm((p) => ({ ...p, reason: "" })); }}
              className="btn-secondary text-sm"
            >
              Volver
            </button>
          </div>
        ) : (
          <div className="card p-6">
            <h2 className="font-semibold text-slate-700 mb-6">Nueva solicitud de devolución</h2>

            <form onSubmit={handleSubmit} className="space-y-4">

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="customerName"
                  value={form.customerName}
                  onChange={handleChange}
                  placeholder="Tu nombre completo"
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  name="customerEmail"
                  value={form.customerEmail}
                  onChange={handleChange}
                  placeholder="tu@email.com"
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Teléfono
                </label>
                <input
                  type="tel"
                  name="customerPhone"
                  value={form.customerPhone}
                  onChange={handleChange}
                  placeholder="Ej: 11 1234-5678"
                  className="input"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Mensaje <span className="text-red-500">*</span>
                </label>
                <textarea
                  name="reason"
                  value={form.reason}
                  onChange={handleChange}
                  rows={5}
                  maxLength={1000}
                  placeholder="Indicá el número de pedido y el motivo de la devolución…"
                  className="input resize-none"
                  required
                />
                <p className="text-xs text-slate-400 mt-1 text-right">{form.reason.length}/1000</p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500">
                Al enviar esta solicitud confirmás que la mercadería se encuentra en el mismo estado
                en que la recibiste, en perfecto estado y con su embalaje original.
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full"
              >
                {submitting ? "Enviando…" : "Enviar solicitud"}
              </button>

            </form>
          </div>
        )}

      </main>

      <Footer />
    </div>
  );
}
