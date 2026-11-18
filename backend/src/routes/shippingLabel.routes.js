// Etiquetas de envío (las que antes eran archivos .btw de BarTender, una por cliente).
// Solo admin con permiso de órdenes: tienen datos personales (DNI, dirección, teléfono).
//
//   GET    /api/shipping-labels?search=&customerId=   confirmadas (las más recientes primero)
//          ?pending=true                              las pendientes de revisar, con el cliente sugerido
//          ?includePending=true                       las dos (lo usa el botón del pedido para buscar por nombre)
//   POST   /api/shipping-labels                       crear
//   PUT    /api/shipping-labels/:id                   editar (guardar una pendiente la confirma)
//   DELETE /api/shipping-labels/:id                   borrar (las de BarTender quedan descartadas: no vuelven)
//   POST   /api/shipping-labels/import/upload         subir .btw: se guardan como pendientes de revisar
//   POST   /api/shipping-labels/confirm               confirmar pendientes { items: [{ id, customerId }] }
//   POST   /api/shipping-labels/discard               descartar pendientes { ids }
//
// status: "PENDING" (sin revisar) | "CONFIRMED" (en uso) | "DISCARDED" (no se muestra; se recuerda para no
// volver a importarla). Las respuestas traen además pending: true/false para el panel.
//
// Antes (18/11/2026, primera versión): /import/parse devolvía lo leído sin guardar y /import guardaba lo
// tildado en ese momento; lo que no se tildaba se perdía hasta volver a subir la carpeta. Ahora todo queda
// guardado como pendiente y la revisión se hace de a poco (y la puede seguir otra persona).
const express = require("express");
const multer = require("multer");
const prisma = require("../lib/prisma");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");
const { parseBtwLabel } = require("../utils/btwLabel");
const { DEFAULT_SENDER, suggestCustomers, personKey } = require("../services/shippingLabels.service");

const router = express.Router();
const admin = [authMiddleware, adminMiddleware, requireAnyPermission("ordenes")];

// Los .btw se leen en memoria y no se guardan (pesan 30-40 KB; se suben de a tandas desde el panel).
const MAX_FILES = 60;
const btwUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: MAX_FILES },
});

const LABEL_SELECT = {
  id: true, customerId: true, recipientName: true, recipientDetails: true, transport: true, insurance: true,
  sender: true, sourceFile: true, sourceSize: true, sourceDate: true, status: true, createdAt: true, updatedAt: true,
  customer: { select: { id: true, name: true, email: true } },
};

const str = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const optStr = (v, max) => { const s = str(v, max); return s || null; };
const withPending = (l) => ({ ...l, pending: l.status === "PENDING" });
const toIds = (arr, max = 1000) => (Array.isArray(arr) ? arr : []).slice(0, max).map((v) => parseInt(v, 10)).filter((n) => !isNaN(n));

// customerId del body: null si viene vacío; error si no existe.
async function customerIdOf(v) {
  if (v === undefined || v === null || v === "") return { customerId: null };
  const customerId = parseInt(v, 10);
  if (isNaN(customerId)) return { error: "Cliente inválido" };
  const exists = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!exists) return { error: "El cliente elegido ya no existe" };
  return { customerId };
}

// Datos de una etiqueta desde el body, ya limpios. { error } si falta algo.
async function labelData(body) {
  const recipientName = str(body.recipientName, 200);
  if (!recipientName) return { error: "Falta el destinatario" };
  const { customerId, error } = await customerIdOf(body.customerId);
  if (error) return { error };
  return {
    data: {
      customerId,
      recipientName,
      recipientDetails: str(body.recipientDetails, 2000),
      transport: optStr(body.transport, 120),
      insurance: optStr(body.insurance, 120),
      sender: str(body.sender, 500) || DEFAULT_SENDER,
    },
  };
}

