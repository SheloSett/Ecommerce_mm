// Base simulada para los tests de Mercado Libre: tablas en memoria con lo que usan services/ml/*,
// el servicio de stock y el controlador (findUnique, findMany, create, update, updateMany, upsert,
// deleteMany, count), con filtros de igualdad, in, notIn, not, lt/lte/gt/gte, OR y AND.
// Las transacciones corren de a una (ver helpers/fakeStock.js), como el candado de fila de Postgres.
const { withStockSupport } = require("./fakeStock");

const clone = (o) => (o === undefined ? undefined : structuredClone(o));

// Columnas de cada tabla (las que no se pasan quedan en null, como en Prisma) y sus valores por defecto.
const TABLES = {
  mlAccount: {
    fields: ["id", "mlUserId", "nickname", "accessToken", "refreshToken", "tokenExpiresAt", "status", "mode", "pausedUntil", "pauseLevel",
      "oauthState", "oauthVerifier", "oauthUserId", "oauthExpiresAt", "connectedAt", "connectedBy", "lastRefreshAt", "lastWebhookAt",
      "lastSweepAt", "lastPassAt", "listingsAt", "listingsResult", "lastError", "lastErrorAt", "updatedAt"],
    defaults: () => ({ id: 1, status: "DESCONECTADA", mode: "APAGADO", pauseLevel: 0 }),
  },
  mlPool: {
    fields: ["id", "key", "userProductId", "productId", "variantId", "active", "status", "agreed", "agreedSold", "writeTarget", "writeBase",
      "writeStartedAt", "writeOutcome", "writeWantedAt", "heldQty", "heldAt", "lastRead", "lastReadAt", "lastChangeAt", "dirty", "attempts", "nextAttemptAt",
      "lastSyncAt", "lastError", "review", "linkedAt", "linkedBy", "createdAt", "updatedAt"],
    defaults: () => ({ active: false, status: "OK", dirty: false, attempts: 0 }),
  },
  mlListing: {
    fields: ["id", "itemId", "variationId", "userProductId", "poolId", "title", "sku", "permalink", "thumbnail", "status", "quantity", "sold",
      "lastSeenAt", "createdAt", "updatedAt"],
    defaults: () => ({ variationId: "" }),
    unique: { itemId_variationId: ["itemId", "variationId"] },
  },
  mlCycle: {
    fields: ["id", "poolId", "kind", "readQty", "readSold", "webBefore", "webAfter", "delta", "writeQty", "storedQty", "result", "detail", "createdAt"],
    defaults: () => ({}),
  },
  product: {
    fields: ["id", "name", "sku", "stock", "stockUnlimited", "active", "hiddenByAdmin", "updatedAt"],
    defaults: () => ({ stock: 0, stockUnlimited: false, active: true, hiddenByAdmin: false }),
  },
  productVariant: {
    fields: ["id", "productId", "sku", "stock", "stockUnlimited", "active", "combination", "updatedAt"],
    defaults: () => ({ stock: 0, stockUnlimited: false, active: true }),
  },
};

function cmp(a, b) {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}
function eq(a, b) {
  if (a instanceof Date || b instanceof Date) return a != null && b != null && cmp(a, b) === 0;
  return (a ?? null) === (b ?? null);
}

function matches(row, where, spec) {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "OR") { if (!cond.some((c) => matches(row, c, spec))) return false; continue; }
    if (key === "AND") { if (!cond.every((c) => matches(row, c, spec))) return false; continue; }
    if (spec?.unique?.[key]) { if (!matches(row, cond, spec)) return false; continue; }
    const value = row[key];
    if (cond === null || typeof cond !== "object" || cond instanceof Date) {
      if (!eq(value, cond)) return false;
      continue;
    }
    for (const [op, x] of Object.entries(cond)) {
      if (op === "in") { if (!x.some((y) => eq(value, y))) return false; }
      else if (op === "notIn") { if (x.some((y) => eq(value, y))) return false; }
      else if (op === "not") { if (x === null ? value == null : eq(value, x)) return false; }
      else if (op === "equals") { if (!eq(value, x)) return false; }
      else if (op === "lt") { if (value == null || cmp(value, x) >= 0) return false; }
      else if (op === "lte") { if (value == null || cmp(value, x) > 0) return false; }
      else if (op === "gt") { if (value == null || cmp(value, x) <= 0) return false; }
      else if (op === "gte") { if (value == null || cmp(value, x) < 0) return false; }
      else throw new Error(`base simulada: operador ${op} no soportado`);
    }
  }
  return true;
}

