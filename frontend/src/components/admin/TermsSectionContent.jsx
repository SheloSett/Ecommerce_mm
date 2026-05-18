import { useState, useEffect } from "react";
import { settingsApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

const DEFAULT_SECTIONS = [
  { title: "1. Aceptación", content: "Al acceder y utilizar el sitio web igwtstore.com.ar, aceptás estos Términos y Condiciones en su totalidad. Si no estás de acuerdo, te pedimos que no utilices el sitio." },
  { title: "2. Productos y precios", content: "- Los precios están expresados en pesos argentinos (ARS) e incluyen IVA.\n- Nos reservamos el derecho de modificar precios sin previo aviso.\n- Las imágenes de los productos son ilustrativas y pueden diferir levemente del producto real.\n- El stock es limitado. La disponibilidad se confirma al procesar el pedido." },
  { title: "3. Proceso de compra", content: "Al realizar un pedido, recibirás una confirmación por email. Esto no garantiza la disponibilidad del producto hasta que confirmemos el stock y el pago. Nos reservamos el derecho de cancelar pedidos ante errores de precio o falta de stock, en cuyo caso realizaremos el reembolso correspondiente." },
  { title: "4. Métodos de pago", content: "- MercadoPago: tarjeta de crédito, débito o dinero en cuenta.\n- Transferencia bancaria: los datos se envían por email tras confirmar el pedido.\n- Efectivo: coordinamos entrega y cobro directamente con el cliente.\n\nPara clientes mayoristas, los precios y condiciones se acuerdan mediante cotización." },
  { title: "5. Envíos y entregas", content: "Los plazos y costos de envío se informan al confirmar el pedido. No nos hacemos responsables por demoras causadas por terceros (correos, transportistas). El riesgo de pérdida o daño pasa al comprador una vez entregado el producto al servicio de envío." },
  { title: "6. Devoluciones y garantías", content: "Conforme a la Ley 24.240 de Defensa del Consumidor, tenés derecho a arrepentirte de la compra dentro de los 10 días hábiles desde la recepción del producto, siempre que se encuentre en su estado original y sin uso.\n\nLos productos con defectos de fábrica tienen garantía legal. Para iniciar un reclamo, contactanos a info@igwtstore.com.ar." },
  { title: "7. Cuenta de usuario", content: "Sos responsable de mantener la confidencialidad de tu contraseña y de todas las actividades realizadas desde tu cuenta. Notificanos de inmediato ante cualquier uso no autorizado." },
  { title: "8. Propiedad intelectual", content: "Todo el contenido del sitio (imágenes, textos, logo, diseño) es propiedad de IGWT Store o de sus proveedores y está protegido por las leyes de propiedad intelectual. Queda prohibida su reproducción sin autorización expresa." },
  { title: "9. Jurisdicción", content: "Estos términos se rigen por las leyes de la República Argentina. Ante cualquier controversia, las partes se someten a la jurisdicción de los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires." },
  { title: "10. Contacto", content: "Para consultas sobre estos términos, escribinos a info@igwtstore.com.ar." },
];

export default function TermsSectionContent() {
  const { refetch } = useSiteConfig();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsApi.get().then((res) => {
      try { if (res.data.termsSections) setSections(JSON.parse(res.data.termsSections)); } catch {}
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try { await settingsApi.update({ termsSections: JSON.stringify(sections) }); refetch(); toast.success("Términos guardados"); }
    catch { toast.error("Error al guardar"); }
    finally { setSaving(false); }
  };

  const updateSection = (i, field, value) => {
    const next = [...sections];
    next[i] = { ...next[i], [field]: value };
    setSections(next);
  };

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
      <div>
        <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
          <span>📄</span> Términos y condiciones
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Cada sección tiene un título y contenido. Usá <code className="bg-slate-100 px-1 rounded text-xs">- texto</code> para crear listas con guiones.
        </p>
      </div>

      <div className="space-y-4">
        {sections.map((s, i) => (
          <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input className="input flex-1 text-sm font-semibold" value={s.title}
                onChange={(e) => updateSection(i, "title", e.target.value)}
                placeholder="Título de la sección" />
              <button type="button" onClick={() => setSections(sections.filter((_, j) => j !== i))}
                className="text-red-400 hover:text-red-600 font-bold text-xl px-1 flex-shrink-0 leading-none" title="Eliminar">✕</button>
            </div>
            <textarea className="input w-full text-sm resize-none" style={{ minHeight: "80px" }} value={s.content}
              onChange={(e) => updateSection(i, "content", e.target.value)}
              placeholder="Contenido de la sección. Usá '- ítem' para listas." />
          </div>
        ))}

        <button type="button"
          onClick={() => setSections([...sections, { title: `${sections.length + 1}. Nueva sección`, content: "" }])}
          className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
          + Agregar sección
        </button>
      </div>

      <div className="flex justify-end pt-2 border-t border-slate-100">
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
          {saving ? "Guardando…" : "Guardar términos"}
        </button>
      </div>
    </div>
  );
}
