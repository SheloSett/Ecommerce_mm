/**
 * normalize-emails.js — pasa a minúsculas los emails que YA están guardados en la DB.
 *
 * A partir del middleware normalizeEmail, todo lo que entra se guarda en minúsculas,
 * y las búsquedas de login/duplicados usan comparación insensible a mayúsculas, así que
 * las cuentas viejas siguen funcionando. Este script es la limpieza opcional para dejar
 * los datos históricos consistentes (útil para exportes, filtros y campañas de email).
 *
 * MODO POR DEFECTO: SOLO LECTURA (dry-run). No escribe nada, solo informa qué cambiaría.
 *   docker compose exec backend node scripts/normalize-emails.js
 *
 * Para aplicar los cambios hay que pasar --apply explícitamente:
 *   docker compose exec backend node scripts/normalize-emails.js --apply
 *
 * IMPORTANTE: no borra ni pisa cuentas. Si detecta un CONFLICTO (dos filas que al pasar
 * a minúsculas quedarían con el mismo email, p. ej. "Juan@x.com" y "juan@x.com"), NO toca
 * ninguna de las dos y las lista para que las resuelvas a mano desde el panel.
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");

// Modelos con email único (no se pueden normalizar a ciegas: puede haber choques)
const UNIQUE_MODELS = [
  { name: "Customer", delegate: () => prisma.customer, field: "email" },
  { name: "User (admins)", delegate: () => prisma.user, field: "email" },
];

// Modelos con email NO único (histórico: órdenes, cupones usados, devoluciones...)
const PLAIN_MODELS = [
  { name: "Order", delegate: () => prisma.order, field: "customerEmail" },
  { name: "CouponUsage", delegate: () => prisma.couponUsage, field: "customerEmail" },
  { name: "EmailChangeRequest", delegate: () => prisma.emailChangeRequest, field: "newEmail" },
  { name: "ReturnRequest", delegate: () => prisma.returnRequest, field: "customerEmail" },
];

function needsFix(value) {
  return typeof value === "string" && value !== value.trim().toLowerCase();
}

async function processUnique({ name, delegate, field }) {
  const rows = await delegate().findMany({ select: { id: true, [field]: true } });
  const pending = rows.filter((r) => needsFix(r[field]));

  // Detectar choques: alguna otra fila ya ocupa el email en minúsculas
  const byLower = new Map();
  for (const r of rows) {
    const key = String(r[field] || "").trim().toLowerCase();
    if (!byLower.has(key)) byLower.set(key, []);
    byLower.get(key).push(r);
  }

  const conflicts = [];
  const safe = [];
  for (const row of pending) {
    const key = String(row[field]).trim().toLowerCase();
    if (byLower.get(key).length > 1) conflicts.push(byLower.get(key));
    else safe.push(row);
  }

  console.log(`\n── ${name}: ${rows.length} filas, ${pending.length} con mayúsculas`);

  if (conflicts.length) {
    const shown = new Set();
    console.log(`   ⚠️  CONFLICTOS (no se tocan, resolvelos a mano):`);
    for (const group of conflicts) {
      const key = String(group[0][field]).toLowerCase();
      if (shown.has(key)) continue;
      shown.add(key);
      console.log(`      ${group.map((g) => `#${g.id} ${g[field]}`).join("  vs  ")}`);
    }
  }

  for (const row of safe) {
    const nuevo = String(row[field]).trim().toLowerCase();
    console.log(`   ${APPLY ? "✔" : "·"} #${row.id}  ${row[field]}  →  ${nuevo}`);
    if (APPLY) {
      await delegate().update({ where: { id: row.id }, data: { [field]: nuevo } });
    }
  }
  return safe.length;
}

async function processPlain({ name, delegate, field }) {
  const rows = await delegate().findMany({ select: { id: true, [field]: true } });
  const pending = rows.filter((r) => needsFix(r[field]));
  console.log(`\n── ${name}: ${rows.length} filas, ${pending.length} con mayúsculas`);
  for (const row of pending) {
    const nuevo = String(row[field]).trim().toLowerCase();
    if (APPLY) {
      await delegate().update({ where: { id: row.id }, data: { [field]: nuevo } });
    }
  }
  if (pending.length) console.log(`   ${APPLY ? "✔ actualizadas" : "· se actualizarían"}: ${pending.length}`);
  return pending.length;
}

async function main() {
  console.log(APPLY
    ? "MODO APLICAR — se van a escribir los cambios en la base de datos."
    : "MODO SIMULACIÓN (dry-run) — no se escribe nada. Usá --apply para aplicar.");

  let total = 0;
  for (const m of UNIQUE_MODELS) total += await processUnique(m);
  for (const m of PLAIN_MODELS) {
    try {
      total += await processPlain(m);
    } catch (e) {
      console.log(`\n── ${m.name}: omitido (${e.message.split("\n")[0]})`);
    }
  }

  console.log(`\nTotal ${APPLY ? "actualizado" : "a actualizar"}: ${total} email(s).`);
}

main()
  .catch((e) => { console.error("Error:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
