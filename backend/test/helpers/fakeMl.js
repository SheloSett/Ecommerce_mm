// Mercado Libre simulado para los tests de la sincronización: hace de fetch (fetchImpl) y atiende lo
// que usa la tienda (usuarios, publicaciones, stock, búsqueda, tokens).
//
// Modelo: cada user product (UP) tiene un stock que comparten sus publicaciones; cada publicación
// tiene su contador de vendidos. Una venta baja el stock del UP y sube los vendidos de la publicación;
// una escritura (PUT /items) cambia el stock del UP y no toca los vendidos.
//
// Para los casos difíciles:
//   ml.onPut(fn)            corre fn justo ANTES de aplicar la próxima escritura (una venta que entra
//                           entre la lectura y la escritura: la escritura la pisa)
//   ml.afterPut(fn)         corre fn justo DESPUÉS de aplicarla (una venta que no se pisa)
//   ml.failNextPut(mode)    "timeout-before" (no entra y no hay respuesta), "timeout-after" (entra y no
//                           hay respuesta), 429, 500, 400
//   ml.storeOnPut(n)        la próxima escritura guarda n en vez de lo pedido (tope de la publicación)
//   ml.staleReads(itemId,k) las próximas k lecturas de esa publicación devuelven lo de antes del último cambio
//   ml.failReads(kind, k)   las próximas k lecturas fallan (429, 500, "timeout")

function timeoutError() {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

function response(status, body, headers = {}) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const h = new Map(Object.entries({ "content-type": "application/json", ...headers }).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null }, text: async () => text };
}

class FakeMl {
  constructor({ userId = "123456789", appId = "1234567890", clientSecret = "secreto-app" } = {}) {
    this.userId = userId;
    this.appId = appId;
    this.clientSecret = clientSecret;
    this.ups = new Map();     // upId -> { qty, history: [qty...] }
    this.items = new Map();   // itemId -> { id, seller_id, status, user_product_id, sold_quantity, title, sku, variations? }
    this.calls = [];          // { method, path, body }
    this.puts = [];           // { itemId, body }
    this.hooks = { onPut: [], afterPut: [] };
    this.putFailure = null;
    this.putStore = null;
    this.stale = new Map();   // itemId -> { left, snapshot }
    this.readFailures = [];   // kinds
    // OAuth
    this.codes = new Map();   // code -> { verifier }
    this.validRefresh = null;
    this.tokenSeq = 0;
    this.validAccess = new Set();
    this.revoked = false;
    this.fetch = this.fetch.bind(this);
  }

  // ─── Armado ────────────────────────────────────────────────────────────────
  addUp(upId, qty) {
    this.ups.set(upId, { qty });
    return this;
  }
  addItem(itemId, { up, sold = 0, status = "active", seller = this.userId, title = `Publicación ${itemId}`, sku = null, variations = null } = {}) {
    this.items.set(itemId, { id: itemId, seller_id: Number(seller), status, user_product_id: up, sold_quantity: sold, title, sku, variations });
    return this;
  }
  issueTokens() {
    this.tokenSeq++;
    const access = `APP_USR-acceso-${this.tokenSeq}-xxxxxxxx`;
    const refresh = `TG-renovar-${this.tokenSeq}-xxxxxxxx`;
    this.validAccess.add(access);
    this.validRefresh = refresh;
    return { access, refresh };
  }

  // ─── Lo que pasa en Mercado Libre ─────────────────────────────────────────
  qty(upId) {
    return this.ups.get(upId).qty;
  }
  sell(itemId, n = 1) {
    const item = this.items.get(itemId);
    const up = this.ups.get(item.user_product_id);
    this.snapshot(itemId);
    up.qty -= n;
    item.sold_quantity += n;
  }
  setQty(upId, n) {
    for (const [id, item] of this.items) if (item.user_product_id === upId) this.snapshot(id);
    this.ups.get(upId).qty = n;
  }
  snapshot(itemId) {
    const s = this.stale.get(itemId);
    if (s && s.left > 0 && !s.snapshot) s.snapshot = this.itemJson(itemId);
  }

  // ─── Fallas y momentos ────────────────────────────────────────────────────
  onPut(fn) { this.hooks.onPut.push(fn); return this; }
  afterPut(fn) { this.hooks.afterPut.push(fn); return this; }
  failNextPut(mode) { this.putFailure = mode; return this; }
  storeOnPut(n) { this.putStore = n; return this; }
  staleReads(itemId, k) { this.stale.set(itemId, { left: k, snapshot: this.itemJson(itemId) }); return this; }
  failReads(kind, k = 1) { for (let i = 0; i < k; i++) this.readFailures.push(kind); return this; }

  itemJson(itemId) {
    const item = this.items.get(itemId);
    if (!item) return null;
    const json = {
      id: item.id, seller_id: item.seller_id, status: item.status, title: item.title,
      user_product_id: item.user_product_id,
      available_quantity: item.user_product_id && this.ups.has(item.user_product_id) ? this.ups.get(item.user_product_id).qty : 0,
      sold_quantity: item.sold_quantity,
      permalink: `https://articulo.mercadolibre.com.ar/${item.id}`,
      secure_thumbnail: `https://http2.mlstatic.com/D_${item.id}.jpg`,
      seller_custom_field: item.sku,
    };
    if (item.variations) json.variations = item.variations.map((v) => ({ ...v }));
    return json;
  }