function notFound() {
  const e = new Error("Record to update not found.");
  e.code = "P2025";
  return e;
}

function makeTable(db, name, now) {
  const spec = TABLES[name];
  const rows = () => db[name];
  const full = (data) => {
    const row = {};
    for (const f of spec.fields) row[f] = null;
    return Object.assign(row, spec.defaults(), clone(data));
  };
  const nextId = () => rows().reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const find = (where) => rows().find((r) => matches(r, where, spec));
  const touch = (row) => { if (spec.fields.includes("updatedAt")) row.updatedAt = now(); };
  const order = (list, orderBy) => {
    const rules = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return list.sort((a, b) => {
      for (const r of rules) {
        const [k, dir] = Object.entries(r)[0];
        const c = cmp(a[k] ?? -Infinity, b[k] ?? -Infinity);
        if (c) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  };
  const apply = (row, data) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) row[k] = (row[k] || 0) + v.increment;
      else row[k] = clone(v);
    }
    touch(row);
  };

  return {
    findUnique: async ({ where } = {}) => clone(find(where)) ?? null,
    findFirst: async ({ where, orderBy } = {}) => clone(order(rows().filter((r) => matches(r, where, spec)), orderBy)[0]) ?? null,
    findMany: async ({ where, orderBy, take } = {}) => {
      let list = order(rows().filter((r) => matches(r, where, spec)), orderBy);
      if (take) list = list.slice(0, take);
      return list.map(clone);
    },
    count: async ({ where } = {}) => rows().filter((r) => matches(r, where, spec)).length,
    create: async ({ data }) => {
      const row = full({ id: data.id ?? nextId(), ...data });
      if (spec.fields.includes("createdAt") && !row.createdAt) row.createdAt = now();
      touch(row);
      rows().push(row);
      return clone(row);
    },
    update: async ({ where, data }) => {
      const row = find(where);
      if (!row) throw notFound();
      apply(row, data);
      return clone(row);
    },
    updateMany: async ({ where, data }) => {
      const list = rows().filter((r) => matches(r, where, spec));
      for (const row of list) apply(row, data);
      return { count: list.length };
    },
    upsert: async ({ where, create, update }) => {
      const row = find(where);
      if (row) { apply(row, update); return clone(row); }
      const created = full({ id: create.id ?? nextId(), ...create });
      if (spec.fields.includes("createdAt") && !created.createdAt) created.createdAt = now();
      touch(created);
      rows().push(created);
      return clone(created);
    },
    deleteMany: async ({ where } = {}) => {
      const keep = rows().filter((r) => !matches(r, where, spec));
      const count = rows().length - keep.length;
      db[name] = keep;
      return { count };
    },
  };
}

// db: { mlAccount: [], mlPool: [], mlListing: [], mlCycle: [], product: [], productVariant: [], movements: [] }
function makeFakePrisma(getDb, now = () => new Date()) {
  const client = {};
  for (const name of Object.keys(TABLES)) {
    Object.defineProperty(client, name, { get: () => makeTable(getDb(), name, now), enumerable: true, configurable: true });
  }
  // product.findMany con select de variantes (linkableUnits) y findUnique con include.variants (stock).
  Object.defineProperty(client, "product", {
    get: () => {
      const t = makeTable(getDb(), "product", now);
      const variantsOf = (id) => getDb().productVariant.filter((v) => v.productId === id).map(clone);
      return {
        ...t,
        findMany: async (args = {}) => (await t.findMany(args)).map((p) => (args.select?.variants ? { ...p, variants: variantsOf(p.id) } : p)),
        findUnique: async (args = {}) => {
          const row = await t.findUnique(args);
          if (row && args.include?.variants) row.variants = variantsOf(row.id).filter((v) => v.active !== false);
          return row;
        },
      };
    },
    enumerable: true,
  });
  withStockSupport(client, { movements: () => getDb().movements });
  client.$queryRawUnsafe = async () => [{ t: "ok" }];
  return client;
}

module.exports = { makeFakePrisma, matches };
