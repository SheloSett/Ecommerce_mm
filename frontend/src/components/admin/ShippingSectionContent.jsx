import { useEffect, useState } from "react";
import { shippingApi } from "../../services/api";
import { motoDeliveryText } from "../../utils/shipping";
import { formatPrice } from "../../utils/formatPrice";
import toast from "react-hot-toast";

// Admin → Configuración → Envíos: precios por zona de la moto, hora de corte, días de reparto y qué códigos
// postales entran en cada zona. El checkout cotiza con esto y createOrder lo vuelve a calcular.
const DAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

export default function ShippingSectionContent() {
  const [config, setConfig]   = useState(null);
  const [saving, setSaving]   = useState(false);
  const [newClosedDate, setNewClosedDate] = useState("");
  const [openZone, setOpenZone] = useState(null); // zona con la lista de códigos postales desplegada
  // Probar una dirección: cotiza con lo GUARDADO, igual que el checkout.
  const [test, setTest] = useState({ postalCode: "", provinceCode: "B", city: "" });
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    shippingApi.getMotoConfig()
      .then((res) => setConfig(res.data))
      .catch(() => toast.error("Error al cargar la configuración de envíos"));
  }, []);

  if (!config) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const update = (fields) => setConfig((prev) => ({ ...prev, ...fields }));
  const updateZone = (id, fields) => update({ zones: config.zones.map((z) => (z.id === id ? { ...z, ...fields } : z)) });

  const toggleDay = (day) => {
    update({ workDays: config.workDays.includes(day) ? config.workDays.filter((d) => d !== day) : [...config.workDays, day] });
  };

  const addClosedDate = () => {
    if (!newClosedDate || config.closedDates.includes(newClosedDate)) return;
    update({ closedDates: [...config.closedDates, newClosedDate].sort() });
    setNewClosedDate("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await shippingApi.saveMotoConfig(config);
      setConfig(res.data);
      toast.success("Envíos guardados");
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      const res = await shippingApi.motoQuote(test);
      setTestResult(res.data);
    } catch {
      setTestResult({ available: false, message: "No se pudo cotizar" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
              <span>🛵</span> Envío en moto
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              En el checkout el cliente carga su dirección y el precio sale de la zona de su código postal.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={config.enabled}
            aria-label="Envío en moto activo"
            onClick={() => update({ enabled: !config.enabled })}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${config.enabled ? "bg-green-500" : "bg-slate-300"}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.enabled ? "translate-x-5" : ""}`} />
          </button>
        </div>

        {/* Hora de corte */}
        <div>
          <label htmlFor="moto-cutoff" className="block text-sm font-semibold text-slate-700 mb-1">Hora de corte</label>
          <input
            id="moto-cutoff"
            type="time"
            value={config.cutoffTime}
            onChange={(e) => update({ cutoffTime: e.target.value })}
            className="input text-sm w-40"
          />
          <p className="text-xs text-slate-400 mt-1">Antes de esta hora llega en el día; después, el próximo día de reparto.</p>
        </div>

        {/* Días de reparto */}
        <div>
          <p className="block text-sm font-semibold text-slate-700 mb-2">Días de reparto</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => toggleDay(value)}
                aria-pressed={config.workDays.includes(value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  config.workDays.includes(value) ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Feriados */}
        <div>
          <label htmlFor="moto-closed" className="block text-sm font-semibold text-slate-700 mb-1">Feriados y días sin reparto</label>
          <div className="flex gap-2">
            <input
              id="moto-closed"
              type="date"
              value={newClosedDate}
              onChange={(e) => setNewClosedDate(e.target.value)}
              className="input text-sm w-44"
            />
            <button type="button" onClick={addClosedDate} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold transition-colors">
              Agregar
            </button>
          </div>
          {config.closedDates.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {config.closedDates.map((date) => (
                <button
                  key={date}
                  type="button"
                  onClick={() => update({ closedDates: config.closedDates.filter((d) => d !== date) })}
                  aria-label={`Sacar ${date}`}
                  className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors"
                >
                  {date} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Zonas */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800 text-base">Precios por zona</h2>
          <p className="text-sm text-slate-500 mt-1">
            Si un código postal no está en ninguna zona, el checkout le dice al cliente que la moto no llega ahí.
          </p>
        </div>

        {config.zones.map((zone) => (
          <div key={zone.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[140px]">
                <label htmlFor={`zone-name-${zone.id}`} className="block text-xs font-semibold text-slate-600 mb-1">Zona</label>
                <input
                  id={`zone-name-${zone.id}`}
                  value={zone.name}
                  onChange={(e) => updateZone(zone.id, { name: e.target.value })}
                  className="input text-sm w-full"
                  maxLength={40}
                />
              </div>
              <div className="w-36">
                <label htmlFor={`zone-price-${zone.id}`} className="block text-xs font-semibold text-slate-600 mb-1">Precio ($)</label>
                <input
                  id={`zone-price-${zone.id}`}
                  type="number"
                  min="0"
                  value={zone.price}
                  onChange={(e) => updateZone(zone.id, { price: e.target.value })}
                  className="input text-sm w-full"
                />
              </div>
              <button
                type="button"
                onClick={() => setOpenZone(openZone === zone.id ? null : zone.id)}
                aria-expanded={openZone === zone.id}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold transition-colors"
              >
                {openZone === zone.id ? "Ocultar códigos postales" : "Ver códigos postales"}
              </button>
            </div>
            {openZone === zone.id && (
              <div>
                <label htmlFor={`zone-cps-${zone.id}`} className="block text-xs font-semibold text-slate-600 mb-1">Códigos postales de {zone.name}</label>
                <textarea
                  id={`zone-cps-${zone.id}`}
                  value={zone.postalCodes}
                  onChange={(e) => updateZone(zone.id, { postalCodes: e.target.value })}
                  rows={12}
                  className="input text-sm w-full font-mono"
                  spellCheck={false}
                />
                <p className="text-xs text-slate-400 mt-1">
                  Un renglón por código postal: <code>1708 Morón, Haedo</code>. Rangos: <code>1000-1499 CABA</code>. Los renglones con <code>#</code> son títulos.
                  Las localidades sirven para detectar una dirección que no coincide con el código postal.
                </p>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {/* Probar */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
        <div>
          <h2 className="font-bold text-slate-800 text-base">Probar una dirección</h2>
          <p className="text-sm text-slate-500 mt-1">Muestra lo mismo que va a ver el cliente, con lo último que guardaste.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <label htmlFor="test-cp" className="block text-xs font-semibold text-slate-600 mb-1">Código postal</label>
            <input id="test-cp" value={test.postalCode} onChange={(e) => setTest({ ...test, postalCode: e.target.value })} className="input text-sm w-full" placeholder="1708" />
          </div>
          <div className="w-40">
            <label htmlFor="test-province" className="block text-xs font-semibold text-slate-600 mb-1">Provincia</label>
            <select id="test-province" value={test.provinceCode} onChange={(e) => setTest({ ...test, provinceCode: e.target.value })} className="input text-sm w-full">
              <option value="C">CABA</option>
              <option value="B">Buenos Aires</option>
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="test-city" className="block text-xs font-semibold text-slate-600 mb-1">Localidad</label>
            <input id="test-city" value={test.city} onChange={(e) => setTest({ ...test, city: e.target.value })} className="input text-sm w-full" placeholder="Morón" />
          </div>
          <button type="button" onClick={handleTest} disabled={!test.postalCode.trim()} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors">
            Probar
          </button>
        </div>
        {testResult && (
          <div className={`rounded-xl px-4 py-3 text-sm ${testResult.available ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
            {testResult.available
              ? <><strong>{testResult.zoneName}</strong> · {formatPrice(testResult.price, "ARS")} · {motoDeliveryText(testResult.delivery)}</>
              : testResult.message}
          </div>
        )}
      </div>
    </div>
  );
}