  // ─── fetch ────────────────────────────────────────────────────────────────
  async fetch(url, init = {}) {
    const u = new URL(url);
    if (u.origin !== "https://api.mercadolibre.com") throw new Error(`fetch a un host inesperado: ${u.origin}`);
    const method = init.method || "GET";
    const body = init.body;
    this.calls.push({ method, path: u.pathname + u.search, body });
    const auth = init.headers?.Authorization || "";

    if (u.pathname === "/oauth/token" && method === "POST") return this.oauth(new URLSearchParams(body));
    const token = auth.replace(/^Bearer /, "");
    if (!this.validAccess.has(token)) return response(401, { message: "invalid_token", error: "not_found", status: 401 });

    if (u.pathname === "/users/me") return response(200, { id: Number(this.userId), nickname: "TIENDA_PRUEBA" });

    let m;
    if ((m = u.pathname.match(/^\/users\/(\d+)\/items\/search$/))) {
      const status = u.searchParams.get("status");
      const ids = [...this.items.values()].filter((i) => i.status === status && String(i.seller_id) === m[1]).map((i) => i.id);
      const offset = parseInt(u.searchParams.get("offset") || "0", 10);
      return response(200, { results: ids.slice(offset, offset + 100), paging: { total: ids.length, offset, limit: 100 } });
    }

    if ((m = u.pathname.match(/^\/items\/(MLA\d+)$/))) {
      const itemId = m[1];
      if (method === "GET") {
        const fail = this.readFailures.shift();
        if (fail === "timeout") throw timeoutError();
        if (fail) return response(fail, { message: `falla ${fail}` }, fail === 429 ? { "retry-after": "30" } : {});
        if (!this.items.has(itemId)) return response(404, { message: "item not found" });
        const s = this.stale.get(itemId);
        if (s && s.left > 0) { s.left--; return response(200, s.snapshot); }
        return response(200, this.itemJson(itemId));
      }
      if (method === "PUT") return this.put(itemId, JSON.parse(body));
    }
    return response(404, { message: `ruta simulada desconocida ${method} ${u.pathname}` });
  }

  async put(itemId, payload) {
    const item = this.items.get(itemId);
    if (!item) return response(404, { message: "item not found" });
    const failure = this.putFailure;
    this.putFailure = null;
    if (failure === 429) return response(429, { message: "too many requests" });
    if (failure === 500) return response(500, { message: "internal error" });
    if (failure === 400) return response(400, { message: "Validation error", cause: [{ type: "error", message: "item.available_quantity.invalid" }] });
    if (failure === "timeout-before") throw timeoutError();

    for (const fn of this.hooks.onPut.splice(0)) fn();
    const wanted = payload.available_quantity;
    const stored = this.putStore ?? wanted;
    this.putStore = null;
    for (const [id, other] of this.items) if (other.user_product_id === item.user_product_id) this.snapshot(id);
    this.ups.get(item.user_product_id).qty = stored;
    this.puts.push({ itemId, wanted, stored });
    for (const fn of this.hooks.afterPut.splice(0)) fn();

    if (failure === "timeout-after") throw timeoutError();
    return response(200, this.itemJson(itemId));
  }

  oauth(form) {
    if (form.get("client_id") !== this.appId || form.get("client_secret") !== this.clientSecret) {
      return response(400, { error: "invalid_client", message: "invalid client" });
    }
    if (form.get("grant_type") === "authorization_code") {
      const code = form.get("code");
      const entry = this.codes.get(code);
      if (!entry) return response(400, { error: "invalid_grant", message: "bad code" });
      this.codes.delete(code);
      if (entry.challenge) {
        const crypto = require("crypto");
        const verifier = form.get("code_verifier") || "";
        if (crypto.createHash("sha256").update(verifier).digest("base64url") !== entry.challenge) {
          return response(400, { error: "invalid_grant", message: "bad verifier" });
        }
      }
      const { access, refresh } = this.issueTokens();
      return response(200, { access_token: access, token_type: "bearer", expires_in: 21600, scope: "offline_access read write", user_id: Number(entry.userId || this.userId), refresh_token: refresh });
    }
    if (form.get("grant_type") === "refresh_token") {
      if (this.revoked || form.get("refresh_token") !== this.validRefresh) {
        return response(400, { error: "invalid_grant", message: "Error validating grant", status: 400, cause: [] });
      }
      const { access, refresh } = this.issueTokens();
      return response(200, { access_token: access, token_type: "bearer", expires_in: 21600, scope: "offline_access read write", user_id: Number(this.userId), refresh_token: refresh });
    }
    return response(400, { error: "unsupported_grant_type" });
  }
}

module.exports = { FakeMl, response };
