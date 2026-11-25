// WhatsApp de avisos por Evolution (25/11/2026): números, textos de pedidos y de campañas, y a quién le llega.
// Datos inventados.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { toWhatsappNumber, phoneDisplay, newOrderText, customerStatusText, sendWhatsapp } = require("../src/services/whatsapp.service");
const { pickWhatsappRecipients, argentinaHour } = require("../src/services/broadcast.service");
const { whatsappPromoText, whatsappOfferText } = require("../src/services/broadcast.templates");
const { promoForCustomer } = require("../src/utils/cartPromo");

describe("números de WhatsApp (como en Shiraf)", () => {
  test("los formatos en que la gente carga un celular", () => {
    assert.equal(toWhatsappNumber("11 5039-5166"), "5491150395166");
    assert.equal(toWhatsappNumber("+54 9 11 5039-5166"), "5491150395166");
    assert.equal(toWhatsappNumber("54 11 5039 5166"), "5491150395166", "con país, sin el 9");
    assert.equal(toWhatsappNumber("011 15 5039 5166"), "5491150395166", "el 0 y el 15 no viajan");
    assert.equal(toWhatsappNumber("15 3385 2327"), "5491133852327", "el 15 pelado de Buenos Aires es del 11");
    assert.equal(toWhatsappNumber("341 555 1234"), "5493415551234", "diez dígitos completos: no se recorta ningún 15");
  });
  test("lo que no es un celular da null", () => {
    for (const raw of [null, "", "abc", "4555-1234", "123"]) assert.equal(toWhatsappNumber(raw), null, String(raw));
  });
  test("para mostrar", () => {
    assert.equal(phoneDisplay("1150395166"), "11 5039-5166");
    assert.equal(phoneDisplay("5493415551234"), "3415551234");
  });
});

