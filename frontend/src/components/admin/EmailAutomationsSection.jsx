import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { settingsApi, productsApi, emailTestApi, customersApi } from "../../services/api";

// Emails automáticos (Admin → Emails → Automáticos): las recomendaciones a minoristas, los
// recordatorios a mayoristas y el panel para probarlos. Antes era la sección "Campañas de email" de
// Configuración (AdminSettings.jsx); se movió tal cual, con su propia carga de la configuración.
const imgUrl = (img) =>
  img.startsWith("http") ? img : `${import.meta.env.VITE_API_URL?.replace("/api", "") || "http://localhost:4000"}${img}`;

export default function EmailAutomationsSection() {
  // Campañas de email
  const [emailFrequency, setEmailFrequency]           = useState("7");
  const [emailHour, setEmailHour]                     = useState("9");
  const [emailProductCount, setEmailProductCount]     = useState("4");
  const [emailFeatured, setEmailFeatured]             = useState([]); // [{id, name, images}]
  const [emailSearch, setEmailSearch]                 = useState("");
  const [emailSearchResults, setEmailSearchResults]   = useState([]);
  const [searchingProducts, setSearchingProducts]     = useState(false);
  const [savingEmails, setSavingEmails]               = useState(false);
  const searchTimeoutRef = useRef(null);

  // Testing manual de campañas de email — disparar emails sin esperar el cron
  const [testEmailTarget, setTestEmailTarget] = useState("");
  const [sendingTestRestock, setSendingTestRestock] = useState(false);
  const [sendingTestRecomm, setSendingTestRecomm] = useState(false);
  // Autocomplete: lista de sugerencias y cliente exacto seleccionado
  const [testEmailSuggestions, setTestEmailSuggestions] = useState([]);
  const [testEmailSelectedCustomer, setTestEmailSelectedCustomer] = useState(null); // { type: "MAYORISTA" | "MINORISTA" }
  const testEmailSearchTimeoutRef = useRef(null);

  useEffect(() => {
    settingsApi.get()
      .then((res) => {
        setEmailFrequency(res.data.emailMinoristaFrequencyDays || "7");
        setEmailHour(res.data.emailMinoristaHour || "9");
        setEmailProductCount(res.data.emailMinoristaProductCount || "4");
        try {
          // Se guarda como [{id, name, images}] para poder mostrarlos sin otra llamada a la API
          const saved = JSON.parse(res.data.emailMinoristaFeaturedProducts || "[]");
          if (Array.isArray(saved) && saved.length > 0 && typeof saved[0] === "object") {
            setEmailFeatured(saved);
          }
        } catch {}
      })
      .catch(() => toast.error("Error al cargar la configuración de emails"));
  }, []);

  // Buscar clientes para autocompletar (debounced — usa el endpoint /customers?search=)
  const handleTestEmailSearch = (value) => {
    setTestEmailTarget(value);
    setTestEmailSelectedCustomer(null); // si edita el input, deselecciona el cliente actual
    clearTimeout(testEmailSearchTimeoutRef.current);
    if (!value.trim() || value.trim().length < 2) {
      setTestEmailSuggestions([]);
      return;
    }
    testEmailSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await customersApi.getAll({ search: value.trim() });
        // El endpoint puede devolver { customers: [...] } o un array directo según implementación
        const list = Array.isArray(res.data) ? res.data : (res.data.customers || []);
        setTestEmailSuggestions(list.slice(0, 6));
      } catch { setTestEmailSuggestions([]); }
    }, 250);
  };

  // Al elegir una sugerencia: setear el email Y guardar el tipo del cliente
  const handlePickTestEmailSuggestion = (customer) => {
    setTestEmailTarget(customer.email);
    setTestEmailSelectedCustomer(customer);
    setTestEmailSuggestions([]);
  };

  // Disparar manualmente el email de restock (mayoristas) — para testing
  const handleSendTestRestock = async () => {
    if (!testEmailTarget.trim()) { toast.error("Ingresá un email"); return; }
    setSendingTestRestock(true);
    try {
      const res = await emailTestApi.sendRestock(testEmailTarget.trim());
      toast.success(`Email enviado a ${res.data.sentTo}`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al enviar");
    } finally { setSendingTestRestock(false); }
  };

  // Disparar manualmente el email de recomendaciones (minoristas) — para testing
  const handleSendTestRecomm = async () => {
    if (!testEmailTarget.trim()) { toast.error("Ingresá un email"); return; }
    setSendingTestRecomm(true);
    try {
      const res = await emailTestApi.sendRecommendation(testEmailTarget.trim());
      toast.success(`Email enviado a ${res.data.sentTo} (${res.data.productsCount} productos)`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al enviar");
    } finally { setSendingTestRecomm(false); }
  };

  // Buscar productos para la sección de campañas de email (debounced)
  const handleEmailProductSearch = (value) => {
    setEmailSearch(value);
    clearTimeout(searchTimeoutRef.current);
    if (!value.trim()) { setEmailSearchResults([]); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      setSearchingProducts(true);
      try {
        const res = await productsApi.getAllAdmin({ search: value, limit: 8 });
        const list = Array.isArray(res.data) ? res.data : (res.data?.products || []);
        setEmailSearchResults(list.filter((p) => p.active && !emailFeatured.some((f) => f.id === p.id)));
      } catch {}
      finally { setSearchingProducts(false); }
    }, 350);
  };

  const handleAddFeatured = (product) => {
    setEmailFeatured((prev) => [...prev, product]);
    setEmailSearchResults([]);
    setEmailSearch("");
  };

  const handleRemoveFeatured = (id) => {
    setEmailFeatured((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSaveEmails = async () => {
    const freq = parseInt(emailFrequency);
    const count = parseInt(emailProductCount);
    if (isNaN(freq) || freq < 1) return toast.error("La frecuencia debe ser al menos 1 día");
    if (isNaN(count) || count < 1 || count > 12) return toast.error("La cantidad debe ser entre 1 y 12");
    setSavingEmails(true);
    try {
      await settingsApi.update({
        emailMinoristaFrequencyDays: String(freq),
        emailMinoristaHour: String(emailHour),
        emailMinoristaProductCount: String(count),
        // Guardar id+name+images para poder mostrarlos al cargar sin hacer otra llamada
        emailMinoristaFeaturedProducts: JSON.stringify(
          emailFeatured.map((p) => ({ id: p.id, name: p.name, images: p.images ?? [] }))
        ),
      });
      toast.success("Campaña de email guardada");
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSavingEmails(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
        <div>
          <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <span>🛍</span> Recomendaciones — Minoristas
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Configurá los emails de recomendación que reciben los clientes minoristas, con productos relacionados a su última compra.
            Los que se dieron de baja de las promociones no los reciben.
          </p>
        </div>

        {/* Frecuencia y hora */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Frecuencia <span className="text-slate-400 font-normal">(días)</span>
            </label>
            <input
              type="number" min="1" max="90"
              value={emailFrequency}
              onChange={(e) => setEmailFrequency(e.target.value)}
              className="input text-sm w-full"
              placeholder="7"
            />
            <p className="text-xs text-slate-400 mt-1">Cada cuántos días se envía el email</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Hora de envío <span className="text-slate-400 font-normal">(Argentina)</span>
            </label>
            <select
              value={emailHour}
              onChange={(e) => setEmailHour(e.target.value)}
              className="input text-sm w-full"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={String(i)}>
                  {String(i).padStart(2, "0")}:00 hs
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Cantidad de productos
            </label>
            <input
              type="number" min="1" max="12"
              value={emailProductCount}
              onChange={(e) => setEmailProductCount(e.target.value)}
              className="input text-sm w-full"
              placeholder="4"
            />
            <p className="text-xs text-slate-400 mt-1">Productos que aparecen en el email</p>
          </div>
        </div>

        {/* Productos destacados */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            Productos destacados <span className="text-slate-400 font-normal">(opcionales)</span>
          </label>
          <p className="text-xs text-slate-500 mb-3">
            Estos productos aparecen primero en el email de todos los minoristas, completando con productos relacionados a su última compra.
          </p>

          {/* Buscador */}
          <div className="relative mb-3">
            <input
              type="text"
              value={emailSearch}
              onChange={(e) => handleEmailProductSearch(e.target.value)}
              placeholder="Buscar producto por nombre..."
              className="input text-sm w-full pr-8"
            />
            {searchingProducts && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {emailSearchResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                {emailSearchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleAddFeatured(p)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 text-left text-sm"
                  >
                    {p.images?.[0] && (
                      <img src={imgUrl(p.images[0])} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                    )}
                    <span className="flex-1 text-slate-700 truncate">{p.name}</span>
                    <span className="text-xs text-blue-600 font-semibold">Agregar</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Lista de seleccionados */}
          {emailFeatured.length === 0 ? (
            <p className="text-sm text-slate-400 italic">
              Sin productos destacados — se usarán los de la categoría del cliente.
            </p>
          ) : (
            <div className="space-y-2">
              {emailFeatured.map((p) => (
                <div key={p.id} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  {p.images?.[0] && (
                    <img src={imgUrl(p.images[0])} alt="" className="w-9 h-9 rounded object-cover flex-shrink-0" />
                  )}
                  <span className="flex-1 text-sm text-slate-700 truncate">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFeatured(p.id)}
                    className="text-red-400 hover:text-red-600 text-xs font-semibold px-2 py-1 rounded hover:bg-red-50 transition-colors"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <button
            onClick={handleSaveEmails}
            disabled={savingEmails}
            className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
          >
            {savingEmails ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* Info mayoristas */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-bold text-slate-800 text-base flex items-center gap-2 mb-2">
          <span>🏭</span> Recordatorios a mayoristas
        </h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          Los clientes mayoristas reciben emails automáticos cuando llevan tiempo sin comprar.
          El ritmo es fijo: <strong>día 20 → +5 días → +7 días → cada 14 días</strong>.
          Cada cliente puede darse de baja desde el link en el email, y puede reactivarlo desde su perfil.
        </p>
      </div>

      {/* Panel de testing — disparar emails manualmente sin esperar el cron */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="font-bold text-amber-900 text-base flex items-center gap-2 mb-1">
            <span>🧪</span> Probar los emails automáticos
          </h3>
          <p className="text-sm text-amber-800/80 leading-relaxed">
            Buscá el cliente por email o nombre y dispará el email correspondiente a su tipo.
            El cliente <strong>debe tener al menos un pedido aprobado</strong>. Esto bypassa los checks de tiempo del cron.
          </p>
        </div>
        {/* Input con autocomplete */}
        <div className="relative max-w-md">
          <label className="block text-xs font-semibold text-amber-900 mb-1">Cliente destino</label>
          <input
            type="text"
            value={testEmailTarget}
            onChange={(e) => handleTestEmailSearch(e.target.value)}
            placeholder="Email o nombre del cliente..."
            className="input w-full"
            autoComplete="off"
          />
          {/* Sugerencias */}
          {testEmailSuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 max-h-64 overflow-y-auto">
              {testEmailSuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handlePickTestEmailSuggestion(c)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 text-sm truncate">{c.name}</p>
                    <p className="text-xs text-slate-500 truncate">{c.email}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${c.type === "MAYORISTA" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                    {c.type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cliente seleccionado: muestra el tipo y solo el botón apropiado */}
        {testEmailSelectedCustomer && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-amber-900">Cliente seleccionado:</span>
            <span className="font-semibold text-slate-800">{testEmailSelectedCustomer.name}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${testEmailSelectedCustomer.type === "MAYORISTA" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
              {testEmailSelectedCustomer.type}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {/* Si hay un cliente seleccionado, mostramos solo el botón apropiado a su tipo.
              Si no, mostramos los dos (el admin puede enviar manualmente con un email tipeado). */}
          {(!testEmailSelectedCustomer || testEmailSelectedCustomer.type === "MAYORISTA") && (
            <button
              onClick={handleSendTestRestock}
              disabled={sendingTestRestock || !testEmailTarget.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {sendingTestRestock ? "Enviando…" : "🏭 Enviar restock (mayorista)"}
            </button>
          )}
          {(!testEmailSelectedCustomer || testEmailSelectedCustomer.type === "MINORISTA") && (
            <button
              onClick={handleSendTestRecomm}
              disabled={sendingTestRecomm || !testEmailTarget.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {sendingTestRecomm ? "Enviando…" : "🛍 Enviar recomendaciones (minorista)"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
