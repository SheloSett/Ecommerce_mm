import { useState, useEffect } from "react";
import { settingsApi } from "../../services/api";
import { useSiteConfig } from "../../context/SiteConfigContext";
import toast from "react-hot-toast";

// Admin → Configuración → Meta / Instagram.
// Tres piezas, cada una se puede usar sola:
//   · Pixel: script en la tienda que registra vistas, carritos y compras (services/metaPixel.js).
//   · API de conversiones: el servidor le avisa a Meta cada compra aprobada (backend meta.service.js).
//   · Feed del catálogo: URL que Meta lee para armar el catálogo de Instagram y los anuncios
//     dinámicos (backend seo.controller.js, /api/feed.xml).
// El token NUNCA vuelve del servidor: el panel solo sabe si está cargado (metaCapiTokenSet).

const FEED_URL = `${(import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, "")}/api/feed.xml`;

export default function MetaSectionContent() {
  const { refetch } = useSiteConfig();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);

  const [pixelId, setPixelId]           = useState("");
  const [token, setToken]               = useState("");
  const [tokenSet, setTokenSet]         = useState(false);
  const [trackWholesale, setTrackWholesale] = useState(false);
  const [testCode, setTestCode]         = useState("");

  const load = () =>
    settingsApi.get().then((res) => {
      setPixelId(res.data.metaPixelId || "");
      setTokenSet(res.data.metaCapiTokenSet === "true");
      setTrackWholesale(res.data.metaTrackWholesale === "true");
      setTestCode(res.data.metaTestEventCode || "");
      setToken("");
    });

  useEffect(() => {
    load().catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const id = pixelId.trim();
    if (id && !/^\d{5,20}$/.test(id)) {
      toast.error("El ID del Pixel son solo números (lo copiás de Events Manager)");
      return;
    }
    setSaving(true);
    try {
      await settingsApi.update({
        metaPixelId: id,
        // Vacío = no tocar el token guardado (el servidor lo ignora)
        metaCapiToken: token.trim(),
        metaTrackWholesale: trackWholesale ? "true" : "false",
        metaTestEventCode: testCode.trim(),
      });
      await load();
      refetch();
      toast.success("Configuración de Meta guardada");
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleClearToken = async () => {
    if (!window.confirm("¿Quitar el token? El servidor va a dejar de avisarle las compras a Meta hasta que cargues otro.")) return;
    setSaving(true);
    try {
      await settingsApi.update({ metaCapiTokenClear: "true" });
      await load();
      toast.success("Token eliminado");
    } catch {
      toast.error("Error al quitar el token");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await settingsApi.testMeta();
      const n = res.data.eventsReceived;
      toast.success(
        n ? `Meta recibió el evento de prueba (${n}). ${res.data.testEventCode ? "Miralo en Events Manager → Probar eventos." : ""}`
          : "Meta respondió bien a la prueba.",
        { duration: 6000 }
      );
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo conectar con Meta", { duration: 8000 });
    } finally {
      setTesting(false);
    }
  };

  const copyFeed = async () => {
    try {
      await navigator.clipboard.writeText(FEED_URL);
      toast.success("URL del feed copiada");
    } catch {
      toast.error("No se pudo copiar, seleccionala a mano");
    }
  };

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
    </div>
  );

  const pixelOk = /^\d{5,20}$/.test(pixelId.trim());

  return (
    <div className="space-y-5">
      {/* ── Estado ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
            <span>📣</span> Meta (Facebook / Instagram)
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Conectá la tienda con Meta para medir qué anuncios terminan en compras, mostrarle a cada
            persona los productos que miró y etiquetar productos en Instagram.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 text-sm">
          <StatusChip ok={pixelOk} label="Pixel en la tienda" okText="Activo" offText="Sin configurar" />
          <StatusChip ok={pixelOk && tokenSet} label="Compras desde el servidor" okText="Activo" offText={tokenSet ? "Falta el Pixel" : "Sin token"} />
          <StatusChip ok label="Feed del catálogo" okText="Siempre disponible" offText="" />
        </div>
      </div>

      {/* ── Pixel + API de conversiones ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div>
          <h3 className="font-bold text-slate-800 text-base">Pixel y API de conversiones</h3>
          <p className="text-sm text-slate-500 mt-1">
            Con el ID del Pixel la tienda registra las visitas, las vistas de producto, los carritos y las
            compras. Con el token, además, el servidor le avisa a Meta cada compra aprobada (también
            las que se pagan por transferencia o efectivo, y las que el navegador no llegó a informar).
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">ID del Pixel</label>
            <input
              type="text"
              inputMode="numeric"
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value.replace(/\s/g, ""))}
              className="input text-sm font-mono"
              placeholder="Ej: 1234567890123456"
            />
            <p className="text-xs text-slate-400 mt-1">
              Events Manager → tu conjunto de datos → Configuración → ID del conjunto de datos.
            </p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              Token de la API de conversiones
              {tokenSet && <span className="ml-2 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Cargado</span>}
            </label>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="input text-sm font-mono"
              placeholder={tokenSet ? "Pegá uno nuevo solo para reemplazarlo" : "Pegá el token generado en Events Manager"}
            />
            <p className="text-xs text-slate-400 mt-1">
              Events Manager → Configuración → API de conversiones → Generar token de acceso.
              {tokenSet && (
                <>
                  {" "}
                  <button type="button" onClick={handleClearToken} className="text-red-600 hover:underline font-medium">
                    Quitar token
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={trackWholesale}
            onChange={(e) => setTrackWholesale(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-700">
            <span className="font-semibold">Informar también las compras de clientes mayoristas.</span>
            <span className="block text-xs text-slate-500 mt-0.5">
              Apagado por defecto: los montos mayoristas son otros y confunden la optimización de los anuncios,
              que apuntan al público minorista. Las visitas se registran igual para todos.
            </span>
          </span>
        </label>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            Código de prueba <span className="text-slate-400 font-normal">(opcional)</span>
          </label>
          <input
            type="text"
            value={testCode}
            onChange={(e) => setTestCode(e.target.value)}
            className="input text-sm font-mono max-w-xs"
            placeholder="TEST12345"
          />
          <p className="text-xs text-slate-400 mt-1">
            Solo mientras probás: Events Manager → Probar eventos te da un código y ahí ves llegar cada
            compra que manda el servidor. <strong>Dejalo vacío</strong> en el día a día, si no las compras
            reales se marcan como prueba.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !pixelOk || !tokenSet}
            title={!pixelOk || !tokenSet ? "Guardá primero el ID del Pixel y el token" : "Manda un evento de prueba con lo guardado"}
            className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors text-sm"
          >
            {testing ? "Probando…" : "Probar conexión"}
          </button>
        </div>

        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 leading-relaxed">
          <strong>Para probar el Pixel desde la tienda usá una ventana de incógnito.</strong> Si el navegador
          tiene la sesión del panel abierta, el Pixel no se carga a propósito: tus propias visitas y pruebas
          no tienen que contar como clientes.
        </div>
      </div>

      {/* ── Feed del catálogo ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div>
          <h3 className="font-bold text-slate-800 text-base">Feed del catálogo</h3>
          <p className="text-sm text-slate-500 mt-1">
            Meta lee esta dirección cada tanto y arma el catálogo con los productos publicados, su precio
            minorista, su stock y sus fotos (cada variante va como un ítem propio). Sirve para la pestaña
            Tienda de Instagram, para etiquetar productos en las publicaciones y para los anuncios dinámicos.
            No hace falta configurar nada acá: siempre está disponible.
          </p>
        </div>
        <div className="flex gap-2">
          <input type="text" readOnly value={FEED_URL} className="input text-sm font-mono flex-1" onFocus={(e) => e.target.select()} />
          <button
            onClick={copyFeed}
            className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors text-sm whitespace-nowrap"
          >
            Copiar
          </button>
          <a
            href={FEED_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-colors text-sm whitespace-nowrap"
          >
            Ver
          </a>
        </div>
        <p className="text-xs text-slate-400">
          Los productos que se venden solo a mayoristas no salen (el feed es público). Los productos en
          dólares salen con su precio en USD. Se actualiza solo, con hasta 5 minutos de demora.
        </p>
      </div>

      {/* ── Guía ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
        <h3 className="font-bold text-slate-800 text-base">Cómo conectarlo, paso a paso</h3>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-600 leading-relaxed">
          <li>
            Entrá a <a href="https://business.facebook.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Meta Business Suite</a> con
            la cuenta que administra la página de Facebook y el Instagram de la tienda. Si no tenés una página de
            Facebook, creala: Instagram necesita una para vender.
          </li>
          <li>
            <strong>Pixel:</strong> Events Manager → Conectar orígenes de datos → Web → crear el conjunto de datos
            (Pixel). Copiá el ID y pegalo arriba. Guardá. Desde ese momento la tienda ya registra visitas y compras.
          </li>
          <li>
            <strong>Token:</strong> en el mismo conjunto de datos → Configuración → API de conversiones → "Generar
            token de acceso". Pegalo arriba y tocá "Probar conexión".
          </li>
          <li>
            <strong>Catálogo:</strong> <a href="https://business.facebook.com/commerce/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Commerce Manager</a> →
            Crear catálogo → Comercio electrónico → "Cargar info de productos" → Fuentes de datos → Feed de datos →
            "Usar una URL" → pegá la URL de arriba y elegí actualización cada hora.
          </li>
          <li>
            En el catálogo → Eventos, vinculá el Pixel. Así Meta cruza lo que la gente mira en la tienda con los
            productos del catálogo (es lo que permite los anuncios dinámicos: "viste este cargador, acá lo tenés").
          </li>
          <li>
            <strong>Instagram:</strong> en Commerce Manager → Tiendas, creá la tienda eligiendo "Pagar en otro sitio
            web" y conectá el Instagram. Cuando Meta la aprueba, podés etiquetar productos en las publicaciones.
          </li>
          <li>
            Verificá el dominio igwtstore.com.ar en Configuración del negocio → Seguridad de la marca → Dominios
            (Meta te da una etiqueta o un archivo; avisanos y lo agregamos).
          </li>
        </ol>
      </div>
    </div>
  );
}

function StatusChip({ ok, label, okText, offText }) {
  return (
    <div className={`rounded-xl px-4 py-3 border ${ok ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`font-semibold ${ok ? "text-emerald-700" : "text-slate-500"}`}>
        {ok ? "✓ " : "○ "}{ok ? okText : offText}
      </p>
    </div>
  );
}
