// Tests de los envíos a domicilio: zona y precio de la moto según el CP, el cruce entre CP, provincia y
// localidad, el día de entrega según la hora, y lo que le queda al pedido (total, Mercado Pago, ganancia).
// Base simulada. Correr con: npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-prueba";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  DEFAULT_MOTO_CONFIG: config, quoteMoto, deliveryPromise, parsePostalCode, parseZoneAreas, validateMotoConfig,
  sanitizeShippingAddress, shippingAddressLines, formatDeliveryDate,
} = require("../src/utils/motoShipping");
const { computeOrderTotals } = require("../src/utils/orderTotals");

// Hora argentina (UTC-3). Lunes 2/11/2026 a las 10:00.
const LUNES_10 = new Date("2026-11-02T13:00:00.000Z");
const quote = (postalCode, provinceCode, city) => quoteMoto(config, { postalCode, provinceCode, city }, LUNES_10);

describe("zona y precio según el código postal", () => {
  test("los cuatro precios", () => {
    assert.deepEqual([quote("1425", "C").price, quote("1708", "B").price, quote("1878", "B").price, quote("1629", "B").price], [4500, 6200, 7800, 9200]);
    assert.deepEqual([quote("1425", "C").zoneName, quote("1708", "B").zoneName, quote("1878", "B").zoneName, quote("1629", "B").zoneName], ["CABA", "Zona 1", "Zona 2", "Zona 3"]);
  });

  test("también entiende el CP de 8 caracteres", () => {
    assert.equal(quote("C1425ABC", "C").zoneName, "CABA");
    assert.deepEqual(parsePostalCode("b1708xyz"), { cp: 1708, text: "1708", letter: "B" });
  });

  test("donde la moto no llega, lo dice y no cotiza", () => {
    const r = quote("7600", "B"); // Mar del Plata
    assert.equal(r.available, false);
    assert.equal(r.code, "OUT_OF_AREA");
    assert.match(r.message, /no llega/);
  });

  test("otra provincia: solo CABA y Gran Buenos Aires", () => {
    assert.equal(quote("5000", "X").code, "OUT_OF_AREA");
  });

  test("un CP mal escrito pide corregirlo", () => {
    assert.equal(quote("14", "C").code, "INVALID_CP");
  });

  test("apagado desde el panel, no cotiza", () => {
    assert.equal(quoteMoto({ ...config, enabled: false }, { postalCode: "1425", provinceCode: "C" }).code, "DISABLED");
  });
});

// Una localidad por cada partido y cada lugar del mapa de zonas de la mensajería.
describe("zonas del mapa de la mensajería", () => {
  const MAPA = {
    "Zona 1": {
      price: 6200,
      places: [["1646", "San Fernando"], ["1642", "San Isidro"], ["1650", "San Martín"], ["1638", "Vicente López"], ["1686", "Hurlingham"],
        ["1714", "Ituzaingó"], ["1678", "Caseros"], ["1708", "Morón"], ["1704", "Ramos Mejía"], ["1754", "San Justo"], ["1870", "Avellaneda"],
        ["1824", "Lanús"], ["1832", "Lomas de Zamora"]],
    },
    "Zona 2": {
      price: 7800,
      places: [["1613", "Los Polvorines"], ["1648", "Tigre"], ["1665", "José C. Paz"], ["1663", "San Miguel"], ["1744", "Moreno"], ["1722", "Merlo"],
        ["1759", "González Catán"], ["1763", "Virrey del Pino"], ["1878", "Quilmes"], ["1884", "Berazategui"], ["1804", "Ezeiza"],
        ["1846", "Adrogué"], ["1842", "Monte Grande"], ["1888", "Florencio Varela"]],
    },
    "Zona 3": {
      price: 9200,
      places: [["1669", "Del Viso"], ["1635", "Derqui"], ["1625", "Escobar"], ["1862", "Guernica"], ["1623", "Maschwitz"], ["1670", "Nordelta"],
        ["1619", "Garín"], ["1629", "Pilar"], ["1631", "Villa Rosa"], ["1865", "San Vicente"], ["1748", "General Rodríguez"], ["1814", "Cañuelas"],
        ["1900", "La Plata"], ["1923", "Berisso"], ["1925", "Ensenada"], ["6700", "Luján"], ["1727", "Marcos Paz"], ["2804", "Campana"], ["2800", "Zárate"]],
    },
  };
  for (const [zone, { price, places }] of Object.entries(MAPA)) {
    test(`${zone}: ${places.map((p) => p[1]).join(", ")}`, () => {
      for (const [cp, city] of places) {
        const r = quote(cp, "B", city);
        assert.equal(r.zoneName, zone, `${city} (${cp})`);
        assert.equal(r.price, price, `${city} (${cp})`);
        assert.equal(r.reviewCity, false, `${city} (${cp}) tiene que figurar como localidad`);
      }
    });
  }

  test("CABA va aparte, con su precio", () => {
    assert.deepEqual([quote("1214", "C", "Almagro").zoneName, quote("1214", "C", "Almagro").price], ["CABA", 4500]);
  });

  test("Nordelta con el CP de Benavídez frena: son zonas distintas", () => {
    assert.equal(quote("1621", "B", "Nordelta").code, "CITY_CONFLICT");
  });
});