router.get("/", ...admin, async (req, res) => {
  try {
    const onlyPending = req.query.pending === "true";
    const where = {
      status: onlyPending ? "PENDING" : req.query.includePending === "true" ? { in: ["CONFIRMED", "PENDING"] } : "CONFIRMED",
    };
    if (req.query.customerId) {
      const id = parseInt(req.query.customerId, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Cliente inválido" });
      where.customerId = id;
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    if (search) {
      where.OR = [
        { recipientName: { contains: search, mode: "insensitive" } },
        { recipientDetails: { contains: search, mode: "insensitive" } },
        { customer: { name: { contains: search, mode: "insensitive" } } },
      ];
    }
    const labels = await prisma.shippingLabel.findMany({
      where,
      select: LABEL_SELECT,
      // Pendientes: por nombre, para revisar en orden. Confirmadas: la última tocada primero.
      orderBy: onlyPending ? [{ recipientName: "asc" }, { sourceDate: "desc" }] : { updatedAt: "desc" },
      take: onlyPending ? 2000 : (search || where.customerId ? 100 : 500),
    });

    const pendingCount = onlyPending ? labels.length : await prisma.shippingLabel.count({ where: { status: "PENDING" } });
    if (!onlyPending) return res.json({ labels: labels.map(withPending), pendingCount, defaultSender: DEFAULT_SENDER });

    // Pendientes: cliente sugerido y si hay otra más nueva de la misma persona
    const customers = await prisma.customer.findMany({ select: { id: true, name: true, phone: true, cuit: true, email: true } });
    const newest = {};
    for (const l of labels) {
      const k = personKey(l);
      if (!k) continue;
      if (!newest[k] || (l.sourceDate || 0) > (newest[k].sourceDate || 0)) newest[k] = l;
    }
    const out = labels.map((l) => {
      const k = personKey(l);
      const n = k ? newest[k] : null;
      return { ...withPending(l), suggestions: suggestCustomers(l, customers), newerFile: n && n.id !== l.id ? n.sourceFile : null };
    });
    res.json({ labels: out, pendingCount, defaultSender: DEFAULT_SENDER });
  } catch (err) {
    console.error("shippingLabels list:", err);
    res.status(500).json({ error: "No se pudieron cargar las etiquetas" });
  }
});

router.post("/", ...admin, async (req, res) => {
  try {
    const { data, error } = await labelData(req.body || {});
    if (error) return res.status(400).json({ error });
    const label = await prisma.shippingLabel.create({ data, select: LABEL_SELECT });
    res.status(201).json(withPending(label));
  } catch (err) {
    console.error("shippingLabels create:", err);
    res.status(500).json({ error: "No se pudo guardar la etiqueta" });
  }
});

// Guardar desde el editor: si era una pendiente, queda confirmada.
router.put("/:id", ...admin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.shippingLabel.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing || existing.status === "DISCARDED") return res.status(404).json({ error: "Etiqueta no encontrada" });
    const { data, error } = await labelData(req.body || {});
    if (error) return res.status(400).json({ error });
    const label = await prisma.shippingLabel.update({ where: { id }, data: { ...data, status: "CONFIRMED" }, select: LABEL_SELECT });
    res.json(withPending(label));
  } catch (err) {
    console.error("shippingLabels update:", err);
    res.status(500).json({ error: "No se pudo guardar la etiqueta" });
  }
});

router.delete("/:id", ...admin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const label = await prisma.shippingLabel.findUnique({ where: { id }, select: { sourceFile: true, status: true } });
    if (!label || label.status === "DISCARDED") return res.status(404).json({ error: "Etiqueta no encontrada" });
    // Una importada de BarTender queda descartada (si se sube la carpeta de nuevo, no vuelve); una creada
    // en el panel se borra.
    if (label.sourceFile) await prisma.shippingLabel.update({ where: { id }, data: { status: "DISCARDED" } });
    else await prisma.shippingLabel.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("shippingLabels delete:", err);
    res.status(500).json({ error: "No se pudo borrar la etiqueta" });
  }
});

