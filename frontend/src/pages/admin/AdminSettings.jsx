import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { settingsApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

const SECTIONS = [
  { id: "mantenimiento", label: "Modo mantenimiento", icon: "🔧" },
  // Aquí se pueden agregar más secciones en el futuro
];

export default function AdminSettings() {
  const { refetch } = useSiteConfig();
  const [activeSection, setActiveSection] = useState("mantenimiento");
  const [maintenance, setMaintenance] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    settingsApi
      .get()
      .then((res) => {
        setMaintenance(res.data.maintenance === "true");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.update({
        maintenance: maintenance ? "true" : "false",
      });
      refetch();
      toast.success("Configuración guardada");
    } catch (err) {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AdminLayout title="Configuración">
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Configuración">
      <div className="max-w-4xl mx-auto">
        <div className="flex gap-6">

          {/* ── Sidebar de secciones ── */}
          <aside className="w-52 flex-shrink-0">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Secciones
                </p>
              </div>
              <nav className="p-2 space-y-0.5">
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                      activeSection === s.id
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span>{s.icon}</span>
                    {s.label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          {/* ── Contenido de la sección activa ── */}
          <div className="flex-1 space-y-5">

            {activeSection === "mantenimiento" && (
              <>
                {/* Card principal */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-bold text-slate-800 text-base">Modo mantenimiento</h2>
                      <p className="text-sm text-slate-500 mt-1 max-w-sm">
                        Al activar, los clientes verán una página de "En mantenimiento".
                        El panel de admin sigue funcionando normalmente.
                      </p>
                    </div>
                    {/* Toggle */}
                    <button
                      type="button"
                      onClick={() => setMaintenance((m) => !m)}
                      className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${
                        maintenance ? "bg-red-500" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
                          maintenance ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Estado actual */}
                  <div className={`mt-5 rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${
                    maintenance
                      ? "bg-red-50 border border-red-200 text-red-700"
                      : "bg-emerald-50 border border-emerald-200 text-emerald-700"
                  }`}>
                    <span>{maintenance ? "🔴" : "🟢"}</span>
                    {maintenance
                      ? "La tienda está actualmente en mantenimiento."
                      : "La tienda está activa y visible para los clientes."}
                  </div>
                </div>

                {/* Botón guardar */}
                <div className="flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
