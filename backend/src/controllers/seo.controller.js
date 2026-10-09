const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const SITE_URL = (process.env.FRONTEND_URL || "https://igwtstore.com.ar").split(",")[0].trim();

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(html) {
  return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// GET /api/sitemap.xml — sitemap dinámico: páginas estáticas + un <url> por cada producto activo
async function getSitemap(req, res) {
  try {
    const products = await prisma.product.findMany({
      where: { active: true, visibility: { in: ["AMBOS", "MINORISTA"] } },
      select: { id: true, slug: true, updatedAt: true },
    });

    const staticPages = [
      { loc: "/", priority: "1.0", changefreq: "daily" },
      { loc: "/catalogo", priority: "0.9", changefreq: "daily" },
      { loc: "/login", priority: "0.3", changefreq: "monthly" },
      { loc: "/registro", priority: "0.4", changefreq: "monthly" },
      { loc: "/como-comprar", priority: "0.3", changefreq: "monthly" },
      { loc: "/sobre-nosotros", priority: "0.3", changefreq: "monthly" },
      { loc: "/terminos", priority: "0.2", changefreq: "yearly" },
      { loc: "/privacidad", priority: "0.2", changefreq: "yearly" },
    ];

    const urls = [
      ...staticPages.map(
        (p) => `  <url>\n    <loc>${SITE_URL}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
      ),
      ...products.map((p) => {
        const loc = `${SITE_URL}/producto/${p.slug || p.id}`;
        const lastmod = p.updatedAt.toISOString().slice(0, 10);
        return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
      }),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    console.error("getSitemap error:", err);
    res.status(500).json({ error: "Error al generar el sitemap" });
  }
}

// ─── Feed del catálogo ───────────────────────────────────────────────────────
// GET /api/feed.xml — feed de productos formato Google Merchant (RSS 2.0 + namespace g:).
// Lo lee Meta Commerce Manager (catálogo para Instagram Shopping y anuncios dinámicos) y también
// sirve para Google Merchant Center: los dos aceptan este mismo formato.
//
// Qué sale: productos activos que ve el público minorista (visibility AMBOS/MINORISTA), con foto y
// con precio minorista, en SU moneda (un producto en USD sale "25.00 USD", no mal etiquetado como
// pesos). Los que se venden solo a mayoristas no salen: su `price` es el mayorista y el feed es público.
//
// Variantes: un producto con variantes sale como UN ítem por variante (id "<producto>-<variante>",
// todas agrupadas por g:item_group_id = id del producto), cada una con su precio, su stock y su foto.
// Antes salía un solo ítem con el precio base y el stock del producto, y en un producto con
// variantes el stock vive en las variantes (el del producto queda en 0), así que todo el catálogo
// con variantes figuraba "sin stock". Los ids son los mismos que manda el Pixel del navegador
// (frontend services/metaPixel.js) y la API de conversiones (services/meta.service.js): así Meta
// sabe qué producto del catálogo vio o compró cada persona.
const FEED_CACHE_MS = 5 * 60 * 1000;
let feedCache = { xml: null, at: 0 };

function feedPriceLine(tag, amount, currency) {
  return `      <g:${tag}>${Number(amount).toFixed(2)} ${currency}</g:${tag}>`;
}

function variantTitle(product, variant) {
  const combo = Array.isArray(variant.combination) ? variant.combination : [];
  const values = combo.map((c) => c?.value).filter(Boolean).join(" / ");
  return values ? `${product.name} - ${values}` : product.name;
}

// Un producto (con `variants` y `categories` incluidos) → lista de ítems del feed, ya como objetos.
// Función pura, testeable: no toca la base ni arma XML.
function feedItemsForProduct(p) {
  const currency = p.currency || "ARS";
  const link = `${SITE_URL}/producto/${p.slug || p.id}`;
  const description = (stripHtml(p.description) || p.name).slice(0, 5000);
  const cat = Array.isArray(p.categories) && p.categories.length ? p.categories[0] : null;
  const productType = cat ? (cat.parent?.name ? `${cat.parent.name} > ${cat.name}` : cat.name) : null;
  const base = { link, description, currency, brand: "IGWT Store", productType, condition: "new" };

  const variants = Array.isArray(p.variants) ? p.variants : [];
  if (variants.length === 0) {
    if (!(p.price > 0)) return [];
    return [{
      ...base,
      id: String(p.id),
      itemGroupId: null,
      title: p.name,
      price: p.price,
      salePrice: p.salePrice != null && p.salePrice < p.price ? p.salePrice : null,
      inStock: !!(p.stockUnlimited || p.stock > 0),
      image: p.images[0],
      extraImages: p.images.slice(1, 11),
      mpn: p.sku || null,
    }];
  }

  return variants.flatMap((v) => {
    // Precio base: el de la variante si lo define, si no el del producto. La oferta es propia de la
    // variante (no se hereda la del producto). Mismo criterio que utils/pricing.js.
    const price = v.price != null ? v.price : p.price;
    if (!(price > 0)) return [];
    const vImages = Array.isArray(v.images) && v.images.length ? v.images : (v.image ? [v.image] : []);
    const images = vImages.length ? vImages : p.images;
    return [{
      ...base,
      id: `${p.id}-${v.id}`,
      itemGroupId: String(p.id),
      title: variantTitle(p, v).slice(0, 150),
      price,
      salePrice: v.salePrice != null && v.salePrice < price ? v.salePrice : null,
      inStock: !!(v.stockUnlimited || v.stock > 0),
      image: images[0],
      extraImages: images.slice(1, 11),
      mpn: v.sku || p.sku || null,
    }];
  });
}

function feedItemXml(it) {
  return [
    "    <item>",
    `      <g:id>${escapeXml(it.id)}</g:id>`,
    it.itemGroupId ? `      <g:item_group_id>${escapeXml(it.itemGroupId)}</g:item_group_id>` : "",
    `      <title>${escapeXml(it.title)}</title>`,
    `      <description>${escapeXml(it.description)}</description>`,
    `      <link>${escapeXml(it.link)}</link>`,
    `      <g:image_link>${escapeXml(it.image)}</g:image_link>`,
    ...it.extraImages.map((img) => `      <g:additional_image_link>${escapeXml(img)}</g:additional_image_link>`),
    `      <g:availability>${it.inStock ? "in stock" : "out of stock"}</g:availability>`,
    feedPriceLine("price", it.price, it.currency),
    it.salePrice != null ? feedPriceLine("sale_price", it.salePrice, it.currency) : "",
    `      <g:condition>${it.condition}</g:condition>`,
    `      <g:brand>${escapeXml(it.brand)}</g:brand>`,
    it.productType ? `      <g:product_type>${escapeXml(it.productType)}</g:product_type>` : "",
    `      <g:identifier_exists>no</g:identifier_exists>`,
    it.mpn ? `      <g:mpn>${escapeXml(it.mpn)}</g:mpn>` : "",
    "    </item>",
  ].filter(Boolean).join("\n");
}

async function buildProductFeedXml() {
  const products = await prisma.product.findMany({
    where: {
      active: true,
      visibility: { in: ["AMBOS", "MINORISTA"] },
      images: { isEmpty: false },
    },
    orderBy: { id: "asc" },
    include: {
      categories: { select: { name: true, parent: { select: { name: true } } } },
      // Solo las variantes que ve el público minorista (las "solo mayoristas" tienen precio mayorista).
      variants: { where: { active: true, visibility: { in: ["AMBOS", "MINORISTA"] } }, orderBy: { id: "asc" } },
    },
  });

  const items = products.flatMap(feedItemsForProduct).map(feedItemXml);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>IGWT Store — Catálogo</title>\n    <link>${SITE_URL}</link>\n    <description>Feed de productos de IGWT Store</description>\n${items.join("\n")}\n  </channel>\n</rss>\n`;
}

async function getProductFeed(req, res) {
  try {
    // Caché de 5 minutos: la ruta es pública, está exenta del rate limiter (index.js) y arma el
    // catálogo entero con sus variantes en cada llamada. Meta lo lee como mucho una vez por hora;
    // con la caché nadie puede usarla para cargar el servidor pidiéndola en bucle.
    if (!feedCache.xml || Date.now() - feedCache.at > FEED_CACHE_MS) {
      feedCache = { xml: await buildProductFeedXml(), at: Date.now() };
    }
    res.set("Content-Type", "application/xml");
    res.set("Cache-Control", "public, max-age=300");
    res.send(feedCache.xml);
  } catch (err) {
    console.error("getProductFeed error:", err);
    res.status(500).json({ error: "Error al generar el feed de productos" });
  }
}

// ─── Página de producto con Open Graph ───────────────────────────────────────
// GET /api/og/producto/:slug
//
// WhatsApp, Facebook, Telegram, etc. no ejecutan JavaScript: leen el HTML tal cual llega del
// servidor. Como la tienda es una SPA, ese HTML es el index.html genérico y la vista previa del
// link salía sin foto ni nombre del producto. El nginx del VPS manda TODAS las requests de
// /producto/* a este endpoint, que toma el index.html real del frontend (así los scripts y
// estilos son los del build actual), le inyecta título, descripción y foto del producto en el
// <head>, y lo devuelve. Para una persona la página carga igual que siempre (React arranca con
// el mismo HTML); para un bot ya vienen los datos del producto.
//
// FRONTEND_INTERNAL_URL: de dónde leer el index.html. En el VPS es el contenedor del frontend
// (127.0.0.1:8090); en desarrollo, el dev server de Vite (http://localhost:3000).
const FRONTEND_INTERNAL_URL = (process.env.FRONTEND_INTERNAL_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
let indexCache = { html: null, at: 0 };

async function loadIndexHtml() {
  if (indexCache.html && Date.now() - indexCache.at < 60 * 1000) return indexCache.html;
  const r = await fetch(`${FRONTEND_INTERNAL_URL}/index.html`, { headers: { accept: "text/html" } });
  if (!r.ok) throw new Error(`index.html ${r.status}`);
  const html = await r.text();
  indexCache = { html, at: Date.now() };
  return html;
}

function absoluteImage(path) {
  if (!path) return `${SITE_URL}/og-image.png`;
  let url = /^https?:\/\//i.test(path) ? path : `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  // WhatsApp y Facebook no siempre muestran WebP en la vista previa: a las fotos de Cloudinary se
  // les pide JPG (f_webp → f_jpg, o se agrega f_jpg si la URL no traía formato).
  if (/res\.cloudinary\.com\/.+\/upload\//.test(url)) {
    url = /\bf_webp\b/.test(url) ? url.replace(/\bf_webp\b/, "f_jpg") : url.replace("/upload/", "/upload/f_jpg/");
  }
  return url;
}

function ogBlock({ title, description, image, url, price, currency }) {
  const e = escapeXml;
  return [
    `<meta name="description" content="${e(description)}" />`,
    `<meta property="og:type" content="product" />`,
    `<meta property="og:url" content="${e(url)}" />`,
    `<meta property="og:title" content="${e(title)}" />`,
    `<meta property="og:description" content="${e(description)}" />`,
    `<meta property="og:image" content="${e(image)}" />`,
    `<meta property="og:image:secure_url" content="${e(image)}" />`,
    `<meta property="og:locale" content="es_AR" />`,
    `<meta property="og:site_name" content="IGWT Store" />`,
    price != null ? `<meta property="product:price:amount" content="${e(price)}" />` : "",
    price != null ? `<meta property="product:price:currency" content="${e(currency || "ARS")}" />` : "",
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${e(title)}" />`,
    `<meta name="twitter:description" content="${e(description)}" />`,
    `<meta name="twitter:image" content="${e(image)}" />`,
  ].filter(Boolean).join("\n    ");
}

async function getProductOgPage(req, res) {
  const { slug } = req.params;
  let product = null;
  try {
    const where = /^\d+$/.test(String(slug)) ? { id: parseInt(slug) } : { slug: String(slug) };
    product = await prisma.product.findFirst({
      where: { ...where, active: true },
      select: { id: true, name: true, slug: true, description: true, images: true, price: true, salePrice: true, currency: true, visibility: true },
    });
  } catch (err) {
    console.error("getProductOgPage (producto):", err.message);
  }

  let html;
  try {
    html = await loadIndexHtml();
  } catch (err) {
    // Sin index.html (frontend caído) se responde un HTML mínimo con los datos igual, así al
    // menos la vista previa del link funciona. Una persona ve un link a la tienda.
    console.error("getProductOgPage (index.html):", err.message);
    html = "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\" /><title>IGWT Store</title></head><body><a href=\"" + SITE_URL + "\">IGWT Store</a></body></html>";
  }

  if (product) {
    const title = `${product.name} | IGWT Store`;
    const desc = (stripHtml(product.description) || `${product.name} en IGWT Store. Envíos a todo Argentina.`).slice(0, 200);
    const image = absoluteImage(product.images?.[0]);
    const url = `${SITE_URL}/producto/${product.slug || product.id}`;
    // Antes: const price = product.salePrice && product.salePrice < product.price ? product.salePrice : product.price;
    // En un producto que se vende SOLO a mayoristas, `price` es el precio mayorista (el panel lo copia
    // ahí porque la base lo exige), y esta página la ve cualquiera que abra o comparta el link. Sin
    // precio: la vista previa sigue mostrando nombre, foto y descripción.
    const price = product.visibility === "MAYORISTA"
      ? null
      : (product.salePrice && product.salePrice < product.price ? product.salePrice : product.price);
    const block = ogBlock({ title, description: desc, image, url, price, currency: product.currency });
    // Se sacan el título, la descripción y las etiquetas og:/twitter: genéricas del index.html:
    // los bots toman la PRIMERA etiqueta de cada tipo, así que si quedaran duplicadas mostrarían
    // las de la tienda y no las del producto.
    html = html
      .replace(/<title>[^<]*<\/title>/i, `<title>${escapeXml(title)}</title>`)
      .replace(/[ \t]*<meta\s+name="description"[^>]*>\s*/gi, "")
      .replace(/[ \t]*<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>\s*/gi, "")
      .replace(/<\/head>/i, `    ${block}\n  </head>`);
  }

  // Helmet le pone a TODAS las respuestas del backend una Content-Security-Policy pensada para la
  // API (img-src solo el propio dominio, script-src solo el propio dominio). Esta respuesta es la
  // página de la tienda: con esa política el navegador bloqueaba las fotos de Cloudinary y
  // cualquier script externo (Mercado Pago), y como la tienda es una SPA el bloqueo se arrastraba
  // al navegar al catálogo. El frontend servido por nginx no manda CSP, así que acá tampoco.
  res.removeHeader("Content-Security-Policy");
  res.removeHeader("Cross-Origin-Opener-Policy");
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.send(html);
}

module.exports = {
  getSitemap,
  getProductFeed,
  getProductOgPage,
  _internals: { feedItemsForProduct, feedItemXml, variantTitle },
};