describe("el CP, la provincia y la localidad tienen que cerrar", () => {
  test("CP de CABA con provincia Buenos Aires, y al revés", () => {
    assert.equal(quote("1425", "B").code, "PROVINCE");
    assert.equal(quote("1708", "C").code, "PROVINCE");
  });

  test("la letra del CP largo tiene que ser la de la provincia", () => {
    assert.equal(quote("X1708ABC", "B").code, "PROVINCE");
  });

  test("localidad de otra zona frena: el precio saldría mal", () => {
    const r = quote("1425", "C", "Pilar");
    assert.equal(r.code, "CITY_CONFLICT");
    assert.match(r.message, /Zona 3/);
    assert.equal(quote("1708", "B", "Pilar").code, "CITY_CONFLICT");
  });

  test("sin acentos ni mayúsculas también la reconoce", () => {
    assert.equal(quote("1640", "B", "MARTINEZ").available, true);
    assert.equal(quote("1640", "B", "MARTINEZ").reviewCity, false);
    assert.equal(quote("1425", "C", "pilar").code, "CITY_CONFLICT");
  });

  test("otra localidad de la misma zona no frena (el precio es el mismo)", () => {
    const r = quote("1708", "B", "Haedo");
    assert.equal(r.available, true);
    assert.equal(r.reviewCity, false);
  });

  test("localidad desconocida: cotiza por el CP y queda marcada para revisar", () => {
    const r = quote("1708", "B", "Barrio Parque Inventado");
    assert.equal(r.available, true);
    assert.equal(r.reviewCity, true);
  });

  test("en CABA se escribe el barrio: no se marca", () => {
    const r = quote("1214", "C", "Almagro");
    assert.equal(r.available, true);
    assert.equal(r.reviewCity, false);
  });
});

