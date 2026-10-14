// ─── Meta Pixel (Facebook / Instagram) ───────────────────────────────────────
// Carga el Pixel de Meta en la tienda y manda los eventos estándar de e-commerce: PageView,
// ViewContent (ficha de producto), AddToCart, InitiateCheckout, Purchase y Contact (clic en un link
// de WhatsApp). Con eso Meta puede medir qué anuncios terminan en compras o en consultas, armar
// públicos (quién vio tal producto y no compró) y mostrar anuncios dinámicos del catálogo.
//
// Todo es "fire and forget": si el Pixel no está configurado, no cargó o un bloqueador lo frenó,
// cada función no hace nada. Nunca bloquea la UI ni muestra errores al visitante.
//
// Reglas:
//  - El ID del Pixel viene de Admin → Configuración → Meta / Instagram (site_config.metaPixelId).
//  - Si el navegador tiene sesión de admin (admin_token) NO se carga: el dueño navegando su propia
//    tienda no debe contar como visitante ni como comprador. Para probar el Pixel: ventana de incógnito.
//  - commerceEvents=false (cliente MAYORISTA sin "metaTrackWholesale"): se manda PageView pero no
//    ViewContent/AddToCart/InitiateCheckout/Purchase, para no mezclar precios mayoristas en la
//    optimización de los anuncios.
//  - Ids de producto: los MISMOS que el feed del catálogo (backend seo.controller) y la API de
//    conversiones (backend meta.service): sin variante "<productId>"; con variante
//    "<productId>-<variantId>". Un producto con variantes se ve como "product_group" (= item_group_id).
//  - Purchase lleva eventID "order-<id>", igual que el que manda el servidor: Meta lo cuenta una vez.
//  - Contact (clic en WhatsApp) lleva eventID "wa-<único>" y el MISMO id viaja al backend
//    (POST /api/events/contact), que lo reenvía por la API de conversiones: Meta deduplica. El
//    envío al servidor sale aunque un bloqueador haya frenado el Pixel, así la consulta igual se
//    mide; pero nunca con sesión de admin ni si no hay Pixel configurado.

const PIXEL_SRC = "https://connect.facebook.net/en_US/fbevents.js";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const state = {
  pixelId: null,
  loaded: false,
  configured: false,     // hay un ID de Pixel válido en la configuración
  admin: false,          // el navegador tiene sesión de admin: no se mide nada
  commerce: true,
  lastPageViewPath: null,
  currentProduct: null,  // ficha de producto abierta: { id, name, hasVariants } (para Contact)
  lastContact: null,     // { href, at } del último clic en WhatsApp (evita el doble disparo)
};

function isAdminBrowser() {
  try { return !!localStorage.getItem("admin_token"); } catch { return false; }
}

function loadScript() {
  if (window.fbq) return;
  // Equivalente legible del snippet oficial de Meta: cola de llamadas hasta que carga fbevents.js
  const n = function () {
    if (n.callMethod) n.callMethod.apply(n, arguments);
    else n.queue.push(arguments);
  };
  window.fbq = n;
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];
  const s = document.createElement("script");
  s.async = true;
  s.src = PIXEL_SRC;
  document.head.appendChild(s);
}

// Se llama cada vez que cambia la configuración (id del Pixel o si corresponden eventos de compra).
// Carga el script una sola vez.
export function configureMetaPixel({ pixelId, commerceEvents = true } = {}) {
  state.commerce = commerceEvents !== false;
  const id = String(pixelId || "").trim();
  state.configured = !!id && /^\d{5,20}$/.test(id);
  state.admin = isAdminBrowser();
  if (!state.configured || state.admin) return;
  if (state.loaded) return;
  try {
    loadScript();
    window.fbq("init", id);
    state.pixelId = id;
    state.loaded = true;
  } catch { /* sin Pixel: la tienda sigue igual */ }
}

export function isMetaPixelActive() {
  return state.loaded;
}