describe("avisos de pedidos", () => {
  const order = {
    id: 1234, customerName: "Ana Pérez", customerType: "MAYORISTA", total: 150000, totalUsd: null,
    paymentMethod: "TRANSFERENCIA", shippingMethod: "MOTO", items: [{ quantity: 2 }, { quantity: 1 }],
  };

  test("pedido nuevo a la tienda: quién, total, método, productos y link al panel", () => {
    const t = newOrderText(order, { frontendUrl: "https://tienda.test" });
    assert.match(t, /^🛒 Pedido nuevo #1234/);
    assert.match(t, /Ana Pérez · mayorista/);
    assert.match(t, /Total: \$ 150\.000 · Transferencia/);
    assert.match(t, /3 productos · Moto/);
    assert.match(t, /https:\/\/tienda\.test\/admin\/ordenes\/1234$/);
    assert.match(newOrderText({ ...order, totalUsd: 25 }, { frontendUrl: "x" }), /\$ 150\.000 \+ USD 25/);
  });

  test("al cliente: pago aprobado y despachado, con la firma del número de la tienda", () => {
    const ok = customerStatusText(order, { kind: "payment", status: "APPROVED" }, { storePhone: "1150395166" });
    assert.match(ok, /^Hola Ana! 👋/);
    assert.match(ok, /Confirmamos el pago de tu pedido #1234/);
    assert.match(ok, /escribinos al 11 5039-5166\.$/);
    assert.match(customerStatusText(order, { kind: "fulfillment", status: "ENVIADO" }, { storePhone: "1150395166" }), /salió en moto/);
    const retiro = customerStatusText({ ...order, shippingMethod: "RETIRO" }, { kind: "fulfillment", status: "ENVIADO" }, { storePhone: "1150395166" });
    assert.match(retiro, /listo para retirar/);
    const correo = customerStatusText({ ...order, shippingMethod: "CORREO_ARGENTINO", trackingNumber: "AB123" }, { kind: "fulfillment", status: "ENVIADO" }, { storePhone: "1" });
    assert.match(correo, /seguimiento: AB123/);
  });

  test("los demás cambios no se avisan por WhatsApp (los manda el email)", () => {
    for (const change of [{ kind: "payment", status: "REJECTED" }, { kind: "fulfillment", status: "EN_PREPARACION" }, { kind: "fulfillment", status: "ENTREGADO" }]) {
      assert.equal(customerStatusText(order, change, { storePhone: "1" }), null, JSON.stringify(change));
    }
  });

  test("sin Evolution configurado no manda ni tira error", async () => {
    const before = { ...process.env };
    delete process.env.EVOLUTION_URL;
    const r = await sendWhatsapp({ to: "1150395166", text: "hola" });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /no está configurado/);
    Object.assign(process.env, before);
  });
});

describe("campañas por WhatsApp", () => {
  const ctx = { storeName: "Tienda", frontendUrl: "https://tienda.test", unsubscribeUrl: "https://tienda.test/baja", storePhone: "11 5039-5166" };
  const promo = {
    id: 7, name: "Black Friday", appliesTo: "AMBOS", endsAt: "2026-11-28T02:59:00Z", description: "", scopeLabel: null,
    tiers: [{ minAmount: 100000, percent: 5 }, { minAmount: 300000, percent: 10 }],
    wholesaleTiers: [{ minAmount: 150000, percent: 5 }, { minAmount: 500000, percent: 18 }],
  };

  test("promo: cada uno con sus escalones, link de baja y aclaración del número", () => {
    const min = whatsappPromoText(promoForCustomer(promo, "MINORISTA"), { name: "Ana", type: "MINORISTA" }, ctx);
    assert.match(min, /^Hola Ana! 👋/);
    assert.match(min, /Arrancó \*Black Friday\* en Tienda: hasta 10% de descuento sobre el total de tu compra/);
    assert.match(min, /• A partir de \$ 100\.000: 5% de descuento/);
    assert.match(min, /Si no querés recibir más promos: https:\/\/tienda\.test\/baja/);
    assert.match(min, /escribinos al 11 5039-5166\.$/);
    const may = whatsappPromoText(promoForCustomer(promo, "MAYORISTA"), { name: "Beto", type: "MAYORISTA" }, ctx);
    assert.match(may, /^\*EXCLUSIVO PARA MAYORISTAS\*/);
    assert.match(may, /• A partir de \$ 500\.000: 18% de descuento/);
  });

  test("campaña de ofertas: con su link al catálogo filtrado", () => {
    const offer = { id: 9, name: "Hot Sale", discountType: "PERCENTAGE", discountValue: 20, endsAt: null, items: [], description: "" };
    const t = whatsappOfferText(offer, "retail", { name: "Ana", type: "MINORISTA" }, ctx);
    assert.match(t, /Arrancó \*Hot Sale\* en Tienda/);
    assert.match(t, /https:\/\/tienda\.test\/catalogo\?offerId=9/);
  });

  test("a quién le llega: con celular válido, sin baja ni rechazados, sin repetir número, según el público", () => {
    const c = (id, extra) => ({ id, name: `C${id}`, email: `c${id}@x.test`, phone: "11 5000-000" + id, type: "MINORISTA", status: "APPROVED", unsubscribeMarketing: false, ...extra });
    const customers = [
      c(1), c(2, { phone: "" }), c(3, { unsubscribeMarketing: true }), c(4, { status: "REJECTED" }),
      c(5, { type: "MAYORISTA" }), c(6, { type: "MAYORISTA", status: "PENDING" }), c(7, { phone: "+54 9 11 5000-0001" }),
    ];
    const ids = (list) => list.map((r) => r.customerId);
    assert.deepEqual(ids(pickWhatsappRecipients(customers, "ALL")), [1, 5, 6], "el 7 tiene el mismo número que el 1");
    assert.deepEqual(ids(pickWhatsappRecipients(customers, "MAYORISTA")), [5], "un mayorista pendiente recibe la versión minorista");
    assert.deepEqual(ids(pickWhatsappRecipients(customers, "MINORISTA")), [1, 6]);
    assert.equal(pickWhatsappRecipients(customers, "ALL")[0].phone, "5491150000001");
  });

  test("horario de envío: hora argentina", () => {
    assert.equal(argentinaHour(new Date("2026-11-25T12:00:00Z")), 9);
    assert.equal(argentinaHour(new Date("2026-11-26T02:30:00Z")), 23);
  });
});

// Carrito abandonado y restock por WhatsApp (25/11/2026)
describe("recordatorios por WhatsApp", () => {
  const { abandonedCartText, restockText } = require("../src/services/whatsapp.service");
  const { renderWhatsapp } = require("../src/services/broadcast.service");
  const ctx = { frontendUrl: "https://tienda.test", unsubscribeUrl: "https://tienda.test/baja", storePhone: "1150395166" };

  test("carrito: los productos (hasta 4 y 'y N más'), el link al carrito, la baja y la firma", () => {
    const items = ["A", "B", "C", "D", "E", "F"].map((n, i) => ({ name: `PRODUCTO ${n}`, variantLabel: i === 0 ? "Rojo" : null, quantity: i === 1 ? 3 : 1 }));
    const t = abandonedCartText({ name: "Ana Pérez" }, items, ctx);
    assert.match(t, /^Hola Ana! 👋/);
    assert.match(t, /• PRODUCTO A \(Rojo\)\n• PRODUCTO B x3\n• PRODUCTO C\n• PRODUCTO D\n• y 2 más/);
    assert.match(t, /Lo terminás acá: https:\/\/tienda\.test\/carrito/);
    assert.match(t, /Si no querés recibir más recordatorios: https:\/\/tienda\.test\/baja/);
    assert.match(t, /escribinos al 11 5039-5166\.$/);
  });

  test("restock: el recordatorio al mayorista con el link al catálogo", () => {
    const t = restockText({ name: "Beto" }, ctx);
    assert.match(t, /^Hola Beto! 👋/);
    assert.match(t, /¿Reponemos\?/);
    assert.match(t, /https:\/\/tienda\.test\/catalogo/);
  });

  test("la cola manda el texto armado tal cual (WA_TEXT)", async () => {
    assert.equal(await renderWhatsapp({ kind: "WA_TEXT" }, { message: "hola tal cual" }), "hola tal cual");
  });
});

describe("recordatorio de carrito manual (Clientes → Carritos)", () => {
  const { abandonedCartText } = require("../src/services/whatsapp.service");
  test("con cupón lo nombra; sin cupón no deja renglones vacíos", () => {
    const ctx = { frontendUrl: "https://t.test", storePhone: "1150395166" };
    const con = abandonedCartText({ name: "Ana" }, [{ name: "X", quantity: 1 }], { ...ctx, couponCode: "CART-1-AB", couponDescription: "10% de descuento" });
    assert.match(con, /🎁 Usá el cupón \*CART-1-AB\* \(10% de descuento\) al pagar\./);
    const sin = abandonedCartText({ name: "Ana" }, [{ name: "X", quantity: 1 }], ctx);
    assert.doesNotMatch(sin, /cupón|\n\n\n/);
  });
});