describe("día de entrega según la hora", () => {
  const at = (iso, cfg = config) => deliveryPromise(cfg, new Date(iso));

  test("antes de la hora de corte: hoy", () => {
    const d = at("2026-11-02T13:00:00.000Z"); // lunes 10:00
    assert.deepEqual([d.label, d.date, d.sameDay], ["hoy", "2026-11-02", true]);
  });

  test("la hora de corte (13:30) cuenta los minutos: 13:29 todavía es hoy, 13:30 ya es mañana", () => {
    assert.equal(config.cutoffTime, "13:30");
    assert.deepEqual([at("2026-11-02T16:29:00.000Z").label, at("2026-11-02T16:29:00.000Z").sameDay], ["hoy", true]);
    const d = at("2026-11-02T16:30:00.000Z");
    assert.deepEqual([d.label, d.date, d.sameDay], ["mañana", "2026-11-03", false]);
    assert.equal(at("2026-11-02T17:00:00.000Z").label, "mañana"); // 14:00
  });

  test("la hora de corte se puede cambiar", () => {
    const cfg = { ...config, cutoffTime: "16:15" };
    assert.equal(at("2026-11-02T19:14:00.000Z", cfg).label, "hoy");
    assert.equal(at("2026-11-02T19:15:00.000Z", cfg).label, "mañana");
  });

  test("usa la hora argentina, no la del servidor: 22:00 del lunes sigue siendo lunes", () => {
    assert.equal(at("2026-11-03T01:00:00.000Z").date, "2026-11-03"); // lunes 22:00 → martes
    assert.equal(at("2026-11-03T02:59:00.000Z").label, "mañana");    // lunes 23:59 → martes
  });

  test("el reparto normal es de lunes a viernes", () => {
    assert.deepEqual(config.workDays, [1, 2, 3, 4, 5]);
    assert.equal(at("2026-11-06T13:00:00.000Z").label, "hoy"); // viernes 10:00
  });

  test("viernes desde la hora de corte: el lunes (el sábado no se le promete al cliente)", () => {
    const d = at("2026-11-06T16:30:00.000Z"); // viernes 13:30
    assert.deepEqual([d.label, d.date, d.sameDay], ["el lunes 9/11", "2026-11-09", false]);
    assert.equal(at("2026-11-06T16:29:00.000Z").label, "hoy"); // viernes 13:29
  });

  test("pedido hecho el sábado, a cualquier hora, o el domingo: el lunes", () => {
    const sabadoManiana = at("2026-11-07T13:00:00.000Z"); // antes de la hora de corte
    assert.deepEqual([sabadoManiana.date, sabadoManiana.label], ["2026-11-09", "el lunes 9/11"]);
    assert.equal(at("2026-11-07T20:00:00.000Z").date, "2026-11-09");
    const domingo = at("2026-11-08T13:00:00.000Z");
    assert.deepEqual([domingo.date, domingo.label], ["2026-11-09", "mañana"]);
  });

  test("si el viernes es feriado, jueves tarde pasa al lunes", () => {
    assert.equal(at("2026-11-05T17:00:00.000Z", { ...config, closedDates: ["2026-11-06"] }).date, "2026-11-09");
  });

  test("feriado: salta al próximo día de reparto", () => {
    const cfg = { ...config, closedDates: ["2026-11-02"] };
    assert.equal(at("2026-11-02T13:00:00.000Z", cfg).date, "2026-11-03");
  });

  test("sin ningún día de reparto: no se ofrece", () => {
    const cfg = { ...config, workDays: [] };
    assert.equal(deliveryPromise(cfg, LUNES_10), null);
    assert.equal(quoteMoto(cfg, { postalCode: "1425", provinceCode: "C" }, LUNES_10).code, "NO_DELIVERY_DAY");
  });

  test("formato para mails y pantallas", () => {
    assert.equal(formatDeliveryDate("2026-11-02"), "lunes 2/11");
    assert.equal(formatDeliveryDate(null), "");
  });
});

