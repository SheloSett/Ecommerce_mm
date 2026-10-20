// Casilla "📍 Módulo / estante" en las hojas de órdenes que se imprimen desde el panel (desde la
// lista y desde el detalle): muestra u oculta la ubicación en el depósito de cada producto.
//
// Se tilda en la misma hoja, al lado de "Fotos:". El cambio se ve al instante y se recuerda en el
// navegador para la próxima vez: una preferencia para las órdenes (de entrada tildada, la ubicación
// sirve para separar el pedido) y otra para las cotizaciones (de entrada sin tildar, la cotización se
// le manda al cliente). Va dentro de .print-btn, que no sale en el papel.
//
// Cómo se usa en una hoja: la etiqueta de ubicación lleva class="loc", el <style> incluye
// locationCss() y el .print-btn incluye locationControlsHtml(clave, tildadaDeEntrada).
// Si ningún producto de la hoja tiene ubicación, la casilla no aparece.

export const LOCATION_KEYS = {
  orders:       "igwt.impresion.ubicacionOrden",
  cotizaciones: "igwt.impresion.ubicacionCotizacion",
};

export function locationCss() {
  return `
    html.sin-ubicacion .loc { display: none !important; }`;
}

// Casilla + un script chico que aplica la preferencia guardada al abrir la hoja. La hoja se abre
// desde un blob del mismo sitio, así que comparte el localStorage del panel.
export function locationControlsHtml(storageKey, defaultOn) {
  return `
  <label class="loc-opt" style="display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:6px 9px;box-shadow:0 1px 3px rgba(0,0,0,.1);font-size:12px;font-weight:700;color:#475569;cursor:pointer;user-select:none">
    <input type="checkbox" id="__locChk" onchange="__locSet(this.checked)" style="width:15px;height:15px;margin:0;cursor:pointer;accent-color:#1e40af" />
    📍 Módulo / estante
  </label>
  <script>
    (function () {
      var KEY = ${JSON.stringify(storageKey)}, DEF = ${defaultOn ? "true" : "false"};
      function apply(on) {
        document.documentElement.classList.toggle("sin-ubicacion", !on);
        var chk = document.getElementById("__locChk");
        if (chk) chk.checked = on;
      }
      window.__locSet = function (on) {
        apply(on);
        try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
      };
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) {}
      apply(saved === null ? DEF : saved === "1");
      // Los productos se cargan después de la barra: se mira cuando la hoja terminó de armarse.
      document.addEventListener("DOMContentLoaded", function () {
        if (!document.querySelector(".loc")) {
          var opt = document.querySelector(".loc-opt");
          if (opt) opt.style.display = "none";
        }
      });
    })();
  </script>`;
}
