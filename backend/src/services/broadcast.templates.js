// Plantillas de los emails masivos (Admin → Emails): el email que escribe el admin y el aviso de una
// campaña de ofertas. Funciones puras — no tocan la base ni mandan nada — para poder testearlas
// (test/broadcast.test.js). Quien manda es services/broadcast.service.js.
//
// Diseño claro (fondo blanco, logo arriba) y armado con tablas: Gmail y Outlook no respetan flex,
// grid ni object-fit. Antes era oscuro, como los emails automáticos de email.service.js, y en el
// celular se veía apretado y con las tarjetas de productos desparejas (7/10/2026, pedido del cliente).

const { cardBadge } = require("./offers.service");

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const INK = "#0f172a";      // títulos
const TEXT = "#334155";     // texto
const MUTED = "#64748b";
const GREEN = "#00873a";    // verde de la marca (botones)
const RED = "#dc2626";      // precio con descuento

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
      const html = escapeHtml(p)
        .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${INK}">$1</strong>`)
        .replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}" style="color:${GREEN};text-decoration:underline">${url}</a>`)
        .replace(/\n/g, "<br>");
      return `<p style="color:${TEXT};font-family:${FONT};font-size:16px;line-height:1.6;margin:0 0 16px">${html}</p>`;
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

// Nombres larguísimos ("BARRA DE SONIDO BOSE SOUNDTOUCH 300 ACOUSTIMASS 300 BASS (USADO)") rompían la
// grilla: cada tarjeta quedaba de un alto distinto. Se cortan a 3 renglones aprox.
const shortName = (name, max = 40) => {
  const s = String(name || "").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

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

// Grilla de 2 columnas. Todas las tarjetas tienen la misma estructura con alturas fijas (foto, nombre,
// precios) para que queden parejas; la foto se encaja sin deformarse (max-width/max-height, sin
// object-fit, que Gmail ignora).
function productGridHtml(cards) {
  if (!cards?.length) return "";
  const cell = (c) => c ? `
        <td width="50%" valign="top" style="padding:6px">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:12px;background:#ffffff">
            <tr><td height="160" align="center" valign="middle" style="height:160px;padding:10px;border-bottom:1px solid #f1f5f9">
              <a href="${c.url}" style="text-decoration:none">
                ${c.imageUrl
                  ? `<img src="${escapeHtml(c.imageUrl)}" alt="${escapeHtml(c.name)}" style="display:block;margin:0 auto;max-width:100%;max-height:140px;width:auto;height:auto;border:0">`
                  : `<span style="font-size:40px;line-height:140px">📦</span>`}
              </a>
            </td></tr>
            <tr><td height="54" valign="top" style="height:54px;padding:10px 12px 0">
              <a href="${c.url}" style="text-decoration:none;color:${INK};font-family:${FONT};font-size:13px;line-height:18px;font-weight:600">${escapeHtml(shortName(c.name))}</a>
            </td></tr>
            <tr><td style="padding:8px 12px 14px;font-family:${FONT}">
              <table cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="font-size:12px;color:#94a3b8;text-decoration:line-through;white-space:nowrap;padding-right:6px">${c.oldPrice || "&nbsp;"}</td>
                ${c.discountPct ? `<td style="white-space:nowrap"><span style="background:${RED};color:#ffffff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:6px">-${c.discountPct}%</span></td>` : ""}
              </tr></table>
              <div style="font-size:18px;line-height:24px;font-weight:800;color:${c.oldPrice ? RED : GREEN};margin-top:3px;white-space:nowrap">${c.price}</div>
            </td></tr>
          </table>
        </td>` : `<td width="50%" style="padding:6px"></td>`;
  const rows = [];
  for (let i = 0; i < cards.length; i += 2) rows.push(`<tr>${cell(cards[i])}${cell(cards[i + 1])}</tr>`);
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>`;
}

const button = (text, url, { bg = GREEN, color = "#ffffff" } = {}) => `
  <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tr>
    <td align="center" bgcolor="${bg}" style="background:${bg};border-radius:10px">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:16px;font-weight:700;color:${color};text-decoration:none;border-radius:10px">${escapeHtml(text)}</a>
    </td>
  </tr></table>`;

// Email completo. heroHtml (opcional) es la franja de color de la campaña, debajo del logo.
function buildEmailHtml({
  storeName, frontendUrl = "", preheader = "", heroHtml = "", title = "", bodyHtml = "",
  sectionTitle = "", products = [], buttonText = "", buttonUrl = "", footnote = "", unsubscribeUrl = "",
}) {
  const logo = frontendUrl
    ? `<a href="${escapeHtml(frontendUrl)}" style="text-decoration:none"><img src="${escapeHtml(frontendUrl)}/logo-email.png" alt="${escapeHtml(storeName)}" width="180" style="display:block;margin:0 auto;width:180px;max-width:60%;height:auto;border:0"></a>`
    : `<span style="font-family:${FONT};font-size:24px;font-weight:800;color:${INK}">${escapeHtml(storeName)}</span>`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Language" content="es">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(storeName)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5f9" style="background:#f1f5f9">
    <tr><td align="center" style="padding:24px 10px">
      <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
        <tr><td align="center" style="padding:22px 24px 18px">${logo}</td></tr>
        ${heroHtml}
        <tr><td style="padding:28px 24px 8px">
          ${title ? `<h1 style="margin:0 0 16px;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:800;color:${INK}">${escapeHtml(title)}</h1>` : ""}
          ${bodyHtml}
        </td></tr>
        ${products.length ? `
        <tr><td style="padding:8px 18px 4px">
          ${sectionTitle ? `<p style="margin:0 6px 8px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${MUTED}">${escapeHtml(sectionTitle)}</p>` : ""}
          ${productGridHtml(products)}
        </td></tr>` : ""}
        ${buttonText && buttonUrl ? `<tr><td style="padding:22px 24px 8px">${button(buttonText, buttonUrl)}</td></tr>` : ""}
        ${footnote ? `<tr><td align="center" style="padding:10px 24px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#94a3b8">${escapeHtml(footnote)}</td></tr>` : ""}
        <tr><td style="padding:24px 24px 0"><div style="border-top:1px solid #e2e8f0;font-size:0;line-height:0">&nbsp;</div></td></tr>
        <tr><td align="center" style="padding:16px 24px 26px;font-family:${FONT};font-size:12px;line-height:1.6;color:#94a3b8">
          ¿Tenés alguna consulta? Respondé este email o escribinos por WhatsApp.<br>
          ¿Te llegó a Promociones? Movelo a Principal para no perderte nuestras ofertas.<br>
          Recibís este email porque tenés una cuenta en ${escapeHtml(storeName)}.
          ${unsubscribeUrl ? `<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8;text-decoration:underline">No quiero recibir más ofertas ni novedades</a>` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Versión en texto plano ────────────────────────────────────────────────────
// Todos los emails van también en texto plano (multipart/alternative): Gmail desconfía de los que
// son solo HTML y los manda más seguido a Promociones o Spam.
const plainBody = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/\*\*(.+?)\*\*/g, "$1").trim();
function plainFooter(storeName, unsubscribeUrl) {
  return [
    "--",
    storeName,
    "¿Tenés alguna consulta? Respondé este email o escribinos por WhatsApp.",
    unsubscribeUrl ? `Para no recibir más ofertas ni novedades: ${unsubscribeUrl}` : null,
  ].filter(Boolean).join("\n");
}

// ── Formato simple: como un email personal ───────────────────────────────────
// Sin logo, sin colores ni botones grandes: solo el texto, como lo escribiría una persona. Es lo que
// más ayuda a que Gmail lo ponga en Principal y no en Promociones (pedido del cliente, 7/10/2026:
// "el cliente no lo ve"). No lo garantiza: con muchos destinatarios Gmail igual puede clasificarlo.
function buildPlainEmail(broadcast, recipient, ctx) {
  const name = recipient?.name;
  const subject = personalize(broadcast.subject, name).trim();
  const title = personalize(broadcast.title, name).trim();
  const body = personalize(broadcast.body, name);
  const paragraphs = String(body).replace(/\r\n/g, "\n").trim().split(/\n{2,}/).filter(Boolean)
    .map((par) => `<p style="margin:0 0 14px">${escapeHtml(par)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(https?:\/\/[^\s<]+)/g, (url) => `<a href="${url}">${url}</a>`)
      .replace(/\n/g, "<br>")}</p>`)
    .join("");
  const link = broadcast.buttonText && broadcast.buttonUrl
    ? `<p style="margin:0 0 14px"><a href="${escapeHtml(broadcast.buttonUrl)}">${escapeHtml(broadcast.buttonText)}</a></p>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Language" content="es"></head>
<body style="margin:0;padding:12px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222222">
<div style="max-width:600px">
${title ? `<p style="margin:0 0 14px"><strong>${escapeHtml(title)}</strong></p>` : ""}
${paragraphs}
${link}
<p style="margin:22px 0 0;color:#555555">${escapeHtml(ctx.storeName)}</p>
${ctx.unsubscribeUrl ? `<p style="margin:18px 0 0;font-size:12px;color:#888888">Si no querés recibir más emails de ${escapeHtml(ctx.storeName)}, <a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#888888">tocá acá</a>.</p>` : ""}
</div>
</body>
</html>`;
  const text = [
    title,
    plainBody(body),
    broadcast.buttonText && broadcast.buttonUrl ? `${broadcast.buttonText}: ${broadcast.buttonUrl}` : null,
    ctx.storeName,
    ctx.unsubscribeUrl ? `Si no querés recibir más emails: ${ctx.unsubscribeUrl}` : null,
  ].filter(Boolean).join("\n\n");
  return { subject, html, text };
}

// ── Email escrito por el admin (con diseño) ───────────────────────────────────
// broadcast: { subject, title, body, buttonText, buttonUrl }; recipient: { name }.
function buildCustomEmail(broadcast, recipient, ctx) {
  const name = recipient?.name;
  const subject = personalize(broadcast.subject, name).trim();
  const title = personalize(broadcast.title, name).trim();
  const body = personalize(broadcast.body, name);
  return {
    subject,
    text: [
      title,
      plainBody(body),
      broadcast.buttonText && broadcast.buttonUrl ? `${broadcast.buttonText}: ${broadcast.buttonUrl}` : null,
      plainFooter(ctx.storeName, ctx.unsubscribeUrl),
    ].filter(Boolean).join("\n\n"),
    html: buildEmailHtml({
      storeName: ctx.storeName,
      frontendUrl: ctx.frontendUrl,
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

// Descuento para el público que recibe el email, en partes para el encabezado:
// { prefix: "Hasta" | null, amount: "20%" | "$ 5.000" }. null si la campaña no aplica a ese público.
function offerHighlightParts(offer, items, side) {
  const badge = cardBadge(offer, items, side);
  if (!badge) return null;
  const n = Number(badge.value).toLocaleString("es-AR", { maximumFractionDigits: 2 });
  return { prefix: badge.upTo ? "Hasta" : null, amount: offer.discountType === "FIXED" ? `$ ${n}` : `${n}%` };
}
// "10% OFF" / "Hasta 25% OFF" / "$ 5.000 OFF" (asunto y preheader).
function offerHighlight(offer, items, side) {
  const p = offerHighlightParts(offer, items, side);
  return p ? `${p.prefix ? `${p.prefix} ` : ""}${p.amount} OFF` : "";
}

// Fecha de fin en hora argentina: "sábado 18/10".
function endsText(endsAt) {
  if (!endsAt) return "";
  const d = new Date(endsAt);
  const fmt = (opts) => d.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", ...opts });
  return `${fmt({ weekday: "long" })} ${fmt({ day: "numeric", month: "numeric" })}`;
}

// Color de la franja de la campaña: el mismo de su tarjeta del inicio (Admin → Ofertas). Con
// "color propio" se usa ese; con los demás estilos, el color principal de cada uno.
const STYLE_COLORS = {
  normal: "#0b1c30", fire: "#c2410c", sale: "#b3111e", fresh: "#00873a",
  premium: "#15161a", bolt: "#1d4ed8", neon: "#6d28d9", ice: "#0e6ba8",
};
function heroColor(offer) {
  if (offer.cardStyle === "color" && /^#[0-9a-f]{6}$/i.test(offer.cardColor || "")) return offer.cardColor;
  return STYLE_COLORS[offer.cardStyle] || STYLE_COLORS.sale;
}
// Texto oscuro sobre un color claro (mismo criterio que textColorFor del frontend).
function textOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? INK : "#ffffff";
}

function offerHero(offer, parts, ends, catalogUrl) {
  const bg = heroColor(offer);
  const fg = textOn(bg);
  return `
        <tr><td align="center" bgcolor="${bg}" style="background:${bg};padding:30px 24px 32px;font-family:${FONT};color:${fg}">
          <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${fg};opacity:0.85">Campaña de ofertas</p>
          <p style="margin:0 0 14px;font-size:30px;line-height:1.15;font-weight:800;color:${fg}">${escapeHtml(offer.name)}</p>
          ${parts ? `
          ${parts.prefix ? `<p style="margin:0;font-size:14px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${fg}">${escapeHtml(parts.prefix)}</p>` : ""}
          <p style="margin:0;font-size:56px;line-height:1;font-weight:900;color:${fg}">${escapeHtml(parts.amount)} <span style="font-size:28px">OFF</span></p>` : ""}
          ${ends ? `
          <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:16px auto 0"><tr>
            <td bgcolor="#ffffff" style="background:#ffffff;border-radius:999px;padding:6px 14px;font-size:13px;font-weight:700;color:${bg}">Hasta el ${escapeHtml(ends)}</td>
          </tr></table>` : ""}
          <div style="margin-top:20px">${button("Ver las ofertas", catalogUrl, { bg: "#ffffff", color: bg })}</div>
        </td></tr>`;
}

// offer: con items ({ discountValue, wholesaleDiscountValue }); products: ya filtrados para este
// público (visibles, con stock y con el descuento aplicado); side: "retail" | "wholesale".
function buildOfferEmail(offer, products, side, recipient, ctx) {
  const parts = offerHighlightParts(offer, offer.items || [], side);
  const highlight = offerHighlight(offer, offer.items || [], side);
  const name = firstName(recipient?.name);
  const ends = endsText(offer.endsAt);
  const catalogUrl = `${ctx.frontendUrl}/catalogo?offerId=${offer.id}`;
  const intro = [
    name ? `¡Hola ${name}!` : "¡Hola!",
    offer.description ? offer.description : "Arrancó una campaña con descuentos en productos seleccionados.",
  ].join("\n\n");
  const cards = products.slice(0, 6).map((p) => productCard(p, side, ctx));
  return {
    subject: `${offer.name}${highlight ? `: ${highlight}` : ""} en ${ctx.storeName}`,
    text: [
      [offer.name, highlight, ends ? `Hasta el ${ends}` : null].filter(Boolean).join(" — "),
      intro,
      cards.length ? ["Algunos productos en oferta:", ...cards.map((c) => `- ${c.name}: ${c.price}${c.oldPrice ? ` (antes ${c.oldPrice})` : ""}`)].join("\n") : null,
      `Ver todas las ofertas: ${catalogUrl}`,
      "Promoción válida hasta agotar stock o hasta el fin de la campaña.",
      plainFooter(ctx.storeName, ctx.unsubscribeUrl),
    ].filter(Boolean).join("\n\n"),
    html: buildEmailHtml({
      storeName: ctx.storeName,
      frontendUrl: ctx.frontendUrl,
      preheader: `${highlight || "Descuentos"} en productos seleccionados${ends ? ` — hasta el ${ends}` : ""}.`,
      heroHtml: offerHero(offer, parts, ends, catalogUrl),
      bodyHtml: formatBodyHtml(intro),
      sectionTitle: products.length ? "Algunos productos en oferta" : "",
      products: cards,
      buttonText: "Ver todas las ofertas",
      buttonUrl: catalogUrl,
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
  buildPlainEmail,
  buildOfferEmail,
  offerHighlight,
  endsText,
};
