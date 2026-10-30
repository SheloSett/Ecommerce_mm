// Tests de la cola de emails masivos (processEmailQueue): quién se dio de baja DESPUÉS de armado el
// envío ya no lo recibe (B13 de la auditoría). Base y SMTP simulados. Correr con: npm test

process.env.JWT_SECRET = process.env.JWT_SECRET || "secreto-de-prueba";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
let db;
function resetDb() {
  db = {
    customers: {
      1: { id: 1, status: "APPROVED", unsubscribeMarketing: false },
      2: { id: 2, status: "APPROVED", unsubscribeMarketing: false },
    },
    broadcasts: {},
    recipients: {},
  };
}
function addBroadcast(id, fields, customerIds) {
  db.broadcasts[id] = { id, kind: "CUSTOM", audience: "ALL", status: "SENDING", subject: "Hola {nombre}", title: "Novedades", body: "Texto", sentCount: 0, failedCount: 0, ...fields };
  for (const cid of customerIds) {
    const rid = id * 100 + cid;
    db.recipients[rid] = { id: rid, broadcastId: id, customerId: cid, email: `c${cid}@mail.com`, name: `Cliente ${cid}`, type: "MINORISTA", status: "PENDING" };
  }
}
function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? (row[k] || 0) + v.increment : v;
  return clone(row);
}
class FakePrismaClient {
  constructor() {
    this.siteConfig = { findUnique: async () => null };
    this.emailRecipient = {
      count: async ({ where }) => Object.values(db.recipients).filter((r) =>
        r.status === where.status && (!where.broadcastId || r.broadcastId === where.broadcastId)).length,
      findMany: async ({ where, take }) => Object.values(db.recipients)
        .filter((r) => r.status === where.status && db.broadcasts[r.broadcastId].status === where.broadcast.status)
        .slice(0, take).map((r) => ({ ...clone(r), broadcast: clone(db.broadcasts[r.broadcastId]) })),
      findUnique: async ({ where }) => clone(db.recipients[where.id]) || null,
      update: async ({ where, data }) => applyData(db.recipients[where.id], data),
    };
    this.emailBroadcast = {
      update: async ({ where, data }) => applyData(db.broadcasts[where.id], data),
      findMany: async ({ where }) => Object.values(db.broadcasts).filter((b) => b.status === where.status).map((b) => ({ id: b.id })),
    };
    this.customer = { findUnique: async ({ where }) => clone(db.customers[where.id]) || null };
    this.$transaction = (ops) => Promise.all(ops);
  }
}
const root = path.join(__dirname, "..");
const stub = (resolved, exportsObj) => { require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj }; };
stub(require.resolve("@prisma/client", { paths: [root] }), { PrismaClient: FakePrismaClient });

const { processEmailQueue, skipReasonAtSend } = require("../src/services/broadcast.service");

let sentTo;
const transporter = { sendMail: async ({ to }) => { sentTo.push(to); }, close() {} };

describe("al mandar, se vuelve a mirar si el cliente sigue queriendo promociones", () => {
  beforeEach(() => { resetDb(); sentTo = []; });

  test("quien se dio de baja después de armado el envío ya no lo recibe", async () => {
    addBroadcast(1, {}, [1, 2]);
    db.customers[2].unsubscribeMarketing = true; // se dio de baja con el envío en cola
    const r = await processEmailQueue({ transporter });
    assert.deepEqual(sentTo, ["c1@mail.com"]);
    assert.equal(r.sent, 1);
    assert.equal(db.recipients[102].status, "CANCELLED");
    assert.equal(db.recipients[102].error, "Se dio de baja de las promociones");
    assert.equal(db.broadcasts[1].status, "DONE", "el envío termina igual");
  });

  test("una cuenta rechazada o borrada en el medio tampoco", async () => {
    addBroadcast(2, {}, [1, 2]);
    db.customers[1].status = "REJECTED";
    delete db.customers[2];
    await processEmailQueue({ transporter });
    assert.deepEqual(sentTo, []);
  });

  test("un mensaje a clientes elegidos va igual (es directo, como al armarlo)", async () => {
    addBroadcast(3, { audience: "SELECTED", kind: "PLAIN" }, [2]);
    db.customers[2].unsubscribeMarketing = true;
    await processEmailQueue({ transporter });
    assert.deepEqual(sentTo, ["c2@mail.com"]);
  });
});

describe("skipReasonAtSend", () => {
  test("cliente al día: va", () => {
    assert.equal(skipReasonAtSend({ audience: "MINORISTA" }, { status: "APPROVED", unsubscribeMarketing: false }), null);
  });
});
