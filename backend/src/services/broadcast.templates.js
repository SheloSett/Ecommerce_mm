// Plantillas de los emails masivos (Admin → Emails): el email que escribe el admin y el aviso de una
// campaña de ofertas. Funciones puras — no tocan la base ni mandan nada — para poder testearlas
// (test/broadcast.test.js). Quien manda es services/broadcast.service.js.
//
// Mismo estilo que los emails automáticos de email.service.js (fondo oscuro, verde de la marca),
// armado con tablas porque Gmail/Outlook no respetan flex ni grid.

const { cardBadge } = require("./offers.service");

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// Primer nombre para el saludo ("Juan Pérez" → "Juan"). Vacío → "".
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

// {nombre} → primer nombre del cliente. Se aplica al asunto, al título y al texto.
function personalize(text, name) {
  return String(text ?? "").replace(/\{nombre\}/gi, firstName(name) || "");
}

// Texto del admin → HTML: se escapa todo (nada de HTML crudo), **negrita**, los links se vuelven
// clickeables, una línea en blanco separa párrafos y un Enter es un salto de línea.
function formatBodyHtml(text) {
  const paragraphs = String(text ?? "").replace(/\r\n/g, "\n").trim().split(/\n{2,}/).filter(Boolean);
  return paragraphs
    .map((p) => {
      let html = escapeHtml(p)
        .replace(/\*\*(.+?)\*\*/g, "<strong style=\"color:#f1f5f9\">$1</strong>")
        .replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" style="color:#4ade80">${url}</a>`)
        .replace(/\n/g, "<br>");
      return `<p style="color:#cbd5e1;font-size:15px;line-height:1.65;margin:0 0 16px">${html}</p>`;
    })
    .join("");
}

function formatMoney(amount, currency) {
  if (currency === "USD") {
    return `USD ${Number(amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount ?? 0);
}

// URL absoluta de la primera foto (en la base se guardan "/uploads/x.jpg" o URLs de Cloudinary).
function productImageUrl(product, backendUrl) {
  const img = product?.images?.[0];
  if (!img) return null;
  return img.startsWith("http") ? img : `${backendUrl}${img}`;
}

// Producto → tarjeta del email con el precio del público que lo recibe. Los precios mayoristas solo
// se usan con side "wholesale", que es el de los destinatarios mayoristas APROBADOS.
function productCard(product, side, { frontendUrl, backendUrl }) {
  const wholesale = side === "wholesale" && product.wholesalePrice;
  const base = wholesale ? product.wholesalePrice : product.price;
  const sale = wholesale ? product.wholesaleSalePrice : product.salePrice;
  const hasSale = sale != null && sale < base;
  return {
    name: product.name,
    url: `${frontendUrl}/producto/${product.id}`,
    imageUrl: productImageUrl(product, backendUrl),
    price: formatMoney(hasSale ? sale : base, product.currency),
    oldPrice: hasSale ? formatMoney(base, product.currency) : null,
    discountPct: hasSale ? Math.round((1 - sale / base) * 100) : 0,
  };
}

function productGridHtml(cards) {
  if (!cards?.length) return "";
  const cell = (c) => c ? `
        <td width="50%" valign="top" style="padding:6px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;border:1px solid #334155;border-radius:10px;overflow:hidden">
            <tr><td style="padding:0;line-height:0;position:relative">
              <a href="${c.url}" style="display:block;text-decoration:none">
                ${c.imageUrl
                  ? `<img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.name)}" width="100%" height="170" style="display:block;width:100%;height:170px;object-fit:cover;background:#ffffff;border:0">`
                  : `<div style="height:170px;background:#1e293b;text-align:center;line-height:170px;color:#475569;font-size:32px">📦</div>`}
              </a>
            </td></tr>
            <tr><td style="padding:10px 12px 12px">
              <a href="${c.url}" style="text-decoration:none">
                <div style="color:#f1f5f9;font-size:13px;font-weight:600;line-height:1.3;height:34px;overflow:hidden">${escapeHtml(c.name)}</div>
              </a>
              <div style="margin-top:6px">
                ${c.oldPrice ? `<span style="color:#64748b;font-size:12px;text-decoration:line-through">${c.oldPrice}</span>&nbsp;` : ""}
                ${c.discountPct ? `<span style="background:#ef4444;color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:5px">-${c.discountPct}%</span>` : ""}
              </div>
              <div style="color:${c.oldPrice ? "#f87171" : "#22c55e"};font-size:17px;font-weight:800;margin-top:2px">${c.price}</div>
            </td></tr>
          </table>
        </td>` : `<td width="50%"></td>`;
  const rows = [];
  for (let i = 0; i < cards.length; i += 2) rows.push(`<tr>${cell(cards[i])}${cell(cards[i + 1])}</tr>`);
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px">${rows.join("")}</table>`;
}

// Email completo. Todos los textos que vienen del admin ya llegan escapados/formateados.
function buildEmailHtml({
  storeName, preheader = "", kicker = "", title = "", highlight = "", highlightSub = "",
  bodyHtml = "", products = [], buttonText = "", buttonUrl = "", footnote = "", unsubscribeUrl = "",
}) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(storeName)}</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 12px">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:14px;overflow:hidden;max-width:600px;width:100%">
        <tr><td style="padding:28px 32px 20px;text-align:center;border-bottom:2px solid #22c55e">
          <h1 style="color:#22c55e;margin:0;font-size:26px;font-weight:800;letter-spacing:-0.5px">${escapeHtml(storeName)}</h1>
          ${kicker ? `<p style="color:#94a3b8;font-size:12px;margin:6px 0 0;letter-spacing:1px;text-transform:uppercase;font-weight:700">${escapeHtml(kicker)}</p>` : ""}
        </td></tr>
        <tr><td style="padding:30px 32px 10px">
          ${title ? `<h2 style="color:#f8fafc;font-size:26px;line-height:1.2;margin:0 0 14px;font-weight:800">${escapeHtml(title)}</h2>` : ""}
          ${highlight ? `
          <table cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr><td style="background:#dc2626;border-radius:12px;padding:12px 20px;text-align:center">
            <div style="color:#ffffff;font-size:30px;font-weight:900;line-height:1;letter-spacing:-0.5px">${escapeHtml(highlight)}</div>
            ${highlightSub ? `<div style="color:#fee2e2;font-size:12px;font-weight:700;margin-top:6px">${escapeHtml(highlightSub)}</div>` : ""}
          </td></tr></table>` : ""}
          ${bodyHtml}
          ${productGridHtml(products)}
          ${buttonText && buttonUrl ? `
          <div style="text-align:center;margin:26px 0 14px">
            <a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:#22c55e;color:#ffffff;text-decoration:none;padding:15px 38px;border-radius:10px;font-weight:800;font-size:15px">${escapeHtml(buttonText)}</a>
          </div>` : ""}
          ${footnote ? `<p style="color:#94a3b8;font-size:12px;line-height:1.5;margin:6px 0 10px;text-align:center">${escapeHtml(footnote)}</p>` : ""}
        </td></tr>
        <tr><td style="background:#0f172a;padding:20px 32px;text-align:center;border-top:1px solid #334155">
          <p style="color:#64748b;font-size:12px;line-height:1.6;margin:0 0 6px">¿Tenés alguna consulta? Respondé este email o escribinos por WhatsApp.</p>
          <p style="color:#475569;font-size:11px;line-height:1.6;margin:0">
            Recibís este email porque tenés una cuenta en ${escapeHtml(storeName)}.
            ${unsubscribeUrl ? `<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;text-decoration:underline">No quiero recibir más ofertas ni novedades</a>` : ""}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Email escrito por el admin ────────────────────────────────────────────────
