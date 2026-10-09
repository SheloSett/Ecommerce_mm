// Tests de la integración con Meta (Facebook / Instagram): el evento Purchase de la API de
// conversiones (services/meta.service.js) y el feed del catálogo (controllers/seo.controller.js).
// No llaman a Meta ni a la base: son funciones puras. Correr con: npm test

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test";
const { browserDataFromRequest, _internals: meta } = require("../src/services/meta.service");
const { _internals: feed } = require("../src/controllers/seo.controller");

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

describe("API de conversiones — Purchase", () => {
  const order = {
    id: 123,
    customerName: "  Juan Pérez Gómez ",
    customerEmail: "Juan@Gmail.com",
    customerPhone: "11 5039-5166",
    customerId: 7,
    customerType: "MINORISTA",
    total: 15000.5,
    totalUsd: null,
    metaBrowser: { fbp: "fb.1.1700000000000.123456", fbc: "fb.1.1700000000000.AbC_dEf", ip: "190.1.2.3", ua: "Mozilla/5.0" },
    items: [
      { productId: 10, variantId: null, quantity: 2, price: 5000, currency: "ARS" },
      { productId: 11, variantId: 44, quantity: 1, price: 5000.5, currency: "ARS" },
      { productId: null, variantId: null, quantity: 1, price: 999, currency: "ARS" }, // ítem libre: no va
    ],
  };

  test("arma el evento con los datos hasheados, las cookies y los ids del catálogo", () => {
    const payload = meta.buildPurchasePayload(order, { now: 1_700_000_000_000 });
    assert.equal(payload.data.length, 1);
    assert.equal(payload.test_event_code, undefined);
    const ev = payload.data[0];
    assert.equal(ev.event_name, "Purchase");
    assert.equal(ev.event_id, "order-123");
    assert.equal(ev.event_time, 1_700_000_000);
    assert.equal(ev.action_source, "website");
    // Datos personales: normalizados y hasheados, nunca en claro
    assert.deepEqual(ev.user_data.em, [sha("juan@gmail.com")]);
    assert.deepEqual(ev.user_data.ph, [sha("541150395166")]);
    assert.deepEqual(ev.user_data.fn, [sha("juan")]);
    assert.deepEqual(ev.user_data.ln, [sha("pérez gómez")]);
    assert.deepEqual(ev.user_data.external_id, [sha("7")]);
    assert.equal(JSON.stringify(ev).includes("Juan"), false);
    assert.equal(JSON.stringify(ev).includes("gmail"), false);
    // Lo que capturó el checkout
    assert.equal(ev.user_data.fbp, "fb.1.1700000000000.123456");
    assert.equal(ev.user_data.fbc, "fb.1.1700000000000.AbC_dEf");
    assert.equal(ev.user_data.client_ip_address, "190.1.2.3");
    assert.equal(ev.user_data.client_user_agent, "Mozilla/5.0");
    // Compra: moneda, total neto y los mismos ids que usa el feed
    assert.equal(ev.custom_data.currency, "ARS");
    assert.equal(ev.custom_data.value, 15000.5);
    assert.deepEqual(ev.custom_data.content_ids, ["10", "11-44"]);
    assert.equal(ev.custom_data.num_items, 3);
    assert.equal(ev.custom_data.order_id, "123");
    assert.equal(ev.custom_data.customer_type, "MINORISTA");
  });

  test("un pedido 100% en dólares sale en USD con sus ítems en dólares", () => {
    const usd = {
      ...order, total: 0, totalUsd: 80,
      items: [{ productId: 5, variantId: null, quantity: 2, price: 40, currency: "USD" }],
    };
    const ev = meta.buildPurchasePayload(usd).data[0];
    assert.equal(ev.custom_data.currency, "USD");
    assert.equal(ev.custom_data.value, 80);
    assert.deepEqual(ev.custom_data.content_ids, ["5"]);
  });

  test("un pedido mixto manda la parte en pesos y deja afuera los ítems en dólares", () => {
    const mixto = {
      ...order, total: 10000, totalUsd: 40,
      items: [
        { productId: 1, variantId: null, quantity: 1, price: 10000, currency: "ARS" },
        { productId: 2, variantId: null, quantity: 1, price: 40, currency: "USD" },
      ],
    };
    const ev = meta.buildPurchasePayload(mixto).data[0];
    assert.equal(ev.custom_data.currency, "ARS");
    assert.equal(ev.custom_data.value, 10000);
    assert.deepEqual(ev.custom_data.content_ids, ["1"]);
  });

  test("sin datos del navegador ni cliente registrado igual arma un evento válido", () => {
    const anon = { id: 9, customerName: "Ana", customerEmail: "ana@x.com", total: 100, items: [] };
    const ev = meta.buildPurchasePayload(anon, { testEventCode: "TEST123" }).data[0];
    assert.deepEqual(ev.user_data.fn, [sha("ana")]);
    assert.equal(ev.user_data.ln, undefined);
    assert.equal(ev.user_data.external_id, undefined);
    assert.equal(ev.user_data.fbp, undefined);
    assert.equal(ev.custom_data.num_items, 0);
    assert.equal(meta.buildPurchasePayload(anon, { testEventCode: "TEST123" }).test_event_code, "TEST123");
  });

  test("el teléfono se normaliza con código de país y sin ceros a la izquierda", () => {
    assert.equal(meta.hashPhone("011 5039 5166"), sha("541150395166"));
    assert.equal(meta.hashPhone("+54 9 11 5039-5166"), sha("5491150395166"));
    assert.equal(meta.hashPhone(""), null);
    assert.equal(meta.hashEmail("  "), null);
  });
});

