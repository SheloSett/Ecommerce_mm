import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { customersApi, shippingLabelsApi } from "../../services/api";
import { storageGet, storageSet } from "../../utils/storage";
import {
  DEFAULT_SENDER, SENDER_PRESETS, TRANSPORT_SUGGESTIONS, labelDocumentHtml, printShippingLabel,
} from "../../utils/shippingLabel";
import { downloadZpl } from "../../utils/zplLabel";
import { printOnThermal, downloadInstaller, DEFAULT_PRINTER } from "../../utils/thermalPrint";

// Editor de una etiqueta de envío (10×15): se cambian los datos, se ve cómo queda y se imprime.
// Guardar es aparte: se puede imprimir con un cambio de una sola vez sin tocar la etiqueta guardada.
//
// props:
//   initial   — la etiqueta a editar ({ id?, customerId?, recipientName, ... }); sin id = nueva
//   others    — otras etiquetas guardadas del mismo cliente, para cambiar de una a otra
//   subtitle  — texto chico debajo del título (ej. "Pedido #241 · Juan Pérez")
//   fromOrder — los datos del pedido abierto (destinatario y entrega): con una etiqueta guardada, un
//               botón los pasa a la etiqueta, por si el cliente cambió de dirección
//   onClose(), onSaved(label)
// Una etiqueta pendiente de revisar (importada de BarTender) queda confirmada al guardarla.
const ROTATE_KEY = "etiquetaEnvioGirada";
const ZPL_FLIP_KEY = "etiquetaZplDadaVuelta";
// Esta PC ya tiene la impresión directa instalada (lo marca quien la instala). Sin esto, "Térmica" solo
// bajaba el archivo y no avisaba nada: el link no tiene a quién abrir si el ayudante no está.
const DIRECT_KEY = "impresionDirectaInstalada";
const PREVIEW_W = 567; // 150 mm a 96 dpi
const PREVIEW_H = 378; // 100 mm

const pick = (l) => ({
  id: l?.id ?? null,
  customerId: l?.customerId ?? null,
  recipientName: l?.recipientName || "",
  recipientDetails: l?.recipientDetails || "",
  transport: l?.transport || "",
  insurance: l?.insurance || "",
  sender: l?.sender || DEFAULT_SENDER,
});