// Subir .btw: las de envío se guardan como pendientes de revisar. No se guardan las que no son de envío
// (sin remitente: frágil, artículos…), las que no se pueden leer, ni las ya subidas en cualquier estado
// (mismo nombre y misma fecha de archivo: dos archivos que se llaman igual en carpetas distintas son dos). El remitente es el actual (las viejas tienen direcciones que ya no van). lastModified: JSON
// con la fecha de cada archivo, en el mismo orden.
router.post("/import/upload", ...admin, (req, res, next) => {
  btwUpload.array("files", MAX_FILES)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_COUNT" ? `Subí de a ${MAX_FILES} archivos como máximo` : "No se pudieron leer los archivos" });
    next();
  });
}, async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: "No llegó ningún archivo" });
    let dates = [];
    try { dates = JSON.parse(req.body.lastModified || "[]"); } catch { dates = []; }
    // multer lee el nombre como latin1: se pasa a UTF-8 para que "Río" no quede "RÃ­o"
    const names = files.map((f) => Buffer.from(f.originalname, "latin1").toString("utf8"));
    // Ya subidas: nombre → fechas (null = sin fecha, cuenta como la misma)
    const seen = new Map();
    for (const l of await prisma.shippingLabel.findMany({ where: { sourceFile: { in: names } }, select: { sourceFile: true, sourceDate: true } })) {
      if (!seen.has(l.sourceFile)) seen.set(l.sourceFile, []);
      seen.get(l.sourceFile).push(l.sourceDate ? l.sourceDate.getTime() : null);
    }
    const isRepeated = (name, ms) => (seen.get(name) || []).some((t) => t === null || !ms || Math.abs(t - ms) < 1000);

    const toCreate = [];
    const unreadable = [];
    let notShipping = 0;
    let repeated = 0;
    files.forEach((f, i) => {
      const fileName = names[i];
      const ms = Number(dates[i]) > 0 ? Number(dates[i]) : null;
      if (isRepeated(fileName, ms)) { repeated++; return; }
      let parsed = null;
      try { parsed = parseBtwLabel(f.buffer, fileName); } catch { parsed = null; }
      if (!parsed) { unreadable.push(fileName); return; }
      if (!parsed.sender) { notShipping++; return; }
      if (!seen.has(fileName)) seen.set(fileName, []);
      seen.get(fileName).push(ms); // el mismo archivo dos veces en la misma tanda
      toCreate.push({
        recipientName: parsed.recipientName.slice(0, 200),
        recipientDetails: (parsed.recipientDetails || "").slice(0, 2000),
        transport: parsed.transport ? parsed.transport.slice(0, 120) : null,
        insurance: parsed.insurance ? parsed.insurance.slice(0, 120) : null,
        sender: DEFAULT_SENDER,
        sourceFile: fileName.slice(0, 255),
        sourceSize: parsed.size,
        sourceDate: ms ? new Date(ms) : null,
        status: "PENDING",
      });
    });
    const { count } = toCreate.length ? await prisma.shippingLabel.createMany({ data: toCreate }) : { count: 0 };
    res.json({ created: count, repeated, notShipping, unreadable });
  } catch (err) {
    console.error("shippingLabels upload:", err);
    res.status(500).json({ error: "No se pudieron guardar las etiquetas" });
  }
});

// Confirmar pendientes (con el cliente elegido para cada una, o sin cliente).
router.post("/confirm", ...admin, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 1000) : [];
    if (items.length === 0) return res.status(400).json({ error: "No hay etiquetas para confirmar" });
    let confirmed = 0;
    for (const it of items) {
      const id = parseInt(it.id, 10);
      if (isNaN(id)) continue;
      const { customerId, error } = await customerIdOf(it.customerId);
      if (error) return res.status(400).json({ error });
      const { count } = await prisma.shippingLabel.updateMany({ where: { id, status: "PENDING" }, data: { status: "CONFIRMED", customerId } });
      confirmed += count;
    }
    res.json({ confirmed });
  } catch (err) {
    console.error("shippingLabels confirm:", err);
    res.status(500).json({ error: "No se pudieron confirmar las etiquetas" });
  }
});

// Descartar pendientes (solo pendientes: una confirmada se borra de a una, con su botón). Quedan como
// DISCARDED, no se borran: así no vuelven si se sube la carpeta otra vez.
router.post("/discard", ...admin, async (req, res) => {
  try {
    const ids = toIds(req.body?.ids);
    if (ids.length === 0) return res.status(400).json({ error: "No hay etiquetas para descartar" });
    const { count } = await prisma.shippingLabel.updateMany({ where: { id: { in: ids }, status: "PENDING" }, data: { status: "DISCARDED" } });
    res.json({ discarded: count });
  } catch (err) {
    console.error("shippingLabels discard:", err);
    res.status(500).json({ error: "No se pudieron descartar las etiquetas" });
  }
});

module.exports = router;
