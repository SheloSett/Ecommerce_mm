// Tamaño de la foto (y con ella, del renglón) en las hojas que se imprimen desde el panel: órdenes
// (desde la lista y desde el detalle) y órdenes de compra (la de un pedido y la combinada).
//
// Se elige en la misma hoja, al lado de "Imprimir": Chico / Mediano / Grande. El cambio se ve al
// instante y se recuerda en el navegador para la próxima vez (una preferencia para las órdenes y
// otra para las órdenes de compra). Los botones van dentro de .print-btn, que no sale en el papel.
//
// Cómo se usa en una hoja: las fotos llevan class="ph" (sin width/height propios), el <style>
// incluye photoSizeCss(tamañoDeSiempre) y el .print-btn incluye photoSizeControlsHtml(clave).
// "Chico" es el tamaño que la hoja tenía antes de existir esta opción.

export const PHOTO_SIZE_KEYS = {
  orders:    "igwt.impresion.fotoOrden",
  purchases: "igwt.impresion.fotoCompra",
};

// Mediano y Grande en píxeles de pantalla; al imprimir, el navegador los pasa a papel igual.
const SIZES = [
  { id: "chico",   label: "Chico" },
  { id: "mediano", label: "Mediano", px: 80 },
  { id: "grande",  label: "Grande",  px: 130 },
];

export function photoSizeCss(basePx) {
  return `
    :root { --ph: ${basePx}px; }
    .ph { width: var(--ph); height: var(--ph); flex-shrink: 0; }
    .ph-opts button { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 6px; padding: 5px 9px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .ph-opts button.on { background: #1e40af; border-color: #1e40af; color: #fff; }`;
}

// Botones + un script chico que aplica el tamaño guardado al abrir la hoja. La hoja se abre desde
// un blob del mismo sitio, así que comparte el localStorage del panel.
export function photoSizeControlsHtml(storageKey, basePx) {
  const px = Object.fromEntries(SIZES.map((s) => [s.id, s.px || basePx]));
  const buttons = SIZES
    .map((s) => `<button type="button" data-ph="${s.id}" onclick="__phSet('${s.id}')">${s.label}</button>`)
    .join("");
  return `
  <div class="ph-opts" style="display:flex;align-items:center;gap:4px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:4px 6px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <span style="font-size:12px;font-weight:700;color:#475569;margin-right:2px">Fotos:</span>${buttons}
  </div>
  <script>
    (function () {
      var KEY = ${JSON.stringify(storageKey)}, PX = ${JSON.stringify(px)};
      function apply(id) {
        if (!PX[id]) id = "chico";
        document.documentElement.style.setProperty("--ph", PX[id] + "px");
        var btns = document.querySelectorAll(".ph-opts button");
        for (var i = 0; i < btns.length; i++) btns[i].className = btns[i].getAttribute("data-ph") === id ? "on" : "";
      }
      window.__phSet = function (id) {
        apply(id);
        try { localStorage.setItem(KEY, id); } catch (e) {}
      };
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) {}
      apply(saved || "chico");
    })();
  </script>`;
}
