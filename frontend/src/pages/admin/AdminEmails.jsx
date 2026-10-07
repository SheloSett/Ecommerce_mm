import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import AdminLayout from "../../components/AdminLayout";
import EmailChangeRequests from "../../components/admin/EmailChangeRequests";
import EmailAutomationsSection from "../../components/admin/EmailAutomationsSection";
import { emailsApi, offersApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

// Admin → Emails. Pestañas (?tab=):
//   ""           Enviar email: escribir un email a todos, a un público o a clientes elegidos
//   campanas     Avisos de campañas: avisar por email una campaña de ofertas (a mano o al empezar)
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
          <iframe title="Vista previa del email" srcDoc={html || ""} sandbox="" className="w-full h-[640px] bg-[#0f172a]" />
        </div>
      )}
    </div>
  );
}

// ── Pestaña "Enviar email" ────────────────────────────────────────────────────
function ComposeTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [audience, setAudience] = useState("ALL");
  const [stats, setStats] = useState(null);           // { count, unsubscribed }
  const [selected, setSelected] = useState([]);       // clientes elegidos
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [form, setForm] = useState({
    subject: "", title: "", body: "",
    buttonText: "Ver el catálogo", buttonUrl: `${window.location.origin}/catalogo`,
  });
  const [preview, setPreview] = useState({ subject: "", html: "", loading: false, error: "" });
  const [sendingTest, setSendingTest] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [settings, setSettings] = useState(null);
  const searchTimer = useRef(null);

  useEffect(() => {
    emailsApi.getSettings().then((r) => setSettings(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (audience === "SELECTED") return;
    setStats(null);
    emailsApi.audience(audience).then((r) => setStats(r.data)).catch(() => setStats(null));
  }, [audience]);

  // Buscador de clientes (con espera, para no consultar en cada tecla)
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (search.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(() => {
      emailsApi.customers(search.trim()).then((r) => setResults(r.data)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const withButton = form.buttonText.trim() !== "";
  const payload = {
    kind: "CUSTOM",
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
  }, [form.subject, form.title, form.body, form.buttonText, form.buttonUrl, selected[0]?.id]);

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
            <div className="mt-3 space-y-2">
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
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={already}
                          onClick={() => { setSelected((prev) => [...prev, c]); setSearch(""); setResults([]); }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 flex items-center justify-between gap-2 disabled:opacity-40"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-slate-800 truncate">{c.name}</span>
                            <span className="block text-xs text-slate-500 truncate">{c.email}</span>
                          </span>
                          <span className="flex items-center gap-1 flex-shrink-0">
                            {c.unsubscribeMarketing && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Sin promos</span>}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.type === "MAYORISTA" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>{c.type}</span>
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
                      <button type="button" onClick={() => setSelected((prev) => prev.filter((x) => x.id !== c.id))} className="w-4 h-4 rounded-full hover:bg-blue-200 leading-none" title="Quitar">×</button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Buscá y agregá los clientes a los que les querés escribir.</p>
              )}
              {selected.some((c) => c.unsubscribeMarketing) && (
                <p className="text-xs text-amber-700">Algunos elegidos se dieron de baja de las promociones: como es un mensaje directo les llega igual, usalo solo para cosas de su cuenta o su pedido.</p>
              )}
            </div>
          )}
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
              Botón <span className="text-slate-400 font-normal">— opcional</span>
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

// ── Pestaña "Avisos de campañas" ──────────────────────────────────────────────
const STATE_STYLES = {
  ACTIVA:     "bg-green-100 text-green-700",
  PROGRAMADA: "bg-blue-100 text-blue-700",
  PAUSADA:    "bg-amber-100 text-amber-700",
  FINALIZADA: "bg-slate-100 text-slate-500",
};

function CampaignsTab() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);           // id de la campaña en proceso
  const [previewOf, setPreviewOf] = useState(null); // { offer, side }
  const [preview, setPreview] = useState({ subject: "", html: "", loading: false, error: "" });
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    offersApi.getAll()
      .then((r) => setOffers(r.data.filter((o) => o.state !== "FINALIZADA")))
      .catch(() => toast.error("Error al cargar las campañas"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  useEffect(() => {
    if (!previewOf) return;
    setPreview((p) => ({ ...p, loading: true }));
    emailsApi.preview({ kind: "OFFER", offerId: previewOf.offer.id, side: previewOf.side })
      .then((r) => setPreview({ ...r.data, loading: false, error: "" }))
      .catch((e) => setPreview({ subject: "", html: "", loading: false, error: e.response?.data?.error || "No se pudo armar la vista previa" }));
  }, [previewOf]);

  async function toggleAuto(offer) {
    setBusy(offer.id);
    try {
      await offersApi.update(offer.id, { emailAnnounce: !offer.emailAnnounce });
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
    setBusy(offer.id);
    try {
      const r = await emailsApi.announceOffer(offer.id, again);
      toast.success(`Aviso en camino para ${r.data.total} cliente(s)`);
      navigate("/admin/emails?tab=historial");
    } catch (e) {
      toast.error(e.response?.data?.error || "No se pudo avisar la campaña");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="text-center py-16 text-slate-400">Cargando…</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 max-w-3xl">
        Cada campaña puede avisarse por email <strong>sola, cuando empieza</strong> (una única vez), o a mano con "Avisar ahora".
        El aviso le llega a quien aplica la campaña, con su descuento y los productos con su precio. Los que se dieron de baja de las promociones no lo reciben.
      </p>

      {offers.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200">
          <p className="text-4xl mb-3">🏷</p>
          <p>No hay campañas activas ni programadas</p>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((o) => (
            <div key={o.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-800">{o.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_STYLES[o.state] || ""}`}>{o.state}</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {fmtDateTime(o.startsAt)} → {fmtDateTime(o.endsAt)} ·{" "}
                  {o.appliesTo === "AMBOS" ? "Minoristas y mayoristas" : o.appliesTo === "MAYORISTA" ? "Solo mayoristas" : "Solo minoristas"}
                </p>
                <p className={`text-xs mt-1 font-medium ${o.announcedAt ? "text-emerald-700" : "text-slate-400"}`}>
                  {o.announcedAt ? `✅ Avisada por email el ${fmtDateTime(o.announcedAt)}` : "Todavía no se avisó por email"}
                </p>
              </div>

              <label className={`flex items-center gap-2 text-sm cursor-pointer ${o.announcedAt ? "opacity-50" : ""}`} title={o.announcedAt ? "Ya se avisó" : undefined}>
                <input
                  type="checkbox"
                  checked={!!o.emailAnnounce}
                  disabled={busy === o.id || !!o.announcedAt}
                  onChange={() => toggleAuto(o)}
                  className="w-4 h-4 rounded border-slate-300"
                />
                <span className="text-slate-700">Avisar sola al empezar</span>
              </label>

              <div className="flex gap-2">
                <button
                  onClick={() => setPreviewOf({ offer: o, side: o.appliesTo === "MAYORISTA" ? "wholesale" : "retail" })}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
                >
                  👁 Ver cómo llega
                </button>
                <button
                  onClick={() => announce(o)}
                  disabled={o.state !== "ACTIVA" || busy === o.id}
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
            {previewOf.offer.state !== "ACTIVA" && (
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

function HistoryTab() {
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState(null);
  const [limitInput, setLimitInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

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

  async function openDetail(b) {
    try {
      const r = await emailsApi.detail(b.id);
      setDetail(r.data);
    } catch {
      toast.error("No se pudo abrir el detalle");
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

      {items.length === 0 ? (
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
                        {b.kind === "OFFER" ? `🏷 Aviso: ${b.offer?.name || b.subject}` : b.subject}
                      </p>
                      <p className="text-xs text-slate-400">{b.createdBy || "Automático"}</p>
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
                      {b.failedCount > 0 && (
                        <button onClick={() => openDetail(b)} className="text-xs text-blue-600 hover:underline mr-3">Ver fallidos</button>
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

      {detail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-800">No les llegó a estos clientes</h3>
              <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <p className="text-xs text-slate-500">Casi siempre es porque el email no existe o está mal escrito.</p>
            <ul className="divide-y divide-slate-100">
              {detail.failed.map((r) => (
                <li key={r.id} className="py-2">
                  <p className="text-sm font-medium text-slate-800">{r.name} <span className="text-slate-500 font-normal">— {r.email}</span></p>
                  {r.error && <p className="text-xs text-red-600 break-words">{r.error}</p>}
                </li>
              ))}
            </ul>
          </div>
        </div>
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
    </AdminLayout>
  );
}