describe("lo que se guarda desde el panel", () => {
  const base = { enabled: true, cutoffTime: "13:30", workDays: [1, 2], closedDates: [], zones: [{ id: "a", name: "A", price: 100, postalCodes: "1602 Florida" }] };

  test("una configuración válida pasa", () => {
    assert.equal(validateMotoConfig(base).error, undefined);
  });

  test("un precio vacío se rechaza: no es envío gratis", () => {
    const con = (price) => validateMotoConfig({ ...base, zones: [{ ...base.zones[0], price }] });
    for (const vacio of ["", "  ", null, undefined]) assert.match(con(vacio).error, /Precio inválido/);
    assert.equal(con(0).config.zones[0].price, 0); // gratis solo si se escribe 0
  });

  test("la configuración de partida es válida (ningún CP en dos zonas)", () => {
    assert.equal(validateMotoConfig(config).error, undefined);
  });

  test("un CP en dos zonas se rechaza: el precio sería ambiguo", () => {
    const r = validateMotoConfig({ ...base, zones: [...base.zones, { id: "b", name: "B", price: 200, postalCodes: "1600-1610 Rango" }] });
    assert.match(r.error, /1602/);
  });

  test("un renglón que no se entiende se rechaza y lo muestra", () => {
    const r = validateMotoConfig({ ...base, zones: [{ id: "a", name: "A", price: 100, postalCodes: "Florida 1602" }] });
    assert.match(r.error, /Florida 1602/);
  });

  test("hora, días y precio inválidos se rechazan", () => {
    assert.ok(validateMotoConfig({ ...base, cutoffTime: "25:00" }).error);
    assert.ok(validateMotoConfig({ ...base, cutoffTime: "13:5" }).error);
    assert.ok(validateMotoConfig({ ...base, cutoffTime: undefined }).error);
    assert.ok(validateMotoConfig({ ...base, workDays: [] }).error);
    assert.ok(validateMotoConfig({ ...base, zones: [{ ...base.zones[0], price: -1 }] }).error);
  });

  test("los títulos con # no cuentan como códigos postales", () => {
    assert.deepEqual(parseZoneAreas("# Morón\n1708 Morón, Haedo").areas, [{ from: 1708, to: 1708, names: ["moron", "haedo"] }]);
  });
});

describe("dirección de entrega", () => {
  const valid = { streetName: "Av. La Plata", streetNumber: "744", city: "Almagro", provinceCode: "C", postalCode: "C1235AAA" };

  test("guarda solo los campos conocidos y el CP corto", () => {
    const { address } = sanitizeShippingAddress({ ...valid, floor: "2", admin: true });
    assert.equal(address.postalCode, "1235");
    assert.equal(address.floor, "2");
    assert.equal(address.admin, undefined);
  });

  test("faltan datos o no cierran: error", () => {
    assert.ok(sanitizeShippingAddress({ ...valid, streetName: "" }).error);
    assert.ok(sanitizeShippingAddress({ ...valid, city: "" }).error);
    assert.ok(sanitizeShippingAddress({ ...valid, provinceCode: "" }).error);
    assert.ok(sanitizeShippingAddress({ ...valid, postalCode: "abc" }).error);
    assert.ok(sanitizeShippingAddress({ ...valid, provinceCode: "B" }).error, "CP de CABA con otra provincia");
    assert.ok(sanitizeShippingAddress(undefined).error);
  });

  test("renglones para mails e impresiones", () => {
    const lines = shippingAddressLines({ ...valid, postalCode: "1235", floor: "2", apartment: "B", references: "Timbre 3" });
    assert.deepEqual(lines, ["Av. La Plata 744, Piso 2 Dpto B", "Almagro, CABA · CP 1235", "Indicaciones: Timbre 3"]);
  });
});

describe("totales con envío", () => {
  const ars = (price, quantity = 1) => ({ price, quantity, currency: "ARS", productId: 1 });

  test("se suma a los pesos", () => {
    assert.equal(computeOrderTotals({ items: [ars(10000)], shippingCost: 4500 }).totalArs, 14500);
  });

  test("un cupón no le descuenta al envío, ni siquiera uno del 100%", () => {
    const coupon = { discountType: "PERCENTAGE", discountValue: 100 };
    assert.equal(computeOrderTotals({ items: [ars(10000)], coupon, shippingCost: 4500 }).totalArs, 4500);
  });

  test("no lleva IVA", () => {
    const t = computeOrderTotals({ items: [ars(100000)], ivaRates: { 1: 21 }, shippingCost: 4500 });
    assert.equal(t.ivaAmountArs, 21000);
    assert.equal(t.totalArs, 125500);
  });

  test("con dólares va a la parte en pesos", () => {
    const t = computeOrderTotals({ items: [{ price: 100, quantity: 1, currency: "USD", productId: 2 }], shippingCost: 4500 });
    assert.deepEqual([t.totalArs, t.totalUsd], [4500, 100]);
  });
});