// broadcast: { subject, title, body, buttonText, buttonUrl }; recipient: { name }.
function buildCustomEmail(broadcast, recipient, ctx) {
  const name = recipient?.name;
  const subject = personalize(broadcast.subject, name).trim();
  const title = personalize(broadcast.title, name).trim();
  const body = personalize(broadcast.body, name);
  return {
    subject,
    html: buildEmailHtml({
      storeName: ctx.storeName,
      preheader: body.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 120),
      title,
      bodyHtml: formatBodyHtml(body),
      buttonText: broadcast.buttonText,
      buttonUrl: broadcast.buttonUrl,
      unsubscribeUrl: ctx.unsubscribeUrl,
    }),
  };
}

// ── Aviso de una campaña ──────────────────────────────────────────────────────
// "10% OFF" / "Hasta 25% OFF" / "$ 5.000 OFF" para el público que recibe el email.
function offerHighlight(offer, items, side) {
  const badge = cardBadge(offer, items, side);
  if (!badge) return "";
  const n = Number(badge.value).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  const amount = offer.discountType === "FIXED" ? `$ ${n}` : `${n}%`;
  return `${badge.upTo ? "Hasta " : ""}${amount} OFF`;
}

// Fecha de fin en hora argentina: "sábado 18/10".
function endsText(endsAt) {
  if (!endsAt) return "";
  const d = new Date(endsAt);
  const fmt = (opts) => d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", ...opts });
  return `${fmt({ weekday: "long" })} ${fmt({ day: "numeric", month: "numeric" })}`;
}

// offer: con items ({ discountValue, wholesaleDiscountValue }); products: ya filtrados para este
// público (visibles, con stock y con el descuento aplicado); side: "retail" | "wholesale".
function buildOfferEmail(offer, products, side, recipient, ctx) {
  const highlight = offerHighlight(offer, offer.items || [], side);
  const name = firstName(recipient?.name);
  const ends = endsText(offer.endsAt);
  const intro = [
    name ? `¡Hola ${name}!` : "¡Hola!",
    offer.description ? offer.description : "Arrancó una campaña con descuentos en productos seleccionados.",
  ].join("\n\n");
  return {
    subject: `${offer.name}${highlight ? `: ${highlight}` : ""} en ${ctx.storeName}`,
    html: buildEmailHtml({
      storeName: ctx.storeName,
      preheader: `${highlight || "Descuentos"} en productos seleccionados${ends ? ` — hasta el ${ends}` : ""}.`,
      kicker: "Campaña de ofertas",
      title: offer.name,
      highlight,
      highlightSub: ends ? `Hasta el ${ends}` : "",
      bodyHtml: formatBodyHtml(intro),
      products: products.slice(0, 6).map((p) => productCard(p, side, ctx)),
      buttonText: "Ver todas las ofertas",
      buttonUrl: `${ctx.frontendUrl}/catalogo?offerId=${offer.id}`,
      footnote: "Promoción válida hasta agotar stock o hasta el fin de la campaña.",
      unsubscribeUrl: ctx.unsubscribeUrl,
    }),
  };
}

module.exports = {
  escapeHtml,
  firstName,
  personalize,
  formatBodyHtml,
  formatMoney,
  productCard,
  buildEmailHtml,
  buildCustomEmail,
  buildOfferEmail,
  offerHighlight,
  endsText,
};