export default function ShippingLabelModal({ initial, others = [], subtitle, fromOrder, onClose, onSaved }) {
  const [form, setForm] = useState(() => pick(initial));
  const [saved, setSaved] = useState(() => pick(initial)); // lo que está guardado, para saber si hay cambios
  const [packages, setPackages] = useState({ current: 1, total: 1 });
  const [rotate, setRotate] = useState(() => storageGet(ROTATE_KEY) === "1");
  const [zplFlip, setZplFlip] = useState(() => storageGet(ZPL_FLIP_KEY) === "1");
  const [needInstall, setNeedInstall] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const boxRef = useRef(null);
  const [scale, setScale] = useState(0.8);
  const [pending, setPending] = useState(!!initial?.pending);
  // Cliente vinculado: el nombre se guarda aparte (el form solo lleva el id)
  const [customerName, setCustomerName] = useState(initial?.customer?.name || null);
  const [picking, setPicking] = useState(false);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState([]);
  const custTimer = useRef(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  // Una etiqueta nueva (armada con los datos del pedido) o una pendiente se puede guardar sin tocarla
  const canSave = !form.id || pending || dirty;

  const searchCustomers = (q) => {
    setCustQuery(q);
    clearTimeout(custTimer.current);
    if (q.trim().length < 2) { setCustResults([]); return; }
    custTimer.current = setTimeout(async () => {
      try {
        const res = await customersApi.getAll({ search: q.trim() });
        const list = Array.isArray(res.data) ? res.data : (res.data?.customers || []);
        setCustResults(list.slice(0, 8));
      } catch { setCustResults([]); }
    }, 300);
  };
  const linkCustomer = (c) => {
    setForm((f) => ({ ...f, customerId: c ? c.id : null }));
    setCustomerName(c ? c.name : null);
    setPicking(false);
    setCustQuery("");
    setCustResults([]);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Vista previa: la misma hoja que se imprime (siempre horizontal), con un respiro al tipear
  useEffect(() => {
    const t = setTimeout(() => setPreviewHtml(labelDocumentHtml(form, { packages })), 200);
    return () => clearTimeout(t);
  }, [form, packages]);

  // Escala de la vista previa según el ancho disponible
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / PREVIEW_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleRotate = (e) => {
    setRotate(e.target.checked);
    storageSet(ROTATE_KEY, e.target.checked ? "1" : "0");
  };

  const close = () => {
    if (dirty && !window.confirm("Hay cambios sin guardar en la etiqueta. ¿Cerrar igual?")) return;
    onClose();
  };

  const switchTo = (id) => {
    const next = others.find((o) => String(o.id) === String(id));
    if (!next) return;
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Cambiar de etiqueta igual?")) return;
    setForm(pick(next));
    setSaved(pick(next));
    setPending(!!next.pending);
    setCustomerName(next.customer?.name || null);
  };

  const save = async () => {
    if (!form.recipientName.trim()) { toast.error("Falta el destinatario"); return null; }
    setSaving(true);
    try {
      const { id, ...data } = form;
      const res = id ? await shippingLabelsApi.update(id, data) : await shippingLabelsApi.create(data);
      const next = pick(res.data);
      setForm(next);
      setSaved(next);
      setPending(false);
      if (res.data.customer) setCustomerName(res.data.customer.name);
      toast.success("Etiqueta guardada");
      onSaved?.(res.data);
      return res.data;
    } catch (err) {
      toast.error(err.response?.data?.error || "No se pudo guardar la etiqueta");
      return null;
    } finally {
      setSaving(false);
    }
  };

  // ZPL: el archivo que se le manda a la impresora térmica, exacto en 10×15 (como las de Mercado Libre)
  const zpl = () => {
    if (!form.recipientName.trim()) { toast.error("Falta el destinatario"); return; }
    try {
      downloadZpl(form, { packages, flip: zplFlip });
      toast.success("Listo el .zpl: mandalo a la impresora de etiquetas como las de Mercado Libre");
    } catch {
      toast.error("No se pudo armar el ZPL");
    }
  };

  // Térmica: baja el .zpl y el ayudante de la PC se lo manda a la impresora (como "Enviar archivo a
  // impresora", que es lo que sale bien: letra negra y con corte). Ver utils/thermalPrint.js.
  const thermal = (confirmedInstall = false) => {
    if (!form.recipientName.trim()) { toast.error("Falta el destinatario"); return; }
    if (!confirmedInstall && storageGet(DIRECT_KEY) !== "1") { setNeedInstall(true); return; }
    if (confirmedInstall) { storageSet(DIRECT_KEY, "1"); setNeedInstall(false); }
    try {
      printOnThermal(form, { packages, flip: zplFlip });
      toast.success(`Mandando a "${DEFAULT_PRINTER}"…`, { duration: 4000 });
    } catch {
      toast.error("No se pudo armar la etiqueta");
    }
  };

  const print = () => {
    if (!form.recipientName.trim()) { toast.error("Falta el destinatario"); return; }
    if (!printShippingLabel(form, { packages, rotate })) toast.error("El navegador bloqueó la ventana: permití las ventanas emergentes de igwtstore.com.ar");
  };

  const senderPreset = useMemo(() => SENDER_PRESETS.find((p) => p.value === form.sender)?.value ?? "", [form.sender]);

  const input = "w-full px-3 py-2 border border-slate-300 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const label = "block text-xs font-semibold text-slate-500 mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-4">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              🏷 Etiqueta de envío{" "}
              {!form.id && <span className="text-xs font-semibold text-amber-600 align-middle ml-1">nueva</span>}
              {pending && <span className="text-xs font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 align-middle ml-1">pendiente de revisar · se confirma al guardar</span>}
            </h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={close} className="text-slate-400 hover:text-slate-700 text-xl leading-none px-2" title="Cerrar">✕</button>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-5 p-5">
          {/* Datos */}
          <div className="space-y-3">
            {others.length > 1 && (
              <div>
                <label className={label}>Etiquetas guardadas de este cliente</label>
                <select value={form.id ?? ""} onChange={(e) => switchTo(e.target.value)} className={input}>
                  {!form.id && <option value="">— nueva —</option>}
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.recipientName} · {(o.recipientDetails || "").split("\n")[0]}{o.sourceFile ? " (de BarTender)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {fromOrder && form.id && (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, recipientName: fromOrder.recipientName || f.recipientName, recipientDetails: fromOrder.recipientDetails || f.recipientDetails }))}
                className="w-full text-left text-xs px-3 py-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
                title="Reemplaza destinatario y datos de entrega por los de este pedido (después podés guardar o no)"
              >
                ↺ Usar el nombre y la dirección de este pedido
              </button>
            )}
            {/* Cliente de la tienda al que pertenece la etiqueta (opcional) */}
            <div>
              <label className={label}>Cliente de la tienda</label>
              {!picking ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {form.customerId ? (
                    <>
                      <span className="font-semibold text-slate-800">{customerName || `Cliente #${form.customerId}`}</span>
                      <button type="button" onClick={() => setPicking(true)} className="text-xs text-blue-600 hover:underline">Cambiar</button>
                      <button type="button" onClick={() => linkCustomer(null)} className="text-xs text-slate-500 hover:underline">Desvincular</button>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-400">Sin cliente vinculado</span>
                      <button type="button" onClick={() => setPicking(true)} className="text-xs text-blue-600 hover:underline">+ Vincular a un cliente</button>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <input autoFocus value={custQuery} onChange={(e) => searchCustomers(e.target.value)} placeholder="Buscar cliente por nombre o email…" className={input} />
                    <button type="button" onClick={() => { setPicking(false); setCustResults([]); }} className="px-3 text-sm text-slate-500">Cancelar</button>
                  </div>
                  {custResults.length > 0 && (
                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                      {custResults.map((c) => (
                        <button key={c.id} type="button" onClick={() => linkCustomer(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">
                          <span className="font-medium text-slate-800">{c.name}</span>
                          <span className="text-xs text-slate-400 ml-2">{c.email}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className={label}>Destinatario *</label>
              <input value={form.recipientName} onChange={set("recipientName")} className={input} placeholder="Nombre y apellido" />
            </div>
            <div>
              <label className={label}>Datos de entrega (DNI, dirección, CP, localidad, teléfono…)</label>
              <textarea value={form.recipientDetails} onChange={set("recipientDetails")} rows={6} className={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Transporte</label>
                <input value={form.transport} onChange={set("transport")} list="label-transports" className={input} placeholder="VIA CARGO" />
                <datalist id="label-transports">{TRANSPORT_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div>
                <label className={label}>Seguro</label>
                <input value={form.insurance} onChange={set("insurance")} className={input} placeholder="$ MINIMO" />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="text-xs font-semibold text-slate-500">Remitente</label>
                <select
                  value={senderPreset}
                  onChange={(e) => e.target.value && setForm((f) => ({ ...f, sender: e.target.value }))}
                  className="text-xs border border-slate-300 rounded-lg px-2 py-1 bg-white"
                >
                  <option value="">Otro (escrito a mano)</option>
                  {SENDER_PRESETS.map((p) => <option key={p.label} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <textarea value={form.sender} onChange={set("sender")} rows={3} className={input} />
            </div>
            <div className="flex flex-wrap items-end gap-3 pt-1">
              <div>
                <label className={label}>Cant. bultos (este envío)</label>
                <div className="flex items-center gap-1.5">
                  <input type="number" inputMode="numeric" min="1" value={packages.current}
                    onChange={(e) => setPackages((p) => ({ ...p, current: e.target.value }))}
                    className="w-16 px-2 py-2 border border-slate-300 rounded-lg text-base sm:text-sm text-center" />
                  <span className="text-slate-400">de</span>
                  <input type="number" inputMode="numeric" min="1" value={packages.total}
                    onChange={(e) => setPackages((p) => ({ ...p, total: e.target.value }))}
                    className="w-16 px-2 py-2 border border-slate-300 rounded-lg text-base sm:text-sm text-center" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600 pb-2 cursor-pointer select-none">
                <input type="checkbox" checked={rotate} onChange={toggleRotate} className="w-4 h-4" />
                Imprimir girada (si la impresora toma la etiqueta parada)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600 pb-2 cursor-pointer select-none" title="Solo para el archivo ZPL: si la etiqueta sale cabeza abajo">
                <input type="checkbox" checked={zplFlip} onChange={(e) => { setZplFlip(e.target.checked); storageSet(ZPL_FLIP_KEY, e.target.checked ? "1" : "0"); }} className="w-4 h-4" />
                ZPL dado vuelta (180°)
              </label>
            </div>
          </div>

          {/* Vista previa: lo mismo que sale impreso */}
          <div>
            <p className={label}>Así sale (10 × 15)</p>
            <div ref={boxRef} className="w-full rounded-lg border border-slate-200 bg-slate-100 overflow-hidden" style={{ height: PREVIEW_H * scale }}>
              <iframe
                title="Vista previa de la etiqueta"
                srcDoc={previewHtml}
                sandbox="allow-scripts"
                style={{ width: PREVIEW_W, height: PREVIEW_H, border: 0, transform: `scale(${scale})`, transformOrigin: "top left", background: "#fff" }}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              <b>Térmica</b> manda la etiqueta en ZPL directo a "{DEFAULT_PRINTER}": letra negra y con corte. Los cambios se imprimen aunque no los guardes.
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              ¿Primera vez en esta PC?{" "}
              <button type="button" onClick={downloadInstaller} className="text-blue-600 font-semibold hover:underline">Instalar impresión directa</button>
              {" "}— bajá el archivo, abrilo con doble clic (si Windows avisa, “Más información” → “Ejecutar de todas formas”) y listo. La primera vez que uses Térmica, Chrome pregunta si abrir el link: tildá “Permitir siempre”.
            </p>
          </div>
        </div>

        {needInstall && (
          <div className="mx-5 mb-4 rounded-xl border-2 border-blue-300 bg-blue-50 p-4 text-sm text-slate-700 space-y-2">
            <p className="font-bold text-blue-900">Para que “Térmica” imprima sola, esta PC necesita la impresión directa (se instala una vez)</p>
            <ol className="list-decimal pl-5 space-y-1 text-xs">
              <li>Bajá el instalador y abrilo con doble clic. Si Windows avisa: “Más información” → “Ejecutar de todas formas”. No pide clave de administrador.</li>
              <li>Volvé acá y apretá “Ya lo instalé, imprimir”. La primera vez Chrome pregunta si abrir el link: tildá “Permitir siempre” y aceptá.</li>
            </ol>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={downloadInstaller} className="px-3 py-1.5 rounded-lg bg-white border border-blue-300 text-blue-700 text-xs font-bold hover:bg-blue-100">⬇ Bajar instalador</button>
              <button type="button" onClick={() => thermal(true)} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">Ya lo instalé, imprimir</button>
              <button type="button" onClick={() => setNeedInstall(false)} className="px-3 py-1.5 rounded-lg text-slate-500 text-xs hover:text-slate-800">Cancelar</button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          {dirty && <span className="text-xs text-amber-700 mr-auto">● Cambios sin guardar</span>}
          {!dirty && !form.id && <span className="text-xs text-slate-500 mr-auto">Todavía no está guardada para este cliente</span>}
          <button onClick={close} className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-white">Cerrar</button>
          <button onClick={save} disabled={saving || !canSave} className="px-4 py-2 rounded-xl bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-40">
            {saving ? "Guardando…" : "💾 Guardar"}
          </button>
          <button onClick={print} className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50" title="Imprimir desde Chrome (sale más clara y la impresora no la corta)">Imprimir (navegador)</button>
          <button onClick={zpl} className="px-3 py-2 rounded-xl border border-blue-300 bg-white text-blue-700 text-sm font-bold hover:bg-blue-50" title="Solo baja el .zpl (para mandarlo a mano con Enviar archivo a impresora)">⬇ ZPL</button>
          <button onClick={() => thermal()} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700" title={`Manda la etiqueta en ZPL a "${DEFAULT_PRINTER}"`}>🖨️ Térmica</button>
        </div>
      </div>
    </div>
  );
}
