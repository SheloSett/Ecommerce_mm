// Prisma no acepta null para vaciar una columna Json: pide Prisma.DbNull (NULL de la base). Los tests
// reemplazan @prisma/client por una base simulada sin Prisma.DbNull: ahí vale null.
let DbNull = null;
try {
  DbNull = require("@prisma/client").Prisma?.DbNull ?? null;
} catch {
  DbNull = null;
}

module.exports = { DbNull };
