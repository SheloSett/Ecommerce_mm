import { useEffect, useMemo, useState } from "react";
import { suppliersApi } from "../../services/api";
import { MODES, TIER_LABELS, planRoute, routeLegs, googleMapsUrl, formatMeters } from "../../utils/purchaseRoute";

// Panel "Orden de los proveedores" de la orden de compra (la de un pedido y la combinada).
// Recibe los proveedores que entran en la compra y avisa por onChange en qué orden mostrarlos e
// imprimirlos, con el número de parada, los metros de cada tramo y el link/QR de Google Maps.
// La lógica del orden está en utils/purchaseRoute.js; acá van la pantalla y las direcciones.
//
// Se recuerda en este navegador (localStorage): el modo, la dirección de salida, la marca de carga
// de cada proveedor y si se imprime el QR. Si el navegador no deja guardar, anda igual.

const LS = {
  mode:  "igwt.ordenCompra.modo",
  start: "igwt.ordenCompra.salida",
  tiers: "igwt.ordenCompra.carga",
  qr:    "igwt.ordenCompra.qr",
};
const lsGet = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const lsSet = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento: no se recuerda */ }
};

// Direcciones ya ubicadas en esta sesión, compartidas entre las dos órdenes de compra.
// corrected: el backend la ubicó corrigiendo un error de tipeo en la calle (ver utils/geocode.js).
const geoCache = new Map(); // dirección → { lat, lng, label, corrected } | null (null = no se encontró)
const clean = (address) => (address || "").trim();
const shortLabel = (label) => (label || "").replace(/, CABA$/, ""); // "AZCUENAGA 179, CABA" → "AZCUENAGA 179"
const pointOf = (address) => {
  const v = geoCache.get(clean(address));
  return v ? { lat: v.lat, lng: v.lng } : null;
};

// Imagen del QR (data URL) con el link del recorrido. La librería se carga recién cuando hace falta.
async function makeQr(url) {
  const mod = await import("qrcode");
  const toDataURL = mod.toDataURL || mod.default?.toDataURL;
  return toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" });
}