describe("Datos del navegador que guarda el checkout", () => {
  const req = { ip: "10.0.0.1", headers: { "user-agent": "UA/1.0" } };

  test("acepta solo cookies con el formato de Meta y suma IP y navegador", () => {
    const out = browserDataFromRequest(req, { fbp: "fb.1.1700000000000.42", fbc: "fb.1.1700000000000.IwAR_x-1" });
    assert.deepEqual(out, { fbp: "fb.1.1700000000000.42", fbc: "fb.1.1700000000000.IwAR_x-1", ip: "10.0.0.1", ua: "UA/1.0" });
  });

  test("descarta cookies inventadas y devuelve null si no hay nada que guardar", () => {
    const out = browserDataFromRequest(req, { fbp: "<script>", fbc: "x".repeat(400) });
    assert.deepEqual(out, { ip: "10.0.0.1", ua: "UA/1.0" });
    assert.equal(browserDataFromRequest({ headers: {} }, null), null);
  });
});

describe("Feed del catálogo", () => {
  const base = {
    id: 20, name: "Cable USB-C", slug: "cable-usb-c", description: "<p>Cable <b>reforzado</b></p>",
    price: 1000, salePrice: 800, currency: "ARS", stock: 3, stockUnlimited: false, sku: "CAB-1",
    images: ["https://img/1.webp", "https://img/2.webp"], categories: [{ name: "Cables", parent: { name: "Accesorios" } }],
    variants: [],
  };

  test("producto sin variantes: un ítem con precio, oferta, stock, foto y rubro", () => {
    const [it] = feed.feedItemsForProduct(base);
    assert.equal(it.id, "20");
    assert.equal(it.itemGroupId, null);
    assert.equal(it.title, "Cable USB-C");
    assert.equal(it.description, "Cable reforzado");
    // El dominio sale de FRONTEND_URL (localhost en desarrollo): se chequea solo la ruta
    assert.match(it.link, /^https?:\/\/[^/]+\/producto\/cable-usb-c$/);
    assert.equal(it.price, 1000);
    assert.equal(it.salePrice, 800);
    assert.equal(it.inStock, true);
    assert.equal(it.image, "https://img/1.webp");
    assert.deepEqual(it.extraImages, ["https://img/2.webp"]);
    assert.equal(it.productType, "Accesorios > Cables");
    const xml = feed.feedItemXml(it);
    assert.match(xml, /<g:price>1000\.00 ARS<\/g:price>/);
    assert.match(xml, /<g:sale_price>800\.00 ARS<\/g:sale_price>/);
    assert.match(xml, /<g:availability>in stock<\/g:availability>/);
    assert.match(xml, /<g:product_type>Accesorios &gt; Cables<\/g:product_type>/);
  });

  test("producto en dólares sale en USD (antes salía como pesos)", () => {
    const xml = feed.feedItemXml(feed.feedItemsForProduct({ ...base, currency: "USD", price: 25, salePrice: null })[0]);
    assert.match(xml, /<g:price>25\.00 USD<\/g:price>/);
    assert.doesNotMatch(xml, /sale_price/);
  });

  test("producto con variantes: un ítem por variante, agrupados, con precio y stock propios", () => {
    const p = {
      ...base, stock: 0, salePrice: null,
      variants: [
        { id: 1, combination: [{ name: "Color", value: "Negro" }, { name: "Largo", value: "1 m" }], price: null, salePrice: null, stock: 5, stockUnlimited: false, images: ["https://img/negro.webp"], sku: "CAB-1-N" },
        { id: 2, combination: [{ name: "Color", value: "Blanco" }, { name: "Largo", value: "1 m" }], price: 1200, salePrice: 900, stock: 0, stockUnlimited: false, images: [], sku: null },
      ],
    };
    const items = feed.feedItemsForProduct(p);
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((i) => i.id), ["20-1", "20-2"]);
    assert.deepEqual(items.map((i) => i.itemGroupId), ["20", "20"]);
    assert.equal(items[0].title, "Cable USB-C - Negro / 1 m");
    assert.equal(items[0].price, 1000);           // hereda la base del producto
    assert.equal(items[0].salePrice, null);       // la oferta del producto NO se hereda
    assert.equal(items[0].inStock, true);         // el stock es el de la variante, no el del producto (0)
    assert.equal(items[0].image, "https://img/negro.webp");
    assert.equal(items[0].mpn, "CAB-1-N");
    assert.equal(items[1].price, 1200);
    assert.equal(items[1].salePrice, 900);
    assert.equal(items[1].inStock, false);
    assert.equal(items[1].image, "https://img/1.webp"); // sin foto propia: la del producto
    assert.equal(items[1].mpn, "CAB-1");
    assert.match(feed.feedItemXml(items[0]), /<g:item_group_id>20<\/g:item_group_id>/);
  });

  test("sin precio válido no sale (Meta rechaza precio 0)", () => {
    assert.deepEqual(feed.feedItemsForProduct({ ...base, price: 0 }), []);
    assert.deepEqual(feed.feedItemsForProduct({ ...base, price: 0, variants: [{ id: 1, combination: [], price: null, stock: 1, images: [] }] }), []);
  });
});
