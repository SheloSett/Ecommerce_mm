import { useEffect, useMemo, useRef, useState } from "react";

// ─── Gráficos livianos en SVG para el panel de Analíticas ─────────────────────
// Sin librerías: viewBox + width 100% para que sean responsivos. Los colores salen de las variables
// --viz-* definidas en index.css (tienen versión clara y .admin-dark). Reglas que siguen todos:
//   - marcas finas (líneas de 2px, barras de hasta 24px), grilla en línea fina y recesiva
//   - leyenda siempre que haya 2 o más series; una sola serie se explica con el título
//   - hover con tooltip; cada gráfico tiene además su tabla, así ningún valor depende del hover

export const SERIES_COLORS = ["var(--viz-s1)", "var(--viz-s2)", "var(--viz-s3)", "var(--viz-s4)"];

// Ancho real del contenedor: el SVG se dibuja a escala 1:1 así el texto no se achica en celulares
function useWidth(ref, fallback = 720) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect?.width;
      if (cw && cw > 0) setW(Math.max(280, Math.round(cw)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const fmtDefault = (v) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(v ?? 0);

// Ticks "redondos" para el eje Y
function niceTicks(max, count = 4) {
  if (!max || max <= 0) return [0, 1];
  const rough = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * pow);
  const step = candidates.find((c) => c >= rough) || candidates[candidates.length - 1];
  const ticks = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

// Abrevia números grandes para los ticks del eje (1,2 M / 350 k)
export function compact(v) {
  const abs = Math.abs(v || 0);
  if (abs >= 1e6) return `${(v / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (abs >= 1e3) return `${(v / 1e3).toLocaleString("es-AR", { maximumFractionDigits: abs >= 1e5 ? 0 : 1 })} k`;
  return fmtDefault(v);
}

function Tooltip({ x, y, children }) {
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left: x, top: y, transform: "translate(-50%, calc(-100% - 10px))", minWidth: 120 }}
    >
      {children}
    </div>
  );
}

// ─── Líneas (series en el tiempo) ────────────────────────────────────────────
// series: [{ name, values: number[] }] — labels: string[] (mismo largo que values)
export function LineChart({ series, labels, format = fmtDefault, height = 240, area = true }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  const W = useWidth(wrapRef);
  const H = height;
  const pad = { top: 16, right: 16, bottom: 28, left: 52 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const n = labels.length;

  const max = useMemo(() => Math.max(0, ...series.flatMap((s) => s.values)), [series]);
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1] || 1;
  const x = (i) => pad.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.top + ih - (Math.max(0, v) / yMax) * ih;

  const paths = series.map((s) => s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" "));
  const areaPath = n > 1 && series[0]
    ? `${paths[0]} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`
    : null;

  // Etiquetas del eje X: como máximo ~7, repartidas
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 100))));

  const onMove = (e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = n <= 1 ? 0 : Math.round(((px - pad.left) / iw) * (n - 1));
    const i = Math.min(n - 1, Math.max(0, idx));
    setHover({ i, left: (x(i) / W) * rect.width, top: (pad.top / H) * rect.height });
  };

  if (n === 0) return <p className="py-10 text-center text-sm text-slate-400">Sin datos en este período</p>;

  return (
    <div className="relative" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-ink-2)" style={{ fontVariantNumeric: "tabular-nums" }}>{compact(t)}</text>
          </g>
        ))}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--viz-axis)" strokeWidth={1} />
        {labels.map((l, i) => (i % every === 0 || i === n - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--viz-ink-2)">{l}</text>
        ))}
        {areaPath && area && <path d={areaPath} fill={SERIES_COLORS[0]} opacity={0.1} />}
        {paths.map((d, si) => (
          <path key={si} d={d} fill="none" stroke={SERIES_COLORS[si % 4]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {n === 1 && series.map((s, si) => (
          <circle key={si} cx={x(0)} cy={y(s.values[0])} r={4} fill={SERIES_COLORS[si % 4]} stroke="var(--viz-surface)" strokeWidth={2} />
        ))}
        {hover && (
          <g>
            <line x1={x(hover.i)} x2={x(hover.i)} y1={pad.top} y2={pad.top + ih} stroke="var(--viz-axis)" strokeWidth={1} />
            {series.map((s, si) => (
              <circle key={si} cx={x(hover.i)} cy={y(s.values[hover.i])} r={4} fill={SERIES_COLORS[si % 4]} stroke="var(--viz-surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover && (
        <Tooltip x={hover.left} y={hover.top}>
          <p className="mb-1 font-semibold text-slate-700">{labels[hover.i]}</p>
          {series.map((s, si) => (
            <div key={si} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-500"><span className="inline-block h-0.5 w-3 rounded" style={{ background: SERIES_COLORS[si % 4] }} />{s.name}</span>
              <span className="font-bold text-slate-800" style={{ fontVariantNumeric: "tabular-nums" }}>{format(s.values[hover.i])}</span>
            </div>
          ))}
        </Tooltip>
      )}
      {series.length >= 2 && <Legend items={series.map((s, i) => ({ label: s.name, color: SERIES_COLORS[i % 4], kind: "line" }))} />}
    </div>
  );
}

// ─── Columnas (una serie por categoría ordenada: día de la semana, hora, período) ───
export function ColumnChart({ labels, values, format = fmtDefault, height = 200, extra }) {
  const wrapRef = useRef(null);
  const [hover, setHover] = useState(null);
  const W = useWidth(wrapRef);
  const H = height;
  const pad = { top: 12, right: 8, bottom: 26, left: 48 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;
  const n = labels.length;
  const max = Math.max(0, ...values);
  const ticks = niceTicks(max, 3);
  const yMax = ticks[ticks.length - 1] || 1;
  const slot = n > 0 ? iw / n : iw;
  const bw = Math.min(24, slot * 0.6);
  const y = (v) => pad.top + ih - (Math.max(0, v) / yMax) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(W / 56))));

  if (n === 0) return <p className="py-10 text-center text-sm text-slate-400">Sin datos en este período</p>;

  return (
    <div className="relative" ref={wrapRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ height: H }} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-ink-2)" style={{ fontVariantNumeric: "tabular-nums" }}>{compact(t)}</text>
          </g>
        ))}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--viz-axis)" strokeWidth={1} />
        {values.map((v, i) => {
          const cx = pad.left + slot * i + slot / 2;
          const top = y(v);
          const h = Math.max(0, y(0) - top);
          return (
            <g key={i}>
              {/* Área de hover más grande que la barra */}
              <rect
                x={pad.left + slot * i} y={pad.top} width={slot} height={ih} fill="transparent"
                onMouseEnter={(e) => {
                  const rect = wrapRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setHover({ i, left: (cx / W) * rect.width, top: (top / H) * rect.height });
                }}
              />
              {h > 0 && (
                <path
                  d={`M${cx - bw / 2},${y(0)} v${-(h - Math.min(4, h))} q0,-${Math.min(4, h)} ${Math.min(4, h)},-${Math.min(4, h)} h${bw - 2 * Math.min(4, h)} q${Math.min(4, h)},0 ${Math.min(4, h)},${Math.min(4, h)} v${h - Math.min(4, h)} z`}
                  fill={SERIES_COLORS[0]} opacity={hover && hover.i !== i ? 0.55 : 1}
                  style={{ pointerEvents: "none" }}
                />
              )}
              {(i % every === 0) && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--viz-ink-2)">{labels[i]}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <Tooltip x={hover.left} y={hover.top}>
          <p className="mb-1 font-semibold text-slate-700">{labels[hover.i]}</p>
          <p className="font-bold text-slate-800" style={{ fontVariantNumeric: "tabular-nums" }}>{format(values[hover.i])}</p>
          {extra && <p className="text-slate-500">{extra(hover.i)}</p>}
        </Tooltip>
      )}
    </div>
  );
}

// ─── Barras horizontales (ranking de categorías / proveedores / productos) ────
export function BarList({ items, format = fmtDefault, max: maxProp, valueKey = "value", labelKey = "label", sub }) {
  const max = maxProp ?? Math.max(0, ...items.map((i) => i[valueKey] || 0));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-slate-400">Sin datos en este período</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => {
        const v = it[valueKey] || 0;
        const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
        return (
          <li key={it.key ?? it.id ?? i} className="text-sm">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="truncate text-slate-700">{it[labelKey]}</span>
              <span className="shrink-0 font-semibold text-slate-800" style={{ fontVariantNumeric: "tabular-nums" }}>{format(v)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-r-full" style={{ width: `${pct}%`, background: SERIES_COLORS[0] }} />
            </div>
            {sub && <p className="mt-0.5 text-xs text-slate-400">{sub(it)}</p>}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Barra apilada al 100 % (parte del todo) ──────────────────────────────────
export function ShareBar({ items, format = fmtDefault, valueKey = "value", labelKey = "label" }) {
  const total = items.reduce((s, i) => s + (i[valueKey] || 0), 0);
  const visible = items.filter((i) => (i[valueKey] || 0) > 0).slice(0, 4);
  const rest = items.filter((i) => (i[valueKey] || 0) > 0).slice(4);
  const segs = rest.length > 0
    ? [...visible, { [labelKey]: "Otros", [valueKey]: rest.reduce((s, i) => s + i[valueKey], 0), key: "otros" }]
    : visible;
  if (total <= 0) return <p className="py-4 text-center text-sm text-slate-400">Sin datos en este período</p>;
  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full" style={{ gap: 2 }}>
        {segs.map((s, i) => (
          <div
            key={s.key ?? i}
            title={`${s[labelKey]}: ${format(s[valueKey])} (${Math.round((s[valueKey] / total) * 100)} %)`}
            style={{ width: `${(s[valueKey] / total) * 100}%`, background: s.key === "otros" ? "var(--viz-muted-mark)" : SERIES_COLORS[i % 4] }}
          />
        ))}
      </div>
      <Legend items={segs.map((s, i) => ({ label: `${s[labelKey]} · ${Math.round((s[valueKey] / total) * 100)} %`, color: s.key === "otros" ? "var(--viz-muted-mark)" : SERIES_COLORS[i % 4], kind: "rect" }))} />
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {it.kind === "line"
            ? <span className="inline-block h-0.5 w-4 rounded" style={{ background: it.color }} />
            : <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ─── Tarjeta de indicador ─────────────────────────────────────────────────────
// delta: variación % contra el período anterior (null = sin base). upIsGood invierte el color.
export function StatTile({ label, value, delta, deltaLabel = "vs período anterior", hint, upIsGood = true }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 truncate text-2xl font-extrabold text-slate-800">{value}</p>
      {delta !== undefined && (
        <p className="mt-1 text-xs text-slate-500">
          <DeltaBadge delta={delta} upIsGood={upIsGood} /> <span className="ml-1">{deltaLabel}</span>
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function DeltaBadge({ delta, upIsGood = true }) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) {
    return <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">sin base</span>;
  }
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.05;
  const good = flat ? null : up === upIsGood;
  const cls = flat ? "bg-slate-100 text-slate-500" : good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600";
  const arrow = flat ? "=" : up ? "▲" : "▼";
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${cls}`} style={{ fontVariantNumeric: "tabular-nums" }}>
      {arrow} {Math.abs(delta).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %
    </span>
  );
}

// Variación porcentual entre dos valores (null si no hay base)
export function pctDelta(current, previous) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}