// ── Con el pedido real (createOrder, modificar, panel, Mercado Pago, estadísticas) ──────────────────────
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let db;
function resetDb() {
  db = {
    siteConfig: {},
    products: { 1: { id: 1, name: "Parlante", price: 10000, salePrice: null, stock: 10, stockUnlimited: false, active: true, visibility: "AMBOS", currency: "ARS", ivaRate: 21 } },
    orders: {},
    nextId: 100,
  };
}
const makeOrderItem = (data, orderId) => ({ id: db.nextId++, orderId, variantId: null, ...clone(data) });
class FakePrismaClient {
  constructor() {
    this.orderItem = { findMany: async ({ where }) => clone(db.orders[where.orderId]?.items || []) };
    this.siteConfig = {
      findMany: async () => Object.entries(db.siteConfig).map(([key, value]) => ({ key, value })),
      findUnique: async ({ where }) => (db.siteConfig[where.key] ? { key: where.key, value: db.siteConfig[where.key] } : null),
      upsert: async ({ where, create }) => { db.siteConfig[where.key] = create.value; return create; },
    };
    this.product = {
      findUnique: async ({ where }) => clone(db.products[where.id]) || null,
      findMany: async ({ where }) => Object.values(db.products).filter((p) => !where?.id?.in || where.id.in.includes(p.id)).map(clone),
    };
    this.productVariant = { count: async () => 0, findMany: async () => [], findUnique: async () => null };
    this.coupon = { findUnique: async () => db.coupon || null, findFirst: async () => null };
    this.customer = { findUnique: async () => null };
    this.cart = { findUnique: async () => null };
    this.cartItem = { deleteMany: async () => ({ count: 0 }) };
    this.order = {
      create: async ({ data }) => {
        const id = db.nextId++;
        const { items, ...rest } = clone(data);
        db.orders[id] = { id, couponId: null, createdAt: new Date().toISOString(), ...rest, items: items.create.map((i) => makeOrderItem(i, id)) };
        return { ...clone(db.orders[id]), coupon: null };
      },
      findUnique: async ({ where }) => clone(db.orders[where.id]) || null,
      update: async ({ where, data }) => clone(Object.assign(db.orders[where.id], clone(data))),
    };
    this.$executeRawUnsafe = async () => 0;
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient, Prisma: {} });
stub(path.join(root, "src/services/email.service.js"), new Proxy({}, { get: () => async () => {} }));
stub(path.join(root, "src/services/meta.service.js"), { browserDataFromRequest: () => null, sendPurchaseEvent: async () => ({}) });
stub(path.join(root, "src/controllers/product.controller.js"), { syncProductVisibility: async () => {} });
stub(path.join(root, "src/config/cloudinary.js"), { uploadBuffer: async () => ({}) });
stub(path.join(root, "src/sse/notificationSSE.js"), { pushToClient: () => {} });

const { createOrder, updateOrderFields, applyCouponToOrder } = require("../src/controllers/order.controller");
const { motoQuote, updateMotoConfig } = require("../src/controllers/shipping.controller");
const { getSettings } = require("../src/controllers/settings.controller");

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
async function placeOrder(extra) {
  const res = fakeRes();
  await createOrder({
    headers: {},
    body: {
      customerName: "Ana", customerEmail: "ana@example.com", customerPhone: "1122334455", paymentMethod: "MERCADOPAGO",
      items: [{ productId: 1, quantity: 1 }], ...extra,
    },
  }, res);
  return res;
}
const MOTO_ADDRESS = { streetName: "Rivadavia", streetNumber: "100", city: "Morón", provinceCode: "B", postalCode: "1708", references: "Timbre 3" };

