// Etiqueta de envío de 10×15 (150 × 100 mm, apaisada): la misma distribución que las etiquetas que se
// hacían en BarTender, para pegar en la caja. La usan la vista previa del editor y la impresión, así
// que lo que se ve es exactamente lo que sale.
//
//   ┌──────────────────────────────────────────┐
//   │              NOMBRE DEL CLIENTE           │
//   ├──────────────────────────────────────────┤
//   │  DNI / dirección / CP / localidad / tel   │
//   ├────────────────────┬─────────────────────┤
//   │ TRANSPORTE:        │ Remitente:          │
//   │ VIA CARGO          │ LS MARKET SRL       │
//   │ SEGURO: $ MINIMO   │ Av La Plata 744 ... │
//   │ CANT. BULTOS [1/1] │                     │
//   └────────────────────┴─────────────────────┘
//
// Cada texto se achica solo hasta entrar en su recuadro (script "fit" de la hoja): un nombre largo o
// unos datos de ocho renglones no se cortan.
import { escapeHtml as esc } from "./escapeHtml.js";

// Remitente por defecto (el mismo que el servidor, services/shippingLabels.service.js)
export const DEFAULT_SENDER = "LS MARKET SRL\nAV LA PLATA 744 T3 (1235) CABA\nTel (011)5039-5166";

// Remitentes para elegir rápido en el editor (los dos que se usaron en las etiquetas de 2024-2026)
export const SENDER_PRESETS = [
  { label: "LS MARKET SRL", value: DEFAULT_SENDER },
  { label: "INGOD-WETRUST SRL", value: "INGOD-WETRUST SRL\nAV LA PLATA 744 T3 (1235) CABA\nTel (011)5039-5166" },
];

// Transportes que aparecen en las etiquetas viejas, para sugerir al escribir
export const TRANSPORT_SUGGESTIONS = ["VIA CARGO", "CRUZ DEL SUR", "ANDREANI", "OCA", "CORREO ARGENTINO", "MOTO", "RETIRA EN DEPOSITO"];

const lines = (s) => esc(s || "").replace(/\r\n?/g, "\n");

// label: { recipientName, recipientDetails, transport, insurance, sender }
// opts.packages: { current, total } (bultos, se eligen al imprimir)
// opts.rotate: true = hoja de 100 × 150 (vertical) con la etiqueta girada, para impresoras que la toman así
// opts.forPrint: true = se imprime sola al abrir; false = vista previa
export function labelDocumentHtml(label, { packages = { current: 1, total: 1 }, rotate = false, forPrint = false } = {}) {
  const pageSize = rotate ? "100mm 150mm" : "150mm 100mm";
  const cur = Math.max(1, parseInt(packages.current) || 1);
  const tot = Math.max(cur, parseInt(packages.total) || 1);
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8" />
<title>Etiqueta — ${esc(label.recipientName || "")}</title>
<style>
  @page { size: ${pageSize}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { width: ${rotate ? "100mm" : "150mm"}; height: ${rotate ? "150mm" : "100mm"}; overflow: hidden; }
  .label {
    width: 150mm; height: 100mm; padding: 2.5mm;
    display: grid; grid-template-rows: 17mm 1fr 34mm; gap: 2mm;
    font-family: Arial, Helvetica, sans-serif; font-weight: 700; color: #000;
    ${rotate ? "transform: rotate(90deg) translateY(-100mm); transform-origin: top left;" : ""}
  }
  .box { border: 0.5mm solid #000; overflow: hidden; display: flex; align-items: center; justify-content: center; text-align: center; padding: 1mm 2.5mm; }
  .fit { white-space: pre-line; line-height: 1.15; max-width: 100%; }
  .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm; min-height: 0; }
  .left { flex-direction: column; justify-content: space-between; align-items: stretch; padding: 1.2mm 2mm; }
  .small { font-size: 3.6mm; }
  .transport { font-size: 6mm; }
  .row { display: flex; align-items: center; justify-content: center; gap: 2mm; }
  .bultos { display: flex; align-items: center; gap: 1.5mm; border: 0.4mm solid #000; padding: 0.5mm 2.5mm; font-size: 6.5mm; }
  .bultos .sep { font-weight: 400; font-size: 7mm; }
  .print-btn { position: fixed; top: 6px; right: 6px; }
  @media print { .print-btn { display: none; } }
</style></head>
<body>
<div class="label">
  <div class="box"><div class="fit" data-max="9">${lines(label.recipientName)}</div></div>
  <div class="box"><div class="fit" data-max="6">${lines(label.recipientDetails)}</div></div>
  <div class="bottom">
    <div class="box left">
      <div class="small">TRANSPORTE:</div>
      <div class="fit transport" data-max="6">${lines(label.transport) || "&nbsp;"}</div>
      <div class="row small">SEGURO: <span class="fit" data-max="4.5">${lines(label.insurance) || "—"}</span></div>
      <div class="row"><span class="small">CANT. BULTOS</span><span class="bultos">${cur}<span class="sep">/</span>${tot}</span></div>
    </div>
    <div class="box"><div class="fit" data-max="5">Remitente:\n${lines(label.sender)}</div></div>
  </div>
</div>
${forPrint ? `<button class="print-btn" onclick="window.print()" style="background:#1e40af;color:#fff;border:none;border-radius:6px;padding:6px 14px;font:700 13px Arial;cursor:pointer">🖨️ Imprimir</button>` : ""}
<script>
  // Achica cada texto (desde su tamaño máximo, en mm) hasta que entra en su recuadro.
  (function () {
    var mm = 96 / 25.4;
    function fits(el, box) { return box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1 && el.scrollWidth <= box.clientWidth + 1; }
    document.querySelectorAll(".fit").forEach(function (el) {
      var box = el.closest(".box") || el.parentElement;
      var size = parseFloat(el.getAttribute("data-max") || "6");
      el.style.fontSize = size + "mm";
      while (size > 2 && !fits(el, box)) { size -= 0.25; el.style.fontSize = size + "mm"; }
    });
    ${forPrint ? "window.addEventListener('load', function () { setTimeout(function () { window.focus(); window.print(); }, 150); });" : ""}
  })();
</script>
</body></html>`;
}

// Abre la etiqueta en una ventana y la manda a imprimir (elegir la impresora de etiquetas de 10×15).
export function printShippingLabel(label, opts = {}) {
  const html = labelDocumentHtml(label, { ...opts, forPrint: true });
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=700,height=520");
  if (win) win.onload = () => URL.revokeObjectURL(url);
  return !!win;
}

// Etiqueta nueva armada con los datos de un pedido (cuando el cliente todavía no tiene una guardada).
// addressLines: las de shippingAddressLines(deliveryAddressOf(order)).
export function labelFromOrder(order, addressLines = []) {
  const transport = order?.shippingMethod === "MOTO" ? "MOTO" : order?.shippingMethod === "RETIRO" ? "RETIRA EN EL LOCAL" : "";
  return {
    customerId: order?.customerId || null,
    recipientName: order?.customerName || "",
    recipientDetails: [...addressLines, order?.customerPhone ? `Tel: ${order.customerPhone}` : ""].filter(Boolean).join("\n"),
    transport,
    insurance: "",
    sender: DEFAULT_SENDER,
  };
}