function fire(name, data, options) {
  if (!state.loaded || typeof window.fbq !== "function") return;
  try {
    if (options) window.fbq("track", name, data || {}, options);
    else window.fbq("track", name, data || {});
  } catch { /* nada */ }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function contentId(productId, variantId) {
  return variantId ? `${productId}-${variantId}` : String(productId);
}

// Una por navegación. Se deduplica por ruta para no mandar dos veces la misma página (la
// configuración y el cambio de ruta pueden dispararla en el mismo render).
export function pixelPageView(path) {
  if (!state.loaded) return;
  const p = path || (window.location.pathname + window.location.search);
  if (p === state.lastPageViewPath) return;
  state.lastPageViewPath = p;
  fire("PageView");
}

// Ficha de producto
export function pixelViewContent({ id, name, price, currency, hasVariants, category } = {}) {
  if (!id) return;
  // Se recuerda qué ficha está abierta para que un clic en WhatsApp desde acá lleve el producto.
  // MetaPixel.jsx lo limpia al salir de /producto/.
  state.currentProduct = { id: String(id), name: name || undefined, hasVariants: !!hasVariants };
  if (!state.commerce) return;
  fire("ViewContent", {
    content_ids: [String(id)],
    content_type: hasVariants ? "product_group" : "product",
    content_name: name || undefined,
    content_category: category || undefined,
    value: num(price),
    currency: currency || "ARS",
  });
}

// Agregó al carrito (ya confirmado por el servidor)
export function pixelAddToCart({ productId, variantId, name, price, currency, quantity = 1 } = {}) {
  if (!state.commerce || !productId) return;
  const unit = num(price);
  const qty = Math.max(1, parseInt(quantity) || 1);
  fire("AddToCart", {
    content_ids: [contentId(productId, variantId)],
    content_type: "product",
    content_name: name || undefined,
    contents: [{ id: contentId(productId, variantId), quantity: qty, item_price: unit }],
    value: num(unit * qty),
    currency: currency || "ARS",
  });
}

// Entró al checkout con el carrito cargado. items: los del CartContext (id, variantId, price,
// quantity, currency). Si hay ítems en más de una moneda se informa la parte en pesos.
export function pixelInitiateCheckout(items = []) {
  if (!state.commerce || !Array.isArray(items) || items.length === 0) return;
  const currency = items.some((i) => (i.currency || "ARS") === "ARS") ? "ARS" : (items[0].currency || "ARS");
  const inCurrency = items.filter((i) => (i.currency || "ARS") === currency);
  const contents = inCurrency.map((i) => ({ id: contentId(i.id, i.variantId), quantity: i.quantity || 1, item_price: num(i.price) }));
  fire("InitiateCheckout", {
    content_ids: contents.map((c) => c.id),
    content_type: "product",
    contents,
    num_items: contents.reduce((acc, c) => acc + c.quantity, 0),
    value: num(contents.reduce((acc, c) => acc + c.item_price * c.quantity, 0)),
    currency,
  });
}

// Pago aprobado (pantalla de resultado de MercadoPago). order: lo que devuelve
// GET /api/payments/order/:id/status (id, total, totalUsd, items). Mismo criterio de moneda que el
// servidor (meta.service.js): pesos si hay, si no dólares.
export function pixelPurchase(order) {
  if (!state.commerce || !order?.id) return;
  const totalArs = num(order.total);
  const totalUsd = num(order.totalUsd);
  const currency = totalArs > 0 || totalUsd <= 0 ? "ARS" : "USD";
  const items = (order.items || []).filter((i) => i.productId && (i.currency || "ARS") === currency);
  const contents = items.map((i) => ({ id: contentId(i.productId, i.variantId), quantity: i.quantity || 1, item_price: num(i.price) }));
  fire("Purchase", {
    content_ids: contents.map((c) => c.id),
    content_type: "product",
    contents,
    num_items: contents.reduce((acc, c) => acc + c.quantity, 0),
    value: currency === "ARS" ? totalArs : totalUsd,
    currency,
    order_id: String(order.id),
  }, { eventID: `order-${order.id}` });
}

export function clearPixelCurrentProduct() {
  state.currentProduct = null;
}

// ¿Es un link a WhatsApp? wa.me, api.whatsapp.com, web.whatsapp.com, whatsapp.com y el esquema
// whatsapp:// de la app. Cualquier otra cosa (incluido un href relativo de la tienda) no cuenta.
export function isWhatsAppLink(href) {
  const h = String(href || "").trim();
  if (!h) return false;
  if (/^whatsapp:/i.test(h)) return true;
  try {
    const host = new URL(h, window.location.href).hostname.toLowerCase();
    return host === "wa.me" || host === "whatsapp.com" || host.endsWith(".whatsapp.com");
  } catch {
    return false;
  }
}

// Clic en un link de WhatsApp → "Contact". Va por el Pixel (si cargó) y por el servidor (API de
// conversiones) con el mismo eventID, así Meta lo cuenta una sola vez. Si el clic viene desde la
// ficha de un producto, lleva el producto en content_ids (mismo id que ViewContent y el feed).
// No manda datos personales: el servidor suma lo que corresponda, hasheado, si el cliente está
// logueado. Sigue las mismas reglas que el resto: nada con sesión de admin, nada sin Pixel
// configurado, y para mayoristas solo si el admin pidió incluirlos.
export function pixelContact({ href } = {}) {
  if (!state.configured || state.admin || !state.commerce) return;
  // Doble clic o dos handlers sobre el mismo link en menos de 1,5 s: una sola consulta.
  const now = Date.now();
  if (state.lastContact && state.lastContact.href === href && now - state.lastContact.at < 1500) return;
  state.lastContact = { href, at: now };

  // "wa-" + tiempo en base 36 + 12 caracteres al azar: único por clic y con un formato fijo que el
  // backend valida (isContactEventId). Mismo valor para el Pixel y para el servidor.
  let rnd = "";
  while (rnd.length < 12) rnd += Math.random().toString(36).slice(2);
  const eventId = `wa-${now.toString(36)}${rnd.slice(0, 12)}`;
  const product = state.currentProduct;
  const data = { contact_channel: "whatsapp" };
  if (product) {
    data.content_ids = [product.id];
    data.content_type = product.hasVariants ? "product_group" : "product";
    if (product.name) data.content_name = product.name;
  }
  fire("Contact", data, { eventID: eventId });

  // Servidor: mismo event_id. keepalive para que llegue aunque la pestaña cambie de página.
  try {
    const headers = { "Content-Type": "application/json" };
    try {
      const token = localStorage.getItem("customer_token");
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch { /* sin token */ }
    const body = {
      eventId,
      path: window.location.pathname + window.location.search,
      productId: product ? product.id : undefined,
      hasVariants: product ? product.hasVariants : undefined,
      ...(getMetaCookies() || {}),
    };
    fetch(`${API_URL}/api/events/contact`, { method: "POST", headers, body: JSON.stringify(body), keepalive: true })
      .catch(() => {});
  } catch { /* nada */ }
}

// Cookies que deja el Pixel: _fbp (este navegador) y _fbc (el click en un anuncio). El checkout
// las manda con el pedido para que el Purchase que envía el servidor se atribuya al anuncio.
// Si el visitante llegó con ?fbclid= en la URL y la cookie _fbc todavía no está, se arma igual
// que lo hace el Pixel: "fb.1.<timestamp>.<fbclid>".
export function getMetaCookies() {
  const out = {};
  try {
    const jar = {};
    document.cookie.split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) jar[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
    });
    if (jar._fbp) out.fbp = jar._fbp;
    if (jar._fbc) out.fbc = jar._fbc;
    if (!out.fbc) {
      const fbclid = new URLSearchParams(window.location.search).get("fbclid");
      if (fbclid && /^[A-Za-z0-9_-]{1,255}$/.test(fbclid)) out.fbc = `fb.1.${Date.now()}.${fbclid}`;
    }
  } catch { /* sin cookies */ }
  return Object.keys(out).length ? out : null;
}