// groups: [{ key, name, street, units }] — proveedores con algo seleccionado, en orden alfabético
// y sin el grupo "Sin proveedor" (ese va siempre al final de la hoja).
export default function PurchaseRoutePanel({ groups, onChange }) {
  const [mode, setModeState]           = useState(() => lsGet(LS.mode, "alfabetico"));
  const [start, setStartState]         = useState(() => lsGet(LS.start, ""));
  const [startDraft, setStartDraft]    = useState(() => lsGet(LS.start, ""));
  const [tiers, setTiersState]         = useState(() => lsGet(LS.tiers, {}));
  const [includeQr, setIncludeQrState] = useState(() => lsGet(LS.qr, true));
  const [geoVersion, setGeoVersion]    = useState(0);   // sube cuando llegan direcciones ubicadas
  const [geoLoading, setGeoLoading]    = useState(false);
  const [geoFailed, setGeoFailed]      = useState([]);  // direcciones que no se pudieron consultar
  const [retry, setRetry]              = useState(0);
  const [manual, setManual]            = useState(null); // orden movido a mano (keys) o null
  const [qrDataUrl, setQrDataUrl]      = useState(null);

  const routeActive = mode !== "alfabetico" && MODES.some((m) => m.id === mode);
  const byKey = useMemo(() => Object.fromEntries(groups.map((g) => [g.key, g])), [groups]);

  const setMode = (m) => { setModeState(m); lsSet(LS.mode, m); };
  const commitStart = () => {
    const v = clean(startDraft);
    setStartDraft(v);
    if (v !== start) { setStartState(v); lsSet(LS.start, v); }
  };
  const setTier = (key, t) => {
    setTiersState((prev) => {
      const next = { ...prev, [key]: t };
      lsSet(LS.tiers, next);
      return next;
    });
  };
  const setIncludeQr = (v) => { setIncludeQrState(v); lsSet(LS.qr, v); };

  // ── Ubicar direcciones (proveedores + salida) ───────────────────────────────
  const addresses = useMemo(
    () => [...new Set([start, ...groups.map((g) => g.street)].map(clean).filter(Boolean))],
    [start, groups]
  );
  useEffect(() => {
    if (!routeActive) return;
    const missing = addresses.filter((a) => !geoCache.has(a));
    if (missing.length === 0) return;
    let alive = true;
    setGeoLoading(true);
    suppliersApi.geocode(missing)
      .then((res) => {
        const { results = {}, failed = [] } = res.data || {};
        for (const [address, value] of Object.entries(results)) geoCache.set(address, value);
        if (alive) { setGeoFailed(failed); setGeoVersion((v) => v + 1); }
      })
      .catch(() => { if (alive) setGeoFailed(missing); })
      .finally(() => { if (alive) setGeoLoading(false); });
    return () => { alive = false; };
  }, [routeActive, addresses, retry]);

  // ── Orden calculado ─────────────────────────────────────────────────────────
  const startPoint = useMemo(
    () => (routeActive && clean(start) ? pointOf(start) : null),
    // geoVersion: el punto aparece cuando llega la respuesta del mapa
    [routeActive, start, geoVersion]
  );
  const basePlan = useMemo(() => {
    if (!routeActive) return null;
    const stops = groups.map((g) => ({ key: g.key, point: pointOf(g.street), tier: tiers[g.key] ?? 0 }));
    return planRoute({ start: startPoint, stops, useTiers: mode === "carga" });
  }, [routeActive, mode, groups, tiers, startPoint, geoVersion]);

  // Un cambio en el cálculo descarta lo que se haya movido a mano.
  useEffect(() => { setManual(null); }, [basePlan]);

  const order = useMemo(() => {
    if (!basePlan) return null;
    const valid = manual
      && manual.length === basePlan.order.length
      && manual.every((k) => basePlan.order.includes(k));
    return valid ? manual : basePlan.order;
  }, [basePlan, manual]);

  const legs = useMemo(
    () => (order ? routeLegs(startPoint, order.map((k) => ({ key: k, point: pointOf(byKey[k]?.street) }))) : null),
    [order, startPoint, byKey, geoVersion]
  );
  const maps = useMemo(
    () => (order ? googleMapsUrl(startPoint, order.map((k) => pointOf(byKey[k]?.street))) : null),
    [order, startPoint, byKey, geoVersion]
  );

  // QR del recorrido para la hoja impresa. Se genera antes de imprimir (no al tocar "Imprimir"),
  // porque la ventana de impresión se tiene que abrir en el mismo click o el navegador la bloquea.
  useEffect(() => {
    if (!routeActive || !includeQr || !maps?.url) { setQrDataUrl(null); return; }
    let alive = true;
    makeQr(maps.url)
      .then((data) => { if (alive) setQrDataUrl(data); })
      .catch(() => { if (alive) setQrDataUrl(null); });
    return () => { alive = false; };
  }, [routeActive, includeQr, maps?.url]);

  // ── Lo que recibe la página ─────────────────────────────────────────────────
  const payload = useMemo(() => {
    if (!routeActive || !order) {
      return { mode: "alfabetico", orderedKeys: groups.map((g) => g.key), stops: {}, summary: null };
    }
    const stops = {};
    order.forEach((k, i) => {
      stops[k] = { n: i + 1, meters: legs?.legs[k] ?? null, located: !!pointOf(byKey[k]?.street) };
    });
    return {
      mode,
      orderedKeys: order,
      stops,
      summary: {
        startLabel:  startPoint ? clean(start) : null,
        fromStartMeters: legs?.fromStart || 0,
        betweenMeters:   legs?.between || 0,
        mapsUrl:     maps?.url || null,
        truncated:   !!maps?.truncated,
        qrDataUrl:   includeQr ? qrDataUrl : null,
        unlocated:   order.filter((k) => !stops[k].located).map((k) => byKey[k]?.name),
      },
    };
  }, [routeActive, mode, order, legs, maps, includeQr, qrDataUrl, startPoint, start, groups, byKey]);

  useEffect(() => { onChange?.(payload); }, [payload, onChange]);

  const move = (key, dir) => {
    const arr = [...order];
    const i = arr.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setManual(arr);
  };

  // Avisos: salida o proveedores que el mapa no pudo ubicar
  const startNotFound = routeActive && clean(start) && geoCache.has(clean(start)) && !startPoint;
  const notFound = routeActive ? groups.filter((g) => clean(g.street) && geoCache.get(clean(g.street)) === null) : [];
  const noStreet = routeActive ? groups.filter((g) => !clean(g.street)) : [];
  // Ubicadas corrigiendo un error de tipeo ("azcuenga" → AZCUENAGA): se muestran para poder controlarlas.
  const corrected = routeActive ? groups.filter((g) => geoCache.get(clean(g.street))?.corrected) : [];
  const startGeo = routeActive && clean(start) ? geoCache.get(clean(start)) : null;

  return (
    <div className="bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Orden de los proveedores</span>
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors ${
                mode === m.id
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {routeActive && (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Salgo desde</label>
            <input
              type="text"
              value={startDraft}
              onChange={(e) => setStartDraft(e.target.value)}
              onBlur={commitStart}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              placeholder="Calle y número, ej: Av La Plata 744"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
              Dirección en CABA, se recuerda para la próxima. Si la dejás vacía, arranca por el proveedor que más conviene.
            </p>
          </div>

          {mode === "carga" && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Marcá cuánto cargás de cada proveedor: se pasa primero por los livianos y al final por los bultosos.
            </p>
          )}

          {geoLoading && <p className="text-xs text-slate-500 dark:text-slate-400">Ubicando direcciones en el mapa…</p>}
          {geoFailed.length > 0 && !geoLoading && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              No se pudo consultar el mapa de la Ciudad.{" "}
              <button type="button" onClick={() => setRetry((r) => r + 1)} className="underline font-semibold">Reintentar</button>
            </p>
          )}
          {startNotFound && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              ⚠ No encontramos "{clean(start)}" en CABA: el recorrido arranca por el proveedor que más conviene. Revisá cómo está escrita.
            </p>
          )}
          {(notFound.length > 0 || noStreet.length > 0) && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              ⚠ Van al final, sin ubicar en el recorrido:{" "}
              {[
                ...noStreet.map((g) => `${g.name} (sin calle cargada)`),
                ...notFound.map((g) => `${g.name} ("${clean(g.street)}" no se encontró)`),
              ].join(", ")}
              . Se corrige en Compras → Proveedores.
            </p>
          )}
          {(corrected.length > 0 || startGeo?.corrected) && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ✓ Corregimos cómo estaba escrita:{" "}
              {[
                ...(startGeo?.corrected ? [`salida "${clean(start)}" → ${shortLabel(startGeo.label)}`] : []),
                ...corrected.map((g) => `${g.name} "${clean(g.street)}" → ${shortLabel(geoCache.get(clean(g.street)).label)}`),
              ].join(", ")}
              . Si no es esa, o para dejarla bien, corregila en Compras → Proveedores.
            </p>
          )}

          {order && order.length > 0 && (
            <ol className="divide-y divide-slate-100 dark:divide-slate-700/60 border border-slate-100 dark:border-slate-700/60 rounded-lg">
              {order.map((key, i) => {
                const g = byKey[key];
                if (!g) return null;
                const meters = legs?.legs[key];
                const geo = geoCache.get(clean(g.street));
                const located = !!geo;
                // Antes decía "⚠ sin ubicar" para todos los casos; ahora dice por qué.
                const where = located
                  ? (geo.corrected ? `${clean(g.street)} → ${shortLabel(geo.label)}` : clean(g.street))
                  : clean(g.street) ? `⚠ no encontramos "${clean(g.street)}"` : "⚠ sin calle cargada";
                return (
                  <li key={key} className="flex items-center gap-2 px-3 py-2">
                    <span className="w-7 shrink-0 text-right text-sm font-bold text-blue-600 dark:text-blue-400">{i + 1}°</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{g.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {where} · {g.units} u.
                        {meters != null && ` · ${formatMeters(meters)} ${i === 0 ? "desde la salida" : "desde el anterior"}`}
                      </div>
                    </div>
                    {mode === "carga" && (
                      <select
                        value={tiers[key] ?? 0}
                        onChange={(e) => setTier(key, Number(e.target.value))}
                        className="text-xs rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 px-1.5 py-1"
                      >
                        {TIER_LABELS.map((label, t) => <option key={label} value={t}>{label}</option>)}
                      </select>
                    )}
                    <div className="flex flex-col shrink-0">
                      <button type="button" onClick={() => move(key, -1)} disabled={i === 0} title="Subir"
                        className="px-1.5 leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-25 disabled:cursor-not-allowed">▲</button>
                      <button type="button" onClick={() => move(key, 1)} disabled={i === order.length - 1} title="Bajar"
                        className="px-1.5 leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-25 disabled:cursor-not-allowed">▼</button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
            <span className="text-slate-600 dark:text-slate-300">
              {/* Antes: Total {formatMeters(legs.total)} caminando — sumaba el viaje desde la salida
                  (casa → Once, varios km) que no se hace a pie. */}
              {legs?.between > 0 && <>Entre proveedores <span className="font-semibold">{formatMeters(legs.between)}</span> caminando</>}
              {legs?.fromStart > 0 && (
                <span className="text-slate-400 dark:text-slate-500">
                  {legs.between > 0 ? " · " : ""}la salida queda a {formatMeters(legs.fromStart)} del primero
                </span>
              )}
              {manual && (
                <button type="button" onClick={() => setManual(null)} className="ml-2 text-xs text-blue-600 dark:text-blue-400 underline">
                  volver al orden calculado
                </button>
              )}
            </span>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                <input type="checkbox" checked={includeQr} onChange={(e) => setIncludeQr(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                QR en la hoja impresa
              </label>
              {maps?.url && (
                <a href={maps.url} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600">
                  Abrir en Google Maps
                </a>
              )}
            </div>
          </div>
          {maps?.truncated && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">Google Maps acepta hasta 10 paradas: el link y el QR cubren las primeras 10.</p>
          )}
        </>
      )}
    </div>
  );
}

// ── Ayudas para las páginas de orden de compra ───────────────────────────────────────────────────

// Grupos de la página en el orden del recorrido: primero los del recorrido, en su orden; después
// los que quedaron afuera (nada seleccionado), en el orden que traían; "Sin proveedor" siempre último.
export function orderGroupsByRoute(groups, route) {
  if (!route?.orderedKeys) return groups;
  const pos = new Map(route.orderedKeys.map((k, i) => [k, i]));
  const rank = (g) => (g.key === "none" ? Number.MAX_SAFE_INTEGER : pos.has(g.key) ? pos.get(g.key) : route.orderedKeys.length);
  return [...groups].sort((a, b) => rank(a) - rank(b)); // sort estable: los empates quedan como venían
}

// ── Ayudas para la hoja impresa (HTML en texto, como el resto de la orden de compra) ─────────────

// "1° " delante del nombre del proveedor en la hoja, si hay recorrido.
export function stopPrefix(route, key) {
  const n = route?.stops?.[key]?.n;
  return n ? `${n}° ` : "";
}

// "🚶 ≈ 350 m" para el encabezado de cada proveedor en la hoja.
export function stopWalk(route, key) {
  const m = route?.stops?.[key]?.meters;
  return m != null ? `🚶 ${formatMeters(m)}` : "";
}

// Bloque del recorrido arriba de la hoja: salida, orden, total y QR.
// names: { [key]: nombre } de los proveedores que se imprimen.
export function routeSummaryHtml(route, names) {
  const s = route?.summary;
  if (!s) return "";
  const stopsText = route.orderedKeys
    .filter((k) => names[k])
    .map((k) => `${route.stops[k]?.n}° ${names[k]}`)
    .join(" → ");
  const extra = [
    s.betweenMeters > 0 ? `${formatMeters(s.betweenMeters)} caminando entre proveedores` : "",
    s.fromStartMeters > 0 ? `la salida queda a ${formatMeters(s.fromStartMeters)} del primero` : "",
    s.unlocated?.length ? `sin ubicar: ${s.unlocated.join(", ")}` : "",
  ].filter(Boolean).join(" · ");
  const qr = s.qrDataUrl
    ? `<div style="text-align:center;flex-shrink:0">
        <img src="${s.qrDataUrl}" alt="" style="width:30mm;height:30mm;display:block" />
        <div style="font-size:8px;color:#64748b;margin-top:2px">Recorrido en Google Maps</div>
      </div>`
    : "";
  return `
  <div style="display:flex;gap:14px;align-items:center;border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;margin-bottom:14px;break-inside:avoid">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:800;color:#1e293b">🚶 Recorrido${s.startLabel ? ` · salida: ${s.startLabel}` : ""}</div>
      <div style="font-size:11px;color:#334155;margin-top:4px;line-height:1.5">${stopsText}</div>
      ${extra ? `<div style="font-size:10px;color:#64748b;margin-top:4px">${extra}</div>` : ""}
    </div>
    ${qr}
  </div>`;
}
