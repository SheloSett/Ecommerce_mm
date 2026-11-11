import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { mlApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { MODES, accountStatus, since } from "../../utils/mlTexts";

// Admin → Configuración → Mercado Libre: conectar la cuenta, elegir el modo y ver cómo anda.
// Conectar, desconectar y cambiar el modo lo puede hacer solo el dueño (superadministrador). Los
// tokens nunca llegan al navegador. Las publicaciones y los vínculos están en Productos → Mercado Libre.

const TONES = {
  ok:   "bg-emerald-50 border-emerald-200 text-emerald-700",
  warn: "bg-amber-50 border-amber-200 text-amber-700",
  bad:  "bg-red-50 border-red-200 text-red-700",
  off:  "bg-slate-50 border-slate-200 text-slate-600",
};

export default function MercadoLibreSectionContent() {
  const { isSuperAdmin } = useAuth();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => mlApi.status().then((res) => setStatus(res.data)).catch(() => setStatus({ error: true }));
  useEffect(() => { load(); }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const res = await mlApi.startOAuth();
      window.location.assign(res.data.url);
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo empezar la conexión");
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("¿Desconectar Mercado Libre? Se deja de compartir el stock hasta que se vuelva a conectar.")) return;
    setBusy(true);
    try {
      await mlApi.disconnect();
      await load();
      toast.success("Mercado Libre desconectado");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo desconectar");
    } finally {
      setBusy(false);
    }
  };

  const setMode = async (mode) => {
    if (mode === status.mode) return;
    if (mode === "ACTIVO" && !window.confirm("En modo Activo, los vínculos activados cambian el stock de los dos lados. ¿Seguir?")) return;
    setBusy(true);
    try {
      await mlApi.setMode(mode);
      await load();
      toast.success("Modo guardado");
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">Cargando…</div>;
  if (status.error) return <div className="bg-white rounded-2xl border border-slate-200 p-6 text-sm text-red-600">No se pudo leer el estado de Mercado Libre.</div>;

  const account = accountStatus(status.status);
  const connected = status.status === "CONECTADA";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
      <div>
        <h2 className="font-bold text-slate-800 text-base flex items-center gap-2"><span>🤝</span> Mercado Libre: stock compartido</h2>
        <p className="text-sm text-slate-500 mt-1">
          Los productos vinculados comparten el stock: una venta en la página baja en Mercado Libre y al revés. Los precios y las promociones no se tocan.
        </p>
      </div>

      {!status.enabled && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${TONES.warn}`}>
          Este servidor no tiene Mercado Libre activado. Hace falta cargar los datos de la aplicación en el servidor
          {isSuperAdmin && status.missing?.length > 0 && <> (faltan: <b>{status.missing.join(", ")}</b>)</>}.
        </div>
      )}

      <div className={`rounded-xl border px-4 py-3 text-sm space-y-1 ${TONES[account.tone]}`}>
        <div className="font-semibold">
          {account.text}
          {connected && status.nickname && <> como <b>{status.nickname}</b></>}
        </div>
        {status.connectedAt && <div className="text-xs opacity-80">Conectada {since(status.connectedAt)}{status.connectedBy ? ` por ${status.connectedBy}` : ""}</div>}
        {status.lastError && <div className="text-xs">Último problema ({since(status.lastErrorAt)}): {status.lastError}</div>}
        {status.pausedUntil && new Date(status.pausedUntil) > new Date() && (
          <div className="text-xs">Mercado Libre pidió bajar el ritmo: se retoma sola en unos minutos.</div>
        )}
      </div>

      {isSuperAdmin && (
        <div className="flex flex-wrap gap-2">
          {!connected && (
            <button type="button" disabled={busy || !status.enabled || status.missing?.length > 0} onClick={connect}
              className="px-4 py-2 rounded-xl bg-yellow-400 hover:bg-yellow-500 text-slate-900 text-sm font-semibold disabled:opacity-50">
              {status.status === "RECONECTAR" ? "Volver a conectar" : "Conectar con Mercado Libre"}
            </button>
          )}
          {status.status !== "DESCONECTADA" && (
            <button type="button" disabled={busy} onClick={disconnect}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">
              Desconectar
            </button>
          )}
        </div>
      )}

      {connected && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-700">Modo</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button key={m.id} type="button" disabled={!isSuperAdmin || busy} onClick={() => setMode(m.id)}
                className={`text-left rounded-xl border px-3 py-2 text-sm transition ${status.mode === m.id ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-slate-200 hover:bg-slate-50"} disabled:cursor-default`}>
                <div className="font-semibold text-slate-800">{m.label}</div>
                <div className="text-xs text-slate-500">{m.help}</div>
              </button>
            ))}
          </div>
          {!isSuperAdmin && <p className="text-xs text-slate-400">Solo el dueño puede cambiar el modo.</p>}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <div className="rounded-xl border border-slate-200 px-4 py-3">
          <div className="text-slate-500 text-xs">Productos vinculados</div>
          <div className="font-semibold text-slate-800">
            {status.pools.linked} vinculados · {status.pools.active} compartiendo stock
          </div>
          {(status.pools.review > 0 || status.pools.errors > 0) && (
            <div className="text-xs text-red-600 mt-1">{status.pools.review} para revisar · {status.pools.errors} con error</div>
          )}
          <Link to="/admin/productos/mercadolibre" className="text-xs text-blue-600 hover:underline">Ver publicaciones y vínculos →</Link>
        </div>
        <div className="rounded-xl border border-slate-200 px-4 py-3 text-xs text-slate-600 space-y-0.5">
          <div>Último aviso de Mercado Libre: <b>{since(status.lastWebhookAt)}</b></div>
          <div>Última revisión: <b>{since(status.lastPassAt)}</b></div>
          <div>Avisos: <b>{status.webhookReady ? "configurados" : "sin configurar"}</b></div>
        </div>
      </div>
    </div>
  );
}
