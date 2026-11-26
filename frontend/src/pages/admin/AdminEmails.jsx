import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import AdminLayout from "../../components/AdminLayout";
import EmailChangeRequests from "../../components/admin/EmailChangeRequests";
import EmailAutomationsSection from "../../components/admin/EmailAutomationsSection";
import { emailsApi, offersApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

// Admin → Emails. Pestañas (?tab=):
//   ""           Enviar email: escribir un email a todos, a un público o a clientes elegidos
//   campanas     Avisos de campañas: avisar por email una campaña de ofertas o un descuento por monto (a mano
//                o al empezar)
//   historial    Lo que se mandó, cómo va la cola y el tope diario
//   cambios      Cambios de email de los clientes (antes en Clientes)
//   automaticos  Recomendaciones y recordatorios automáticos (antes en Configuración)
// Los envíos no salen de golpe: van a una cola que el servidor manda de a poco (ver
// backend/src/services/broadcast.service.js).

const TITLES = {
  "": "Enviar email",
  campanas: "Avisos de campañas",
  historial: "Historial de envíos",
  cambios: "Cambios de email",
  automaticos: "Emails automáticos",
  whatsapp: "WhatsApp de avisos",
};

const AUDIENCE_OPTIONS = [
  { key: "ALL",       label: "Todos" },
  { key: "MINORISTA", label: "Minoristas" },
  { key: "MAYORISTA", label: "Mayoristas" },
  { key: "SELECTED",  label: "Elegir clientes" },
];
const AUDIENCE_LABEL = { ALL: "Todos", MINORISTA: "Minoristas", MAYORISTA: "Mayoristas", SELECTED: "Elegidos" };

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

// Vista previa del email: el HTML que arma el servidor, en un iframe aislado (sus estilos no se
// mezclan con los del panel).
function EmailPreview({ subject, html, loading, error }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Vista previa</p>
        <p className="text-sm text-slate-700 truncate">
          <span className="text-slate-400">Asunto: </span>
          {subject || <span className="italic text-slate-400">sin asunto</span>}
        </p>
      </div>
      {error ? (
        <div className="p-8 text-center text-sm text-slate-400">{error}</div>
      ) : (
        <div className="relative">
          {loading && <div className="absolute top-2 right-3 text-xs text-slate-400">Actualizando…</div>}
          <iframe title="Vista previa del email" srcDoc={html || ""} sandbox="" className="w-full h-[640px] bg-slate-100" />
        </div>
      )}
    </div>
  );
}

// El tipo con el que le llega el email: mayorista solo si está aprobado (igual que el servidor).
const effectiveType = (c) => (c.type === "MAYORISTA" && c.status === "APPROVED" ? "MAYORISTA" : "MINORISTA");

