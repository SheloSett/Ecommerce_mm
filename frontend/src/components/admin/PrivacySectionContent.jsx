import { useState, useEffect } from "react";
import { settingsApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

const DEFAULT_SECTIONS = [
  { title: "1. Responsable del tratamiento", content: "IGWT Store, con dominio igwtstore.com.ar, es responsable del tratamiento de los datos personales recopilados a través de este sitio web, en cumplimiento de la Ley N° 25.326 de Protección de Datos Personales de la República Argentina y su decreto reglamentario." },
  { title: "2. Datos que recopilamos", content: "Al registrarte o realizar una compra, podemos recopilar los siguientes datos:\n- Nombre completo\n- Dirección de correo electrónico\n- Número de teléfono\n- CUIT / CUIL\n- Empresa u organización (opcional)\n- Historial de pedidos y cotizaciones" },
  { title: "3. Finalidad del tratamiento", content: "Utilizamos tus datos para:\n- Procesar tus pedidos y cotizaciones\n- Enviarte confirmaciones y novedades sobre tu compra\n- Gestionar tu cuenta de cliente\n- Mejorar nuestros productos y servicios\n- Cumplir con obligaciones legales y fiscales" },
  { title: "4. Compartición de datos", content: "No vendemos ni cedemos tus datos personales a terceros. Solo los compartimos con proveedores de servicios necesarios para operar el sitio (como MercadoPago para el procesamiento de pagos), quienes están obligados a tratar tus datos con la misma confidencialidad." },
  { title: "5. Seguridad", content: "Implementamos medidas técnicas y organizativas para proteger tus datos contra acceso no autorizado, pérdida o alteración. Las contraseñas se almacenan cifradas y nunca en texto plano." },
  { title: "6. Tus derechos", content: "En virtud de la Ley 25.326, tenés derecho a acceder, rectificar, actualizar y suprimir tus datos personales en cualquier momento. Para ejercer estos derechos, contactanos a: info@igwtstore.com.ar\n\nLa DIRECCIÓN NACIONAL DE PROTECCIÓN DE DATOS PERSONALES, órgano de control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales." },
  { title: "7. Cookies", content: "Este sitio utiliza el almacenamiento local del navegador (localStorage) para recordar tu preferencia de tema (claro/oscuro) y mantener tu sesión activa. No utilizamos cookies de rastreo de terceros ni publicidad." },
  { title: "8. Cambios en esta política", content: "Podemos actualizar esta política en cualquier momento. Te notificaremos por email si los cambios son significativos. El uso continuado del sitio implica aceptación de la política vigente." },
];

export default function PrivacySectionContent() {
  const { refetch } = useSiteConfig();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    settingsApi.get().then((res) => {
      try { if (res.data.privacySections) setSections(JSON.parse(res.data.privacySections)); } catch {}
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try { await settingsApi.update({ privacySections: JSON.stringify(sections) }); refetch(); toast.success("Política guardada"); }
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
          <span>🔒</span> Política de privacidad
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
          {saving ? "Guardando…" : "Guardar política"}
        </button>
      </div>
    </div>
  );
}