describe("el pedido con envío", () => {
  beforeEach(resetDb);

  test("moto: el precio lo calcula el servidor y queda en el total, con zona y dirección", async () => {
    const res = await placeOrder({ shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS, shippingCost: 6200 });
    assert.equal(res.code, 201);
    const order = Object.values(db.orders)[0];
    assert.equal(order.shippingMethod, "MOTO");
    assert.equal(order.shippingCost, 6200);
    assert.equal(order.total, 16200);
    assert.equal(order.shippingAddress.zoneName, "Zona 1");
    assert.equal(order.shippingAddress.references, "Timbre 3");
    assert.match(order.shippingAddress.deliveryDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("no se puede pagar menos mandando otro costo: se avisa y no se crea el pedido", async () => {
    const res = await placeOrder({ shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS, shippingCost: 1 });
    assert.equal(res.code, 409);
    assert.equal(Object.keys(db.orders).length, 0);
  });

  test("sin mandar costo igual cobra el de la zona", async () => {
    await placeOrder({ shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS });
    assert.equal(Object.values(db.orders)[0].shippingCost, 6200);
  });

  test("donde la moto no llega, o con datos que no cierran, no se crea el pedido", async () => {
    assert.equal((await placeOrder({ shippingMethod: "MOTO", shippingAddress: { ...MOTO_ADDRESS, postalCode: "7600" } })).code, 400);
    assert.equal((await placeOrder({ shippingMethod: "MOTO", shippingAddress: { ...MOTO_ADDRESS, city: "Pilar" } })).code, 400);
    assert.equal((await placeOrder({ shippingMethod: "MOTO" })).code, 400);
    assert.equal(Object.keys(db.orders).length, 0);
  });

  test("toma los precios guardados en el panel", async () => {
    const zones = config.zones.map((z) => (z.id === "zona1" ? { ...z, price: 7000 } : z));
    const saved = fakeRes();
    await updateMotoConfig({ body: { ...config, zones } }, saved);
    assert.equal(saved.code, 200);
    await placeOrder({ shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS });
    assert.equal(Object.values(db.orders)[0].total, 17000);
  });

  test("cotización mayorista: suma el envío pero no promete fecha", async () => {
    const res = await placeOrder({ paymentMethod: "COTIZACION", shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS });
    assert.equal(res.code, 201);
    const order = Object.values(db.orders)[0];
    assert.equal(order.shippingCost, 6200);
    assert.equal(order.shippingAddress.deliveryDate, null);
  });

  test("correo: guarda la dirección y el costo queda a confirmar", async () => {
    const res = await placeOrder({ shippingMethod: "CORREO_ARGENTINO", shippingAddress: { ...MOTO_ADDRESS, city: "Córdoba", provinceCode: "X", postalCode: "5000" } });
    assert.equal(res.code, 201);
    const order = Object.values(db.orders)[0];
    assert.equal(order.shippingCost, 0);
    assert.equal(order.total, 10000);
    assert.equal(order.shippingAddress.postalCode, "5000");
  });

  test("correo sin dirección completa no se crea", async () => {
    assert.equal((await placeOrder({ shippingMethod: "CORREO_ARGENTINO", shippingAddress: { streetName: "X" } })).code, 400);
  });

  test("retiro y acordar envío: como siempre, sin costo ni dirección aunque manden una", async () => {
    await placeOrder({ shippingMethod: "RETIRO", shippingAddress: MOTO_ADDRESS, shippingCost: 999 });
    await placeOrder({ shippingMethod: "ENVIO" });
    await placeOrder({ shippingMethod: "CUALQUIERA" });
    const [a, b, c] = Object.values(db.orders);
    assert.deepEqual([a.shippingMethod, a.shippingCost, a.total, a.shippingAddress], ["RETIRO", 0, 10000, undefined]);
    assert.equal(b.shippingMethod, "ENVIO");
    assert.equal(c.shippingMethod, "RETIRO");
  });
});

describe("el costo de envío desde el panel", () => {
  beforeEach(resetDb);
  const patch = async (id, body) => { const res = fakeRes(); await updateOrderFields({ params: { id: String(id) }, body }, res); return res; };

  test("cargar el costo del correo lo suma al total", async () => {
    await placeOrder({ shippingMethod: "CORREO_ARGENTINO", shippingAddress: MOTO_ADDRESS });
    const [order] = Object.values(db.orders);
    const res = await patch(order.id, { shippingCost: 3000 });
    assert.equal(res.code, 200);
    assert.equal(db.orders[order.id].total, 13000);
    assert.equal(res.body.total, 13000);
  });

  test("un costo inválido se rechaza", async () => {
    await placeOrder({ shippingMethod: "ENVIO" });
    const [order] = Object.values(db.orders);
    assert.equal((await patch(order.id, { shippingCost: -5 })).code, 400);
  });

  test("pasar a retiro en el local saca el envío del total", async () => {
    await placeOrder({ shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS });
    const [order] = Object.values(db.orders);
    await patch(order.id, { shippingMethod: "RETIRO" });
    assert.deepEqual([db.orders[order.id].shippingCost, db.orders[order.id].total], [0, 10000]);
  });

  test("pasar a retiro un pedido sin costo de envío no toca el total", async () => {
    await placeOrder({ shippingMethod: "ENVIO" });
    const [order] = Object.values(db.orders);
    db.orders[order.id].total = 8000; // cupón viejo: recalcular daría otro número
    await patch(order.id, { shippingMethod: "RETIRO" });
    assert.deepEqual([db.orders[order.id].shippingMethod, db.orders[order.id].total], ["RETIRO", 8000]);
  });

  test("cambiar el costo corrige el total por la diferencia, sin recalcular el resto", async () => {
    await placeOrder({ shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS }); // 10.000 + 6.200
    const [order] = Object.values(db.orders);
    db.orders[order.id].total = 15000; // con un descuento que hoy ya no daría igual
    await patch(order.id, { shippingCost: 7000 });
    assert.deepEqual([db.orders[order.id].shippingCost, db.orders[order.id].total], [7000, 15800]);
  });

  test("cargar el envío en una cotización no le publica al cliente los ítems en borrador", async () => {
    await placeOrder({ shippingMethod: "CORREO_ARGENTINO", shippingAddress: MOTO_ADDRESS });
    const [order] = Object.values(db.orders);
    Object.assign(db.orders[order.id], { paymentMethod: "COTIZACION", clientSnapshot: [{ name: "lo publicado" }] });
    await patch(order.id, { shippingCost: 3000 });
    assert.deepEqual(db.orders[order.id].clientSnapshot, [{ name: "lo publicado" }]);
    assert.equal(db.orders[order.id].total, 13000);
  });

  test("el mínimo de compra de un cupón no cuenta el envío", async () => {
    await placeOrder({ shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS }); // 10.000 + 6.200
    const [order] = Object.values(db.orders);
    Object.assign(db.orders[order.id], { paymentMethod: "COTIZACION", status: "PENDING", customerId: 5 });
    db.coupon = { id: 1, code: "MIN", active: true, minPurchase: 15000, discountType: "PERCENTAGE", discountValue: 10 };
    const res = fakeRes();
    await applyCouponToOrder({ params: { id: String(order.id) }, body: { couponCode: "MIN" }, user: { id: 5, email: "ana@example.com" } }, res);
    assert.equal(res.body.valid, false);
    assert.match(res.body.error, /compra mínima/);
  });

  test("cambiar otra cosa (el descuento) mantiene el envío en el total", async () => {
    await placeOrder({ shippingMethod: "MOTO", shippingAddress: MOTO_ADDRESS });
    const [order] = Object.values(db.orders);
    await patch(order.id, { manualDiscountType: "FIXED", manualDiscountValue: 1000 });
    assert.equal(db.orders[order.id].total, 15200);
  });
});

describe("rutas públicas", () => {
  beforeEach(resetDb);

  test("la cotización no le muestra al cliente la marca interna de revisión", async () => {
    const res = fakeRes();
    await motoQuote({ query: { postalCode: "1708", provinceCode: "B", city: "Inventado" } }, res);
    assert.equal(res.body.available, true);
    assert.equal(res.body.reviewCity, undefined);
    assert.equal(res.body.price, 6200);
  });

  test("la lista de zonas no viaja en /api/settings", async () => {
    db.siteConfig.motoShipping = JSON.stringify(config);
    const res = fakeRes();
    await getSettings({}, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.motoShipping, undefined);
  });
});
