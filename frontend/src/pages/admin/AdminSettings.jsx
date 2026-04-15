import { useState, useEffect } from "react";
import AdminLayout from "../../components/AdminLayout";
import { settingsApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

const SECTIONS = [
  { id: "mantenimiento", label: "Modo mantenimiento", icon: "🔧" },
  // Aquí se pueden agregar más secciones en el futuro
];

// Convierte un Date a string compatible con <input type="datetime-local"> (YYYY-MM-DDTHH:MM)
function toDatetimeLocal(date) {
  if (!date) return "";
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminSettings() {
  const { refetch } = useSiteConfig();
  const [activeSection, setActiveSection] = useState("mantenimiento");
  const [maintenance, setMaintenance] = useState(false);
  // scheduledInput: string en formato datetime-local ("YYYY-MM-DDTHH:MM") para el input
  const [scheduledInput, setScheduledInput] = useState("");
  // scheduledSaved: ISO string guardado en el backend (vacío = sin programar)
  const [scheduledSaved, setScheduledSaved] = useState("");
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
    settingsApi
      .get()
      .then((res) => {
        const maintenanceOn = res.data.maintenance === "true";
        const raw = res.data.maintenanceScheduledAt || "";
        const scheduledDate = raw ? new Date(raw) : null;
        const scheduleExpired = scheduledDate && scheduledDate <= new Date();

        // Si la hora programada ya pasó y el mantenimiento aún no está activado en el backend,
        // lo activamos automáticamente y limpiamos el schedule para que el toggle quede consistente.
        if (!maintenanceOn && scheduleExpired) {
          settingsApi.update({ maintenance: "true", maintenanceScheduledAt: "" })
            .then(() => {
              setMaintenance(true);
              setScheduledSaved("");
              setScheduledInput("");
              refetch();
            })
            .catch(console.error);
        } else {
          setMaintenance(maintenanceOn);
          setScheduledSaved(raw);
          setScheduledInput(raw && !scheduleExpired ? toDatetimeLocal(scheduledDate) : "");
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refetch]);

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

  // Guardar la fecha programada
  const handleSaveSchedule = async () => {
    if (!scheduledInput) {
      toast.error("Seleccioná una fecha y hora");
      return;
    }
    const date = new Date(scheduledInput);
    if (isNaN(date.getTime()) || date <= new Date()) {
      toast.error("La fecha debe ser en el futuro");
      return;
    }
    setSavingSchedule(true);
    try {
      await settingsApi.update({ maintenanceScheduledAt: date.toISOString() });
      setScheduledSaved(date.toISOString());
      refetch();
      toast.success("Mantenimiento programado");
    } catch {
      toast.error("Error al programar");
    } finally {
      setSavingSchedule(false);
    }
  };

  // Cancelar la programación
  const handleCancelSchedule = async () => {
    setSavingSchedule(true);
    try {
      await settingsApi.update({ maintenanceScheduledAt: "" });
      setScheduledSaved("");
      setScheduledInput("");
      refetch();
      toast.success("Programación cancelada");
    } catch {
      toast.error("Error al cancelar");
    } finally {
      setSavingSchedule(false);
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

                {/* Botón guardar toggle */}
                <div className="flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </button>
                </div>

                {/* Card de programación — solo visible cuando el mantenimiento está desactivado */}
                {!maintenance && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                    <div>
                      <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                        <span>🗓️</span> Programar mantenimiento
                      </h3>
                      <p className="text-sm text-slate-500 mt-1">
                        Elegí una fecha y hora para que el sitio entre en mantenimiento automáticamente.
                        Los clientes verán un banner con la cuenta regresiva hasta ese momento.
                      </p>
                    </div>

                    {/* Fecha programada actualmente guardada */}
                    {scheduledSaved && (
                      <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm">
                        <div className="flex items-center gap-2 text-amber-800">
                          <span>⏳</span>
                          <span>
                            Programado para el{" "}
                            <strong>
                              {new Date(scheduledSaved).toLocaleString("es-AR", {
                                weekday: "long", day: "numeric", month: "long",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </strong>
                          </span>
                        </div>
                        <button
                          onClick={handleCancelSchedule}
                          disabled={savingSchedule}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 underline underline-offset-2 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}

                    {/* Input de fecha/hora + botón programar */}
                    <div className="flex gap-3 items-end">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                          Fecha y hora
                        </label>
                        <input
                          type="datetime-local"
                          value={scheduledInput}
                          onChange={(e) => setScheduledInput(e.target.value)}
                          // El mínimo es "ahora" para evitar programar en el pasado
                          min={toDatetimeLocal(new Date())}
                          className="input text-sm"
                        />
                      </div>
                      <button
                        onClick={handleSaveSchedule}
                        disabled={savingSchedule || !scheduledInput}
                        className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl disabled:opacity-50 transition-colors text-sm whitespace-nowrap"
                      >
                        {savingSchedule ? "Guardando…" : scheduledSaved ? "Actualizar" : "Programar"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