// Buscador de clientes con los elegidos como chips. Lo usan "Enviar email" y el aviso de una
// campaña a clientes elegidos. allowedType ("MAYORISTA" | "MINORISTA" | null): los clientes a los
// que no les corresponde (ej. un minorista en una campaña solo mayorista) aparecen sin poder elegirse.
function CustomerPicker({ selected, onChange, allowedType = null, hint, unsubscribedNote }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);

  // Con espera, para no consultar en cada tecla
  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      emailsApi.customers(search.trim()).then((r) => setResults(r.data)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente por nombre o email…"
          className="input w-full"
          autoComplete="off"
        />
        {results.length > 0 && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
            {results.map((c) => {
              const already = selected.some((s) => s.id === c.id);
              const notApplicable = allowedType && effectiveType(c) !== allowedType;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={already || notApplicable}
                  onClick={() => { onChange([...selected, c]); setSearch(""); setResults([]); }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2 disabled:opacity-40"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 truncate">{c.name}</span>
                    <span className="block text-xs text-slate-500 truncate">{c.email}</span>
                  </span>
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {notApplicable && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">No aplica</span>}
                    {c.unsubscribeMarketing && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Sin promos</span>}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.type === "MAYORISTA" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                      {c.type}{c.type === "MAYORISTA" && c.status !== "APPROVED" ? " (sin aprobar)" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-medium pl-2.5 pr-1 py-1 rounded-full">
              {c.name}
              <button type="button" onClick={() => onChange(selected.filter((x) => x.id !== c.id))} className="w-4 h-4 rounded-full hover:bg-blue-200 leading-none" title="Quitar">×</button>
            </span>
          ))}
        </div>
      ) : (
        hint && <p className="text-xs text-slate-400">{hint}</p>
      )}
      {unsubscribedNote && selected.some((c) => c.unsubscribeMarketing) && (
        <p className="text-xs text-amber-700">{unsubscribedNote}</p>
      )}
    </div>
  );
}

// ── Pestaña "Enviar email" ────────────────────────────────────────────────────
function ComposeTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [audience, setAudience] = useState("ALL");
  // Formato: PLAIN = simple, como un email personal (más chances de llegar a Principal en Gmail);
  // CUSTOM = con diseño. null = automático: simple para clientes elegidos, con diseño para el resto.
  const [format, setFormat] = useState(null);
  const kind = format ?? (audience === "SELECTED" ? "PLAIN" : "CUSTOM");
  const [stats, setStats] = useState(null);           // { count, unsubscribed }
  const [selected, setSelected] = useState([]);       // clientes elegidos (buscador: CustomerPicker)
  const [form, setForm] = useState({
    subject: "", title: "", body: "",
    buttonText: "Ver el catálogo", buttonUrl: `${window.location.origin}/catalogo`,
  });
  const [preview, setPreview] = useState({ subject: "", html: "", loading: false, error: "" });
  const [sendingTest, setSendingTest] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    emailsApi.getSettings().then((r) => setSettings(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (audience === "SELECTED") return;
    setStats(null);
    emailsApi.audience(audience).then((r) => setStats(r.data)).catch(() => setStats(null));
  }, [audience]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const withButton = form.buttonText.trim() !== "";
  const payload = {
    kind,
    audience,
    subject: form.subject, title: form.title, body: form.body,
    buttonText: withButton ? form.buttonText : "", buttonUrl: withButton ? form.buttonUrl : "",
    previewName: selected[0]?.name || "Juan",
  };

  // Vista previa: se rearma un rato después de dejar de escribir
  useEffect(() => {
    if (!form.subject.trim() || !form.body.trim()) {
      setPreview({ subject: form.subject, html: "", loading: false, error: "Escribí el asunto y el mensaje para ver cómo queda" });
      return;
    }
    setPreview((p) => ({ ...p, loading: true }));
    const t = setTimeout(() => {
      emailsApi.preview(payload)
        .then((r) => setPreview({ ...r.data, loading: false, error: "" }))
        .catch((err) => setPreview({ subject: form.subject, html: "", loading: false, error: err.response?.data?.error || "No se pudo armar la vista previa" }));
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.subject, form.title, form.body, form.buttonText, form.buttonUrl, selected[0]?.id, kind, audience]);

  const recipientsCount = audience === "SELECTED" ? selected.length : stats?.count ?? 0;

  function validate() {
    if (!form.subject.trim()) return "Falta el asunto";
    if (!form.body.trim()) return "Falta el mensaje";
    if (withButton && !/^https?:\/\/\S+$/i.test(form.buttonUrl.trim())) return "El link del botón tiene que empezar con https://";
    if (audience === "SELECTED" && selected.length === 0) return "Elegí al menos un cliente";
    if (recipientsCount === 0) return "No hay clientes para mandarle este email";
    return null;
  }

  async function handleTest() {
    const err = !form.subject.trim() ? "Falta el asunto" : !form.body.trim() ? "Falta el mensaje" : null;
    if (err) return toast.error(err);
    setSendingTest(true);
    try {
      const r = await emailsApi.sendTest(payload);
      toast.success(`Prueba enviada a ${r.data.sentTo}`);
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo mandar la prueba");
    } finally {
      setSendingTest(false);
    }
  }

  async function handleSend() {
    setSending(true);
    try {
      const r = await emailsApi.send({ ...payload, audience, customerIds: selected.map((c) => c.id) });
      toast.success(`Listo: el email sale para ${r.data.total} cliente(s)`);
      setConfirming(false);
      navigate("/admin/emails?tab=historial");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo crear el envío");
    } finally {
      setSending(false);
    }
  }

  const minutes = settings ? Math.ceil(recipientsCount / settings.perMinute) : null;
  const days = settings ? Math.ceil(recipientsCount / settings.dailyLimit) : 1;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        {/* Para */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Para</label>
          <div className="flex flex-wrap gap-2">
            {AUDIENCE_OPTIONS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setAudience(o.key)}
                className={`px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                  audience === o.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {audience !== "SELECTED" ? (
            <p className="text-xs text-slate-500 mt-2">
              {stats == null ? "Contando…" : (
                <>
                  Le llega a <strong className="text-slate-700">{stats.count}</strong> cliente{stats.count !== 1 ? "s" : ""}.
                  {stats.unsubscribed > 0 && ` ${stats.unsubscribed} se dieron de baja de las promociones y no lo reciben.`}
                </>
              )}
            </p>
          ) : (
            <div className="mt-3">
              <CustomerPicker
                selected={selected}
                onChange={setSelected}
                hint="Buscá y agregá los clientes a los que les querés escribir."
                unsubscribedNote="Algunos elegidos se dieron de baja de las promociones: como es un mensaje directo les llega igual, usalo solo para cosas de su cuenta o su pedido."
              />
            </div>
          )}
        </div>

        {/* Formato */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Formato</label>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "PLAIN", label: "✉️ Simple, como un email personal" },
              { key: "CUSTOM", label: "🎨 Con diseño" },
            ].map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setFormat(o.key)}
                className={`px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                  kind === o.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            {kind === "PLAIN"
              ? "Solo el texto, sin logo ni colores. Es el que más chances tiene de llegar a la bandeja Principal de Gmail (con muchos destinatarios igual puede caer en Promociones)."
              : "Con el logo, título grande y botón. Se ve más lindo, pero Gmail casi siempre lo pone en Promociones."}
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Asunto *</label>
          <input type="text" value={form.subject} onChange={set("subject")} maxLength={150} className="input w-full" placeholder="ej: {nombre}, llegaron los cargadores que buscabas" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            Título <span className="text-slate-400 font-normal">— opcional, va grande arriba del mensaje</span>
          </label>
          <input type="text" value={form.title} onChange={set("title")} className="input w-full" placeholder="ej: ¡Nuevos ingresos!" />
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Mensaje *</label>
          <textarea value={form.body} onChange={set("body")} rows={9} className="input w-full resize-y" placeholder={"Hola {nombre}!\n\nTe contamos que…"} />
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            <strong className="text-slate-500">{"{nombre}"}</strong> = nombre del cliente · línea en blanco = párrafo nuevo ·{" "}
            <strong className="text-slate-500">**así**</strong> = negrita · los links se pueden tocar
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {kind === "PLAIN" ? "Link al final" : "Botón"} <span className="text-slate-400 font-normal">— opcional</span>
            </label>
            <input type="text" value={form.buttonText} onChange={set("buttonText")} className="input w-full" placeholder="Sin botón" />
          </div>
          <div className="sm:col-span-3">
            <label className="block text-sm font-semibold text-slate-700 mb-1">Link del botón</label>
            <input type="url" value={form.buttonUrl} onChange={set("buttonUrl")} disabled={!withButton} className="input w-full disabled:opacity-50" placeholder="https://…" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={handleTest}
            disabled={sendingTest}
            className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title={user?.email ? `Se manda a ${user.email}` : undefined}
          >
            {sendingTest ? "Enviando…" : "✉️ Mandarme una prueba"}
          </button>
          <button
            type="button"
            onClick={() => { const e = validate(); if (e) toast.error(e); else setConfirming(true); }}
            className="px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
          >
            Enviar a {recipientsCount} cliente{recipientsCount !== 1 ? "s" : ""}
          </button>
        </div>
        {user?.email && <p className="text-xs text-slate-400 -mt-2">La prueba te llega a {user.email}.</p>}
      </div>

      <EmailPreview {...preview} />

      {confirming && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-800 text-lg">¿Mandar el email?</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Le va a llegar a <strong>{recipientsCount} cliente{recipientsCount !== 1 ? "s" : ""}</strong>
              {audience !== "SELECTED" && ` (${AUDIENCE_LABEL[audience].toLowerCase()})`}.
            </p>
            {settings && (
              <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 rounded-lg p-3">
                Sale de a poco: hasta {settings.perMinute} por minuto y {settings.dailyLimit} por día, para no caer en spam.
                {days > 1
                  ? ` Con este tope tarda unos ${days} días en llegarles a todos.`
                  : minutes > 1 ? ` Tarda unos ${minutes} minutos.` : ""}
                {" "}Lo podés seguir (y cancelar) en el Historial.
              </p>
            )}
            {settings && !settings.smtpConfigured && (
              <p className="text-xs text-red-600">El servidor de email no está configurado: el envío queda en espera hasta que se configure.</p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={handleSend} disabled={sending} className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                {sending ? "Enviando…" : "Sí, mandar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Formatos del aviso de campaña. Lo que decide si Gmail lo pone en Promociones (donde el celular no
// avisa) no es tener HTML sino las señales de publicidad: fotos de productos, precios, banners, "OFF".
const OFFER_FORMATS = [
  {
    key: "LIGHT", short: "Liviano", label: "✨ Liviano (recomendado)",
    hint: "Prolijo y con el color de la campaña, pero sin fotos ni precios y con un solo botón: armado como el email de restock a mayoristas, que llega a la bandeja Principal. Es el punto medio entre lindo y que el celular avise. No es seguro: Gmail decide por cada cliente.",
  },
  {
    key: "PLAIN", short: "Solo texto", label: "✉️ Solo texto",
    hint: "Un mensaje corto, como escrito a mano: el nombre de la campaña, el descuento, hasta cuándo y el link. Es el que más chances tiene de llegar a Principal, pero no tiene nada de diseño.",
  },
  {
    key: "DESIGN", short: "Con fotos y precios", label: "🎨 Con fotos y precios",
    hint: "Con el color de la campaña, fotos y precios de los productos. Es el más vistoso, pero Gmail casi siempre lo pone en Promociones, donde el celular no avisa.",
  },
];

// ── WhatsApp de avisos (Evolution, 25/11/2026) ────────────────────────────────
// Texto de WhatsApp con *negrita* → JSX (para las vistas previas)
function WhatsappText({ text }) {
  return (
    <div className="bg-[#dcf8c6] text-slate-800 rounded-xl rounded-tr-sm px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words shadow-sm max-w-md">
      {String(text || "").split(/(\*[^*\n]+\*)/g).map((part, i) =>
        part.startsWith("*") && part.endsWith("*") && part.length > 2 ? <b key={i}>{part.slice(1, -1)}</b> : <span key={i}>{part}</span>
      )}
    </div>
  );
}

// Vincular la eSIM desde el panel (pedido de la clienta, 25/11/2026: "un botón de reconectar en la web misma",
// sin túnel al panel de Evolution). Muestra el QR, lo renueva cada 25 s (vence) y cada 3 s mira si ya
// conectó: ahí avisa y se cierra sola.
function WhatsappQrModal({ onClose, onConnected }) {
  const [qr, setQr] = useState({ loading: true });
  useEffect(() => {
    let vivo = true;
    const pedirQr = () => emailsApi.whatsappQr()
      .then((r) => {
        if (!vivo) return;
        if (r.data.state === "open") { onConnected(); return; }
        setQr({ base64: r.data.base64, pairingCode: r.data.pairingCode });
      })
      .catch((e) => vivo && setQr({ error: e.response?.data?.error || "No se pudo pedir el QR" }));
    pedirQr();
    const renovar = setInterval(pedirQr, 25_000);
    const mirar = setInterval(() => {
      emailsApi.whatsapp().then((r) => { if (vivo && r.data.state === "open") onConnected(); }).catch(() => {});
    }, 3_000);
    return () => { vivo = false; clearInterval(renovar); clearInterval(mirar); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-bold text-slate-800">📷 Vincular la eSIM</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
        </div>
        <ol className="text-sm text-slate-600 list-decimal pl-5 space-y-1">
          <li>En el teléfono de la eSIM, abrí <strong>WhatsApp Business</strong>.</li>
          <li><strong>⋮ → Dispositivos vinculados → Vincular un dispositivo</strong> (en iPhone: Configuración → Dispositivos vinculados).</li>
          <li>Escaneá este código. Se cierra solo cuando conecta.</li>
        </ol>
        <div className="flex justify-center items-center bg-slate-50 rounded-xl min-h-[280px] p-3">
          {qr.loading ? (
            <p className="text-sm text-slate-400">Pidiendo el código…</p>
          ) : qr.error ? (
            <p className="text-sm text-red-600 text-center">{qr.error}</p>
          ) : (
            <img src={qr.base64} alt="Código QR para vincular WhatsApp" className="w-64 h-64" />
          )}
        </div>
        {qr.pairingCode && (
          <p className="text-xs text-slate-500 text-center">
            ¿No podés escanear? En “Vincular con el número de teléfono” poné este código: <strong className="tracking-widest">{qr.pairingCode}</strong>
          </p>
        )}
        <p className="text-xs text-slate-400 text-center">⚠️ Escanealo solo con la eSIM de avisos, nunca con el WhatsApp de la tienda.</p>
      </div>
    </div>
  );
}

// Pestaña "WhatsApp": si la eSIM está conectada, qué avisa y la prueba. Ver backend/src/services/whatsapp.service.js.
function WhatsappTab() {
  const [showQr, setShowQr] = useState(false);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ adminNumbers: "", newOrder: true, customerStatus: true, dailyLimit: 100, abandonedCart: true, restock: true });
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState("");

  const load = () => emailsApi.whatsapp()
    .then((r) => {
      setData(r.data);
      setForm({
        adminNumbers: (r.data.adminNumbers || []).join(", "), newOrder: r.data.newOrder, customerStatus: r.data.customerStatus,
        dailyLimit: r.data.dailyLimit, abandonedCart: r.data.abandonedCart, restock: r.data.restock,
      });
    })
    .catch((e) => toast.error(e.response?.data?.error || "No se pudo leer la configuración de WhatsApp"));
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      await emailsApi.saveWhatsapp({ ...form, dailyLimit: parseInt(form.dailyLimit, 10) });
      toast.success("Guardado");
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }
  async function test() {
    setBusy("test");
    try {
      await emailsApi.whatsappTest(testTo);
      toast.success("Prueba enviada: fijate en ese WhatsApp");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo mandar la prueba");
    } finally {
      setBusy("");
    }
  }
  async function reconnect() {
    setBusy("restart");
    try {
      const r = await emailsApi.whatsappRestart();
      toast.success(r.data.state === "open" ? "Conectado de nuevo" : "Se reinició; puede tardar un minuto en conectar");
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo reconectar");
    } finally {
      setBusy("");
    }
  }

  if (!data) return <div className="text-center py-16 text-slate-400">Cargando…</div>;
  const connected = data.state === "open";

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Estado de la eSIM */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">📱 WhatsApp de avisos (eSIM)</p>
            <p className={`text-lg font-bold mt-0.5 ${!data.configured ? "text-slate-400" : connected ? "text-emerald-700" : "text-red-600"}`}>
              {!data.configured ? "Sin configurar" : connected ? "🟢 Conectado" : data.state ? "🔴 Desconectado" : "🔴 No responde"}
            </p>
          </div>
          {/* Antes: solo "Reconectar", y solo desconectado. Pedido de la clienta (25/11/2026): reconectar desde la
              web. Reconectar (reinicia la sesión, alcanza si el teléfono se cortó un rato) queda siempre a mano, y
              si la sesión se perdió, "Vincular con QR" muestra el código acá mismo. */}
          {data.configured && (
            <div className="flex flex-wrap gap-2">
              <button onClick={reconnect} disabled={busy === "restart"} className={`px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 ${connected ? "border border-slate-200 text-slate-700 hover:bg-slate-50" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                {busy === "restart" ? "Reconectando…" : "🔄 Reconectar"}
              </button>
              {!connected && (
                <button onClick={() => setShowQr(true)} className="px-4 py-2 rounded-xl border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                  📷 Vincular con QR
                </button>
              )}
            </div>
          )}
        </div>
        {showQr && (
          <WhatsappQrModal
            onClose={() => setShowQr(false)}
            onConnected={() => { setShowQr(false); toast.success("¡WhatsApp conectado!"); load(); }}
          />
        )}
        {!data.configured ? (
          <p className="text-sm text-slate-600 leading-relaxed">
            Todavía no está encendido en el servidor. Mientras tanto todos los avisos siguen saliendo por email.
            Para encenderlo hay que levantar Evolution en el VPS y vincular la eSIM con un QR (los pasos están en
            <code className="mx-1 text-xs bg-slate-100 px-1 rounded">deploy/docker-compose.vps.yml</code>).
          </p>
        ) : !connected ? (
          <p className="text-sm text-slate-600 leading-relaxed">
            Fijate que el teléfono de la eSIM esté <strong>prendido y con internet</strong> y tocá “Reconectar”. Si no vuelve, tocá
            “📷 Vincular con QR” y escanealo con la eSIM. Mientras tanto los avisos siguen por email. (El servidor intenta reconectarlo solo cada 10 minutos.)
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            Avisos de campañas en las últimas 24 horas: <strong>{data.sentToday}</strong> de {data.dailyLimit}.
          </p>
        )}
        <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2 leading-relaxed">
          ⚠️ Este WhatsApp no es el oficial de Meta: si WhatsApp lo detecta, puede bloquear el número. Por eso va en la eSIM de avisos y
          <strong> nunca en el número de la tienda</strong>. Los mensajes salen despacio a propósito.
        </p>
      </div>

      {/* Qué avisa */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <p className="text-sm font-semibold text-slate-700">Qué avisa</p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.newOrder} onChange={(e) => setForm({ ...form, newOrder: e.target.checked })} className="w-4 h-4 mt-0.5" />
          <span>
            <span className="block text-sm text-slate-800 font-medium">🛒 Cada pedido nuevo, a nosotros</span>
            <span className="block text-xs text-slate-500">Con el cliente, el total y el link al pedido. A estos números (separados por coma):</span>
          </span>
        </label>
        <input
          type="text"
          value={form.adminNumbers}
          onChange={(e) => setForm({ ...form, adminNumbers: e.target.value })}
          placeholder="ej: 11 5039-5166, 11 4444-5555"
          className="input text-sm ml-7"
          style={{ width: "calc(100% - 1.75rem)" }}
        />
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.customerStatus} onChange={(e) => setForm({ ...form, customerStatus: e.target.checked })} className="w-4 h-4 mt-0.5" />
          <span>
            <span className="block text-sm text-slate-800 font-medium">📦 Al cliente, el estado de su pedido</span>
            <span className="block text-xs text-slate-500">Cuando se aprueba el pago y cuando está listo para retirar o despachado. Al celular que cargó en el pedido.</span>
          </span>
        </label>
        {/* Carrito abandonado y restock (25/11/2026): el mismo recordatorio del email, también por WhatsApp */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.abandonedCart} onChange={(e) => setForm({ ...form, abandonedCart: e.target.checked })} className="w-4 h-4 mt-0.5" />
          <span>
            <span className="block text-sm text-slate-800 font-medium">🛒 Carrito abandonado, también por WhatsApp</span>
            <span className="block text-xs text-slate-500">
              Cuando sale el email de “te quedó esto en el carrito”, le llega lo mismo por WhatsApp. El recordatorio se prende en Emails → Automáticos.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={form.restock} onChange={(e) => setForm({ ...form, restock: e.target.checked })} className="w-4 h-4 mt-0.5" />
          <span>
            <span className="block text-sm text-slate-800 font-medium">📦 Restock a mayoristas, también por WhatsApp</span>
            <span className="block text-xs text-slate-500">
              Al mayorista que hace tiempo no compra, el mismo recordatorio del email (“¿reponemos?”) con el link al catálogo.
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-800 font-medium">📣 Campañas y recordatorios: hasta</span>
          <input
            type="number" min="10" max="400"
            value={form.dailyLimit}
            onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })}
            className="input text-sm w-24"
          />
          <span className="text-sm text-slate-600">mensajes por día</span>
          <p className="text-xs text-slate-500 w-full">
            {/* Antes: "Se mandan desde “Avisos de campañas” → 📱 WhatsApp. ..." (ahora también los recordatorios) */}
            Las campañas (desde “Avisos de campañas” → 📱 WhatsApp) y los recordatorios de carrito y restock salen por la misma cola:
            de a uno (cada 1,5 a 3 minutos) y solo entre las 9 y las 21. Más por día = más riesgo de bloqueo.
          </p>
        </div>
        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* Prueba */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-2">
        <p className="text-sm font-semibold text-slate-700">Mandar una prueba</p>
        <div className="flex flex-wrap gap-2">
          <input type="text" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Tu celular, ej: 11 5039-5166" className="input text-sm flex-1 min-w-[200px]" />
          <button onClick={test} disabled={!testTo.trim() || busy === "test" || !data.configured} className="px-4 py-2 rounded-xl border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40">
            {busy === "test" ? "Mandando…" : "📱 Mandar prueba"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pestaña "Avisos de campañas" ──────────────────────────────────────────────
const STATE_STYLES = {
  ACTIVA:     "bg-green-100 text-green-700",
  PROGRAMADA: "bg-blue-100 text-blue-700",
  PAUSADA:    "bg-amber-100 text-amber-700",
  FINALIZADA: "bg-slate-100 text-slate-500",
};

// Cada fila es una campaña de Ofertas o un descuento por monto (25/11/2026, pedido de la clienta: "no llega
// mail" con la promo de Black Friday). _type: "offer" | "promo"; las acciones van a la ruta de cada una.
function CampaignsTab() {
  const [offers, setOffers] = useState([]);
  const [promos, setPromos] = useState([]);
  // Aviso por WhatsApp (25/11/2026): la campaña/promo elegida y su vista previa ({ count, retail, wholesale, ... })
  const [waOf, setWaOf] = useState(null);
  const [waData, setWaData] = useState(null);
  const [waSide, setWaSide] = useState("retail");
  const [waSending, setWaSending] = useState(false);
  // Probar el aviso solo con un número antes de mandarlo a todos (25/11/2026: "quiero probarlo")
  const [waTestTo, setWaTestTo] = useState("");
  const [waTesting, setWaTesting] = useState(false);
  async function testWhatsapp() {
    setWaTesting(true);
    try {
      await emailsApi.whatsappCampaignTest(waOf._type, waOf.id, waTestTo, waSide);
      toast.success("Prueba enviada: fijate en ese WhatsApp");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo mandar la prueba");
    } finally {
      setWaTesting(false);
    }
  }
  useEffect(() => {
    if (!waOf) return;
    setWaData(null);
    setWaSide(waOf.appliesTo === "MAYORISTA" ? "wholesale" : "retail");
    emailsApi.whatsappPreview(waOf._type, waOf.id)
      .then((r) => setWaData(r.data))
      .catch((e) => setWaData({ error: e.response?.data?.error || "No se pudo armar el aviso" }));
  }, [waOf]);
  async function sendWhatsapp(force = false) {
    setWaSending(true);
    try {
      const r = await emailsApi.whatsappAnnounce(waOf._type, waOf.id, force);
      toast.success(`Aviso por WhatsApp en camino para ${r.data.total} cliente(s): sale de a uno`);
      setWaOf(null);
      navigate("/admin/emails?tab=historial");
    } catch (e) {
      if (e.response?.status === 409 && !force) {
        if (confirm(`"${waOf.name}" ya se mandó por WhatsApp. ¿Mandarlo OTRA VEZ a todos?`)) return sendWhatsapp(true);
      } else {
        toast.error(e.response?.data?.error || "No se pudo mandar por WhatsApp");
      }
    } finally {
      setWaSending(false);
    }
  }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);           // id de la campaña en proceso
  const [previewOf, setPreviewOf] = useState(null); // { offer, side }
  const [preview, setPreview] = useState({ subject: "", html: "", loading: false, error: "" });
  // "Mandar a clientes elegidos": el aviso solo a algunos (no marca la campaña como avisada)
  const [sendTo, setSendTo] = useState(null);       // campaña
  const [chosen, setChosen] = useState([]);
  const [sendingTo, setSendingTo] = useState(false);
  // Formato de los avisos: LIGHT = liviano (por defecto) | PLAIN = solo texto | DESIGN = con fotos y precios
  const [offerFormat, setOfferFormat] = useState("LIGHT");
  useEffect(() => {
    emailsApi.getSettings().then((r) => setOfferFormat(r.data.offerFormat || "LIGHT")).catch(() => {});
  }, []);
  async function changeFormat(format) {
    const prev = offerFormat;
    setOfferFormat(format);
    try {
      await emailsApi.updateSettings({ offerFormat: format });
      toast.success(`Los avisos salen en formato "${OFFER_FORMATS.find((f) => f.key === format)?.short}"`);
    } catch (e) {
      setOfferFormat(prev);
      toast.error(e.response?.data?.error || "No se pudo guardar");
    }
  }
  const navigate = useNavigate();

  // Antes: solo offersApi.getAll(). Ahora también los descuentos por monto que no terminaron.
  const load = () => {
    setLoading(true);
    Promise.all([
      offersApi.getAll()
        .then((r) => setOffers(r.data.filter((o) => o.state !== "FINALIZADA").map((o) => ({ ...o, _type: "offer" }))))
        .catch(() => toast.error("Error al cargar las campañas")),
      emailsApi.promos()
        .then((r) => setPromos(r.data.map((p) => ({ ...p, _type: "promo" }))))
        .catch(() => toast.error("Error al cargar los descuentos por monto")),
    ]).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const items = [...promos, ...offers];

  useEffect(() => {
    if (!previewOf) return;
    setPreview((p) => ({ ...p, loading: true }));
    // Antes: siempre { kind: "OFFER", offerId }
    const it = previewOf.offer;
    emailsApi.preview(it._type === "promo"
      ? { kind: "PROMO", cartPromoId: it.id, side: previewOf.side, format: offerFormat }
      : { kind: "OFFER", offerId: it.id, side: previewOf.side, format: offerFormat })
      .then((r) => setPreview({ ...r.data, loading: false, error: "" }))
      .catch((e) => setPreview({ subject: "", html: "", loading: false, error: e.response?.data?.error || "No se pudo armar la vista previa" }));
  }, [previewOf, offerFormat]);

  async function toggleAuto(offer) {
    setBusy(`${offer._type}-${offer.id}`);
    try {
      if (offer._type === "promo") await emailsApi.setPromoAuto(offer.id, !offer.emailAnnounce);
      else await offersApi.update(offer.id, { emailAnnounce: !offer.emailAnnounce });
      toast.success(!offer.emailAnnounce ? "Se avisa por email cuando empiece" : "Aviso automático desactivado");
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  }

  async function announce(offer) {
    const again = !!offer.announcedAt;
    const msg = again
      ? `Esta campaña ya se avisó el ${fmtDateTime(offer.announcedAt)}. ¿Mandar el aviso OTRA VEZ a todos?`
      : `¿Avisar "${offer.name}" por email a los clientes ahora?`;
    if (!confirm(msg)) return;
    setBusy(`${offer._type}-${offer.id}`);
    try {
      const r = offer._type === "promo"
        ? await emailsApi.announcePromo(offer.id, again)
        : await emailsApi.announceOffer(offer.id, again);
      toast.success(`Aviso en camino para ${r.data.total} cliente(s)`);
      navigate("/admin/emails?tab=historial");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo avisar la campaña");
    } finally {
      setBusy(null);
    }
  }

  async function sendToChosen() {
    setSendingTo(true);
    try {
      const ids = chosen.map((c) => c.id);
      const r = sendTo._type === "promo" ? await emailsApi.sendPromo(sendTo.id, ids) : await emailsApi.sendOffer(sendTo.id, ids);
      toast.success(`Aviso en camino para ${r.data.total} cliente(s)${r.data.skipped ? ` (${r.data.skipped} no aplicaban)` : ""}`);
      setSendTo(null);
      navigate("/admin/emails?tab=historial");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo mandar la campaña");
    } finally {
      setSendingTo(false);
    }
  }

  if (loading) return <div className="text-center py-16 text-slate-400">Cargando…</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 max-w-3xl">
        Cada campaña o descuento por monto puede avisarse por email <strong>solo, cuando empieza</strong> (una única vez), a mano con "Avisar ahora",
        o solo a algunos clientes con "Mandar a…".
        El aviso le llega a quien aplica, con su descuento (a los mayoristas, sus escalones). Los que se dieron de baja de las promociones no lo reciben.
      </p>

      {/* Formato de los avisos */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <p className="text-sm font-semibold text-slate-700 mb-2">Cómo salen los avisos</p>
        <div className="flex flex-wrap gap-2">
          {OFFER_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => offerFormat !== f.key && changeFormat(f.key)}
              className={`px-3.5 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                offerFormat === f.key ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">
          {OFFER_FORMATS.find((f) => f.key === offerFormat)?.hint}
          {offerFormat === "DESIGN" && " Los descuentos por monto no tienen fotos: salen como el liviano."}
        </p>
      </div>

      {/* Antes: offers.length / offers.map (solo campañas). Ahora también los descuentos por monto. */}
      {items.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200">
          <p className="text-4xl mb-3">🏷</p>
          <p>No hay campañas ni descuentos por monto activos o programados</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((o) => (
            <div key={`${o._type}-${o.id}`} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-800">{o.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_STYLES[o.state] || ""}`}>{o.state}</span>
                  {o._type === "promo" && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">🎉 Descuento por monto</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {fmtDateTime(o.startsAt)} → {fmtDateTime(o.endsAt)} ·{" "}
                  {o.appliesTo === "AMBOS" ? "Minoristas y mayoristas" : o.appliesTo === "MAYORISTA" ? "Solo mayoristas" : "Solo minoristas"}
                </p>
                <p className={`text-xs mt-1 font-medium ${o.announcedAt ? "text-emerald-700" : "text-slate-400"}`}>
                  {o.announcedAt ? `✅ Avisada por email el ${fmtDateTime(o.announcedAt)}` : "Todavía no se avisó por email"}
                </p>
              </div>

              {/* El aviso automático solo tiene sentido ANTES de que empiece. Antes el tilde aparecía
                  también en las campañas en curso, y tildarlo ahí mandaba el aviso en el próximo
                  minuto sin pedir confirmación. Una campaña en curso se avisa con "Avisar ahora". */}
              {o.state === "PROGRAMADA" && !o.announcedAt && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!o.emailAnnounce}
                    disabled={busy === `${o._type}-${o.id}`}
                    onChange={() => toggleAuto(o)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  <span className="text-slate-700">Avisar sola al empezar</span>
                </label>
              )}

              {/* Antes: "flex gap-2". Con el botón de WhatsApp son cuatro: en el celular bajan de renglón. */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setPreviewOf({ offer: o, side: o.appliesTo === "MAYORISTA" ? "wholesale" : "retail" })}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
                >
                  👁 Ver cómo llega
                </button>
                <button
                  onClick={() => { setSendTo(o); setChosen([]); }}
                  disabled={o.state !== "ACTIVA"}
                  title={o.state !== "ACTIVA" ? "Se puede mandar cuando la campaña está activa" : "Mandar el aviso solo a los clientes que elijas"}
                  className="px-3 py-2 rounded-lg border border-blue-200 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                >
                  👤 Mandar a…
                </button>
                {/* Por WhatsApp (eSIM de avisos, 25/11/2026): abre la vista previa; manda solo si está activa */}
                <button
                  onClick={() => setWaOf(o)}
                  className="px-3 py-2 rounded-lg border border-emerald-200 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  📱 WhatsApp
                </button>
                <button
                  onClick={() => announce(o)}
                  disabled={o.state !== "ACTIVA" || busy === `${o._type}-${o.id}`}
                  title={o.state !== "ACTIVA" ? "Se puede avisar cuando la campaña está activa" : undefined}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40"
                >
                  {o.announcedAt ? "Avisar de nuevo" : "📧 Avisar ahora"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sendTo && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSendTo(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-800">Mandar "{sendTo.name}" a clientes elegidos</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Les llega el mismo aviso, con su descuento y sus precios. No cuenta como el aviso general: después lo podés seguir mandando a todos.
                </p>
              </div>
              <button onClick={() => setSendTo(null)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            {sendTo.appliesTo !== "AMBOS" && (
              <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">
                {sendTo.appliesTo === "MAYORISTA"
                  ? "Esta campaña es solo para mayoristas aprobados: a los minoristas no se les puede mandar."
                  : "Esta campaña es solo para minoristas: a los mayoristas no se les puede mandar."}
              </p>
            )}
            <CustomerPicker
              selected={chosen}
              onChange={setChosen}
              allowedType={sendTo.appliesTo === "AMBOS" ? null : sendTo.appliesTo}
              hint="Buscá y agregá a quién se lo querés mandar."
              unsubscribedNote="Algunos elegidos se dieron de baja de las promociones: les llega igual porque los elegiste vos."
            />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setSendTo(null)} className="px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button
                onClick={sendToChosen}
                disabled={sendingTo || chosen.length === 0}
                className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40"
              >
                {sendingTo ? "Enviando…" : `Mandar a ${chosen.length} cliente${chosen.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Aviso por WhatsApp: a cuántos les llega, cómo se ve y cuánto tarda */}
      {waOf && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setWaOf(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-bold text-slate-800">📱 Avisar "{waOf.name}" por WhatsApp</h3>
              <button onClick={() => setWaOf(null)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            {!waData ? (
              <p className="text-sm text-slate-400 py-6 text-center">Armando el aviso…</p>
            ) : waData.error ? (
              <p className="text-sm bg-red-50 text-red-700 rounded-lg px-3 py-2">{waData.error}</p>
            ) : (
              <>
                {!waData.configured && (
                  <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">
                    El WhatsApp de avisos todavía no está encendido (ver Emails → 📱 WhatsApp). Podés ver cómo queda, pero no mandarlo.
                  </p>
                )}
                <p className="text-sm text-slate-600">
                  Le llega a <strong>{waData.count}</strong> cliente{waData.count === 1 ? "" : "s"} con celular cargado (sin los que se dieron de baja).
                  Sale de a uno, entre las 9 y las 21: con el tope de {waData.dailyLimit} por día tarda
                  {" "}<strong>unos {Math.max(1, Math.ceil(waData.count / waData.dailyLimit))} día{Math.ceil(waData.count / waData.dailyLimit) > 1 ? "s" : ""}</strong>.
                </p>
                {waData.retail && waData.wholesale && (
                  <div className="flex gap-1.5">
                    {[["retail", "Minorista"], ["wholesale", "Mayorista"]].map(([k, l]) => (
                      <button key={k} onClick={() => setWaSide(k)} className={`px-3 py-1 rounded-lg text-sm ${waSide === k ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{l}</button>
                    ))}
                  </div>
                )}
                <div className="bg-[#efeae2] rounded-xl p-4 flex justify-end">
                  <WhatsappText text={waSide === "wholesale" ? waData.wholesale || waData.retail : waData.retail || waData.wholesale} />
                </div>
                {/* Prueba: este mismo mensaje (la versión que se está viendo) solo a un número */}
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={waTestTo}
                      onChange={(e) => setWaTestTo(e.target.value)}
                      placeholder="Tu celular, ej: 11 5039-5166"
                      className="input text-sm flex-1 min-w-[180px]"
                    />
                    <button
                      onClick={testWhatsapp}
                      disabled={!waTestTo.trim() || waTesting || !waData.configured}
                      className="px-4 py-2 rounded-xl border border-emerald-200 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
                    >
                      {waTesting ? "Mandando…" : "🧪 Mandarme una prueba"}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">Te llega este mismo mensaje solo a vos. No cuenta como enviado.</p>
                </div>
                {waOf.state !== "ACTIVA" && (
                  <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">Se puede mandar cuando está activa (en fecha y sin pausar).</p>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setWaOf(null)} className="px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">Cancelar</button>
                  <button
                    onClick={() => sendWhatsapp(false)}
                    disabled={waSending || !waData.configured || waData.count === 0 || waOf.state !== "ACTIVA"}
                    className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {waSending ? "Encolando…" : `📱 Mandar a ${waData.count} cliente${waData.count === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {previewOf && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreviewOf(null)}>
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 bg-white rounded-xl px-4 py-2.5">
              <div className="flex gap-1.5">
                {previewOf.offer.appliesTo !== "MAYORISTA" && (
                  <button onClick={() => setPreviewOf((p) => ({ ...p, side: "retail" }))} className={`px-3 py-1 rounded-lg text-sm ${previewOf.side === "retail" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Minorista</button>
                )}
                {previewOf.offer.appliesTo !== "MINORISTA" && (
                  <button onClick={() => setPreviewOf((p) => ({ ...p, side: "wholesale" }))} className={`px-3 py-1 rounded-lg text-sm ${previewOf.side === "wholesale" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Mayorista</button>
                )}
              </div>
              <button onClick={() => setPreviewOf(null)} className="text-slate-400 hover:text-slate-600 text-xl font-bold px-2">×</button>
            </div>
            {previewOf.offer.state !== "ACTIVA" && previewOf.offer._type !== "promo" && (
              <p className="text-xs bg-amber-50 text-amber-800 rounded-lg px-3 py-2">
                La campaña todavía no empezó: los productos aparecen en el email cuando ya tienen el descuento aplicado.
              </p>
            )}
            <EmailPreview {...preview} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pestaña "Historial" ───────────────────────────────────────────────────────
const STATUS_LABEL = {
  SENDING:   { label: "Enviando…", cls: "bg-blue-100 text-blue-700" },
  DONE:      { label: "Terminado", cls: "bg-emerald-100 text-emerald-700" },
  CANCELLED: { label: "Cancelado", cls: "bg-slate-100 text-slate-500" },
};

// Destinatarios de un envío: a quién le salió y a qué hora, con buscador y filtro por estado.
// Reemplaza a la ventana que mostraba solo los fallidos.
const RECIPIENT_STATUS = {
  SENT:      { label: "Enviado",   cls: "bg-emerald-100 text-emerald-700" },
  FAILED:    { label: "Falló",     cls: "bg-red-100 text-red-700" },
  PENDING:   { label: "En cola",   cls: "bg-blue-100 text-blue-700" },
  CANCELLED: { label: "Cancelado", cls: "bg-slate-100 text-slate-500" },
};
const fmtTime = (d) =>
  d ? new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

function RecipientsModal({ broadcast, initialStatus = "", onClose }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [data, setData] = useState(null); // { total, items }

  useEffect(() => {
    const t = setTimeout(() => {
      emailsApi.recipients(broadcast.id, { search: search.trim() || undefined, status: status || undefined })
        .then((r) => setData(r.data))
        .catch(() => setData({ total: 0, items: [], error: true }));
    }, 300);
    return () => clearTimeout(t);
  }, [broadcast.id, search, status]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-800">Destinatarios</h3>
            <p className="text-xs text-slate-500">
              {/* PROMO_*: aviso de un descuento por monto (25/11/2026) */}
              {/* WA_*: aviso por WhatsApp (25/11/2026) */}
              {broadcast.kind?.startsWith("WA_") ? `📱 WhatsApp: ${broadcast.cartPromo?.name || broadcast.offer?.name || broadcast.subject}`
                : broadcast.kind?.startsWith("OFFER") ? `Aviso: ${broadcast.offer?.name || broadcast.subject}`
                : broadcast.kind?.startsWith("PROMO") ? `Aviso: ${broadcast.cartPromo?.name || broadcast.subject}`
                : broadcast.subject} · {fmtDateTime(broadcast.createdAt)}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
        </div>
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 leading-relaxed">
          <strong>Enviado</strong> quiere decir que el servidor de email lo aceptó, a esa hora. Si un cliente no lo ve en la bandeja de entrada,
          casi siempre está en <strong>Spam</strong> o en la pestaña <strong>Promociones</strong> de Gmail.
          <strong> Falló</strong> suele ser un email que no existe o está mal escrito.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email…"
            className="input flex-1 min-w-[200px]"
            autoFocus
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input w-40">
            <option value="">Todos</option>
            <option value="SENT">Enviados</option>
            <option value="FAILED">Fallaron</option>
            <option value="PENDING">En cola</option>
            <option value="CANCELLED">Cancelados</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto -mx-2">
          {data == null ? (
            <p className="text-center text-sm text-slate-400 py-8">Cargando…</p>
          ) : data.items.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-8">{data.error ? "No se pudo cargar la lista" : "Ningún destinatario con ese filtro"}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.items.map((r) => {
                const st = RECIPIENT_STATUS[r.status] || RECIPIENT_STATUS.PENDING;
                return (
                  <li key={r.id} className="px-2 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{r.name || "—"}</p>
                      {/* Por WhatsApp: el celular (25/11/2026) */}
                      <p className="text-xs text-slate-500 truncate">{r.phone ? `📱 ${r.phone}` : r.email}</p>
                      {r.error && <p className="text-xs text-red-600 break-words mt-0.5">{r.error}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                      {r.sentAt && <p className="text-[11px] text-slate-400 mt-1">{fmtTime(r.sentAt)}</p>}
                      <p className="text-[10px] text-slate-400">{r.type === "MAYORISTA" ? "Mayorista" : "Minorista"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {data && data.total > data.items.length && (
          <p className="text-xs text-slate-400">Mostrando {data.items.length} de {data.total}: usá el buscador para encontrar a alguien.</p>
        )}
      </div>
    </div>
  );
}

// "Todo lo que salió" (pedido de la clienta, 26/11/2026: "acá hay cosas que no se guardan; debería aparecer al
// 100% todo lo que se manda"). Antes el historial mostraba solo los envíos masivos. Ahora también cada email y
// cada WhatsApp que sale de a uno (pedidos, cotizaciones, estados, recordatorios, alertas, avisos de WhatsApp),
// mezclados por fecha con los envíos masivos. Ver backend/src/services/messageLog.service.js.
const MSG_FILTERS = [
  { key: "", label: "Todo" },
  { key: "EMAIL", label: "📧 Emails" },
  { key: "WHATSAPP", label: "📱 WhatsApp" },
  { key: "FAILED", label: "⚠️ Fallidos" },
];
function SentMessages({ broadcasts, onRecipients }) {
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState(""); // la búsqueda aplicada (con una pausa al escribir)
  const [msgs, setMsgs] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const PAGE = 100;

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const params = (before) => ({
    ...(filter === "EMAIL" || filter === "WHATSAPP" ? { channel: filter } : {}),
    ...(filter === "FAILED" ? { status: "FAILED" } : {}),
    ...(query ? { q: query } : {}),
    ...(before ? { before } : {}),
  });
  useEffect(() => {
    setLoading(true);
    emailsApi.messages(params())
      .then((r) => { setMsgs(r.data); setHasMore(r.data.length === PAGE); })
      .catch(() => toast.error("Error al cargar los mensajes"))
      .finally(() => setLoading(false));
  }, [filter, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const more = () => emailsApi.messages(params(msgs[msgs.length - 1]?.id))
    .then((r) => { setMsgs((m) => [...m, ...r.data]); setHasMore(r.data.length === PAGE); })
    .catch(() => toast.error("Error al cargar más"));

  // Los envíos masivos entran en la misma lista (filtrados igual), hasta la fecha del último mensaje cargado
  const oldest = hasMore && msgs.length ? new Date(msgs[msgs.length - 1].createdAt) : null;
  const bcs = broadcasts.filter((b) =>
    (filter !== "EMAIL" || b.channel !== "WHATSAPP") &&
    (filter !== "WHATSAPP" || b.channel === "WHATSAPP") &&
    (filter !== "FAILED" || b.failedCount > 0) &&
    (!query || String(b.subject || "").toLowerCase().includes(query.toLowerCase())) &&
    (!oldest || new Date(b.createdAt) >= oldest));
  const rows = [
    ...msgs.map((m) => ({ kind: "msg", at: m.createdAt, m })),
    ...bcs.map((b) => ({ kind: "bc", at: b.createdAt, b })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {MSG_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${filter === f.key ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{f.label}</button>
        ))}
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por destinatario o asunto (ej. un email, un celular, #284)"
          className="input text-sm flex-1 min-w-[220px]"
        />
      </div>
      <p className="text-xs text-slate-400">Se guarda desde el 26/11/2026 (lo de antes no quedó registrado) y se borra solo después de 180 días.</p>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Cargando…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-400 bg-white rounded-2xl border border-slate-200">Nada por acá</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Qué</th>
                <th className="text-left px-4 py-3">Para</th>
                <th className="text-left px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => r.kind === "msg" ? (
                <tr key={`m${r.m.id}`} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fmtDateTime(r.m.createdAt)}</td>
                  <td className="px-4 py-2.5 text-slate-800">
                    <span className="mr-1.5" title={r.m.channel === "WHATSAPP" ? "WhatsApp" : "Email"}>{r.m.channel === "WHATSAPP" ? "📱" : "📧"}</span>
                    {r.m.subject}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 break-all">{r.m.to}</td>
                  <td className="px-4 py-2.5">
                    {r.m.status === "SENT"
                      ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">Enviado</span>
                      : <><span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700">Falló</span>
                        {r.m.error && <p className="text-xs text-red-600 mt-1 max-w-xs">{r.m.error}</p>}</>}
                  </td>
                </tr>
              ) : (
                <tr key={`b${r.b.id}`} className="border-t border-slate-100 align-top bg-slate-50/60">
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fmtDateTime(r.b.createdAt)}</td>
                  <td className="px-4 py-2.5 text-slate-800">
                    <span className="mr-1.5" title="Envío masivo">📣</span>
                    {r.b.cartPromo?.name || r.b.offer?.name || r.b.subject}
                    <span className="ml-2 text-xs text-slate-400">{r.b.channel === "WHATSAPP" ? "WhatsApp" : "email"} masivo</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {r.b.total} {r.b.total === 1 ? "cliente" : "clientes"}
                    {AUDIENCE_LABEL[r.b.audience] && ` (${AUDIENCE_LABEL[r.b.audience].toLowerCase()})`}
                    <button onClick={() => onRecipients(r.b)} className="ml-2 text-xs text-blue-600 hover:underline">ver</button>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                    {r.b.sentCount} de {r.b.total} enviados
                    {r.b.failedCount > 0 && <span className="text-red-600"> · {r.b.failedCount} fallaron</span>}
                    {r.b.status === "SENDING" && <span className="text-blue-600"> · enviando…</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && !loading && (
        <div className="text-center">
          <button onClick={more} className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50">Ver más</button>
        </div>
      )}
    </div>
  );
}

function HistoryTab() {
  // "todo" = todo lo que salió (mensajes sueltos + masivos); "masivos" = la tabla de siempre (26/11/2026)
  const [view, setView] = useState("todo");
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState(null);
  const [limitInput, setLimitInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [recipientsOf, setRecipientsOf] = useState(null); // { broadcast, status }

  const load = (quiet = false) => {
    if (!quiet) setLoading(true);
    Promise.all([emailsApi.history(), emailsApi.getSettings()])
      .then(([h, s]) => {
        setItems(h.data);
        setSettings(s.data);
        setLimitInput((prev) => prev || String(s.data.dailyLimit));
      })
      .catch(() => { if (!quiet) toast.error("Error al cargar el historial"); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Mientras haya algo saliendo, se actualiza solo cada 10 segundos
  const anySending = items.some((b) => b.status === "SENDING");
  useEffect(() => {
    if (!anySending) return;
    const t = setInterval(() => load(true), 10000);
    return () => clearInterval(t);
  }, [anySending]);

  async function saveLimit() {
    try {
      await emailsApi.updateSettings({ dailyLimit: parseInt(limitInput) });
      toast.success("Tope diario guardado");
      load(true);
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo guardar");
    }
  }

  async function cancel(b) {
    if (!confirm(`¿Cancelar el envío "${b.subject}"? Los que ya salieron no se pueden frenar; los que faltan no se mandan.`)) return;
    try {
      await emailsApi.cancel(b.id);
      toast.success("Envío cancelado");
      load(true);
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo cancelar");
    }
  }

  if (loading) return <div className="text-center py-16 text-slate-400">Cargando…</div>;

  return (
    <div className="space-y-5">
      {settings && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Tope diario de emails</label>
            <div className="flex gap-2">
              <input type="number" min="10" max="5000" value={limitInput} onChange={(e) => setLimitInput(e.target.value)} className="input w-28" />
              <button onClick={saveLimit} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">Guardar</button>
            </div>
          </div>
          <div className="text-sm text-slate-600 space-y-0.5">
            <p>Enviados en las últimas 24 h: <strong>{settings.sentLast24h}</strong> de {settings.dailyLimit}</p>
            <p>En cola: <strong>{settings.pending}</strong> · salen hasta {settings.perMinute} por minuto</p>
          </div>
          <p className="text-xs text-slate-400 basis-full leading-relaxed">
            Gmail deja mandar unos 500 emails por día en total (contando los de pedidos y los automáticos). Si lo pasa, corta los envíos y puede mandar todo a spam:
            por eso el tope. Lo que no entra hoy sale solo al día siguiente.
          </p>
          {!settings.smtpConfigured && (
            <p className="text-sm text-red-600 basis-full">⚠️ El servidor de email (SMTP) no está configurado: los envíos quedan en espera.</p>
          )}
        </div>
      )}

      {/* Todo lo que salió | Envíos masivos (26/11/2026) */}
      <div className="flex rounded-xl bg-slate-200 p-1 w-fit text-sm">
        {[["todo", "📬 Todo lo que salió"], ["masivos", "📣 Envíos masivos"]].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`px-4 py-1.5 rounded-lg font-semibold transition-colors ${view === k ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{l}</button>
        ))}
      </div>

      {view === "todo" ? (
        <SentMessages broadcasts={items} onRecipients={(b) => setRecipientsOf({ broadcast: b, status: "" })} />
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200">
          <p className="text-4xl mb-3">📭</p>
          <p>Todavía no se mandó ningún email</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Para</th>
                <th className="text-left px-4 py-3 w-56">Progreso</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => {
                const done = b.sentCount + b.failedCount;
                const pct = b.total ? Math.round((b.sentCount / b.total) * 100) : 0;
                const st = STATUS_LABEL[b.status] || STATUS_LABEL.DONE;
                return (
                  <tr key={b.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDateTime(b.createdAt)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">
                        {/* PROMO_*: aviso de un descuento por monto (25/11/2026) */}
                        {/* WA_*: aviso por WhatsApp (25/11/2026) */}
                        {b.kind?.startsWith("WA_") ? `📱 WhatsApp: ${b.cartPromo?.name || b.offer?.name || b.subject}`
                          : b.kind?.startsWith("OFFER") ? `🏷 Aviso: ${b.offer?.name || b.subject}`
                          : b.kind?.startsWith("PROMO") ? `🎉 Aviso: ${b.cartPromo?.name || b.subject}`
                          : b.kind === "PLAIN" ? `✉️ ${b.subject}` : b.subject}
                      </p>
                      {/* Antes: siempre "Automático (al empezar la campaña)"; los recordatorios de WhatsApp (WA_TEXT) no son campañas */}
                      <p className="text-xs text-slate-400">{b.createdBy ? `Mandado por ${b.createdBy}` : b.kind === "WA_TEXT" ? "Automático" : "Automático (al empezar la campaña)"}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{AUDIENCE_LABEL[b.audience] || b.audience}</td>
                    <td className="px-4 py-3">
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {b.sentCount} de {b.total} enviados
                        {b.failedCount > 0 && <span className="text-red-600"> · {b.failedCount} fallaron</span>}
                        {b.status === "SENDING" && done < b.total && ` · faltan ${b.total - done}`}
                      </p>
                      {b.lastError && <p className="text-xs text-amber-700 mt-1">{b.lastError}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setRecipientsOf({ broadcast: b, status: "" })} className="text-xs text-blue-600 hover:underline mr-3">Destinatarios</button>
                      {b.failedCount > 0 && (
                        <button onClick={() => setRecipientsOf({ broadcast: b, status: "FAILED" })} className="text-xs text-red-600 hover:underline mr-3">Ver fallidos</button>
                      )}
                      {b.status === "SENDING" && (
                        <button onClick={() => cancel(b)} className="text-xs text-red-600 hover:underline">Cancelar</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {recipientsOf && (
        <RecipientsModal broadcast={recipientsOf.broadcast} initialStatus={recipientsOf.status} onClose={() => setRecipientsOf(null)} />
      )}
    </div>
  );
}

export default function AdminEmails() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "";
  const title = useMemo(() => TITLES[tab] || TITLES[""], [tab]);

  return (
    <AdminLayout title={`Emails — ${title}`}>
      {tab === "" && <ComposeTab />}
      {tab === "campanas" && <CampaignsTab />}
      {tab === "historial" && <HistoryTab />}
      {tab === "cambios" && <EmailChangeRequests />}
      {tab === "automaticos" && <EmailAutomationsSection />}
      {tab === "whatsapp" && <WhatsappTab />}
    </AdminLayout>
  );
}
