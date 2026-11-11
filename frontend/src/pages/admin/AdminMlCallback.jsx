import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import AdminLayout from "../../components/AdminLayout";
import { mlApi } from "../../services/api";

// A esta pantalla vuelve Mercado Libre después de que el dueño autoriza la aplicación
// (/admin/mercadolibre/conectar?code=...&state=...). Le pasa el código al servidor con la sesión del
// admin: el servidor verifica el state, canjea el código y comprueba que sea la cuenta de la tienda.
// El código se borra de la barra de direcciones apenas se lee.
export default function AdminMlCallback() {
  const [result, setResult] = useState({ loading: true });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React en desarrollo corre los efectos dos veces: el código es de un solo uso
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const denied = params.get("error");
    window.history.replaceState(null, "", window.location.pathname);

    if (denied || !code || !state) {
      setResult({ ok: false, error: denied ? "Mercado Libre no autorizó la conexión." : "Faltan datos de la conexión. Volvé a apretar \"Conectar\"." });
      return;
    }
    mlApi.exchange(code, state)
      .then((res) => setResult({ ok: true, nickname: res.data.nickname }))
      .catch((err) => setResult({ ok: false, error: err.response?.data?.error || "No se pudo completar la conexión" }));
  }, []);

  return (
    <AdminLayout title="Conectar Mercado Libre">
      <div className="max-w-lg mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 text-center">
        {result.loading && <p className="text-slate-600">Conectando con Mercado Libre…</p>}
        {result.ok === true && (
          <>
            <div className="text-4xl">✅</div>
            <p className="font-semibold text-slate-800">Mercado Libre conectado{result.nickname ? ` como ${result.nickname}` : ""}.</p>
            <p className="text-sm text-slate-500">Todavía no se comparte ningún stock: primero se vinculan los productos y se elige el modo.</p>
          </>
        )}
        {result.ok === false && (
          <>
            <div className="text-4xl">⚠️</div>
            <p className="font-semibold text-red-700">{result.error}</p>
          </>
        )}
        {!result.loading && (
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/admin/configuracion" className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50">Volver a Configuración</Link>
            {result.ok && <Link to="/admin/productos/mercadolibre" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">Ver publicaciones</Link>}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
