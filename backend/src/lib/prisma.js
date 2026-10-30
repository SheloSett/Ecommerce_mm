// UN solo cliente de Prisma para todo el backend.
//
// Antes cada controller, ruta y servicio hacía su propio `new PrismaClient()` (30 en total), y cada
// uno abre su propio grupo de conexiones a Postgres (hasta 2×CPU+1 = 5 en el VPS): en un pico se podían
// pedir ~150 conexiones contra las 100 que acepta Postgres por defecto ("too many clients"), y aun sin
// pico había decenas de conexiones ociosas ocupando memoria.
//
// Con uno solo, el tope de conexiones se fija acá: connection_limit=20 si la DATABASE_URL no trae uno
// (de sobra para la tienda y lejos del límite de Postgres). Para cambiarlo sin tocar código, agregarlo
// a la DATABASE_URL del .env: ...?connection_limit=30
//
// Los tests reemplazan @prisma/client en require.cache antes de cargar los módulos, así que reciben
// el cliente falso igual que antes.
const { PrismaClient } = require("@prisma/client");

function datasourceUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "20");
    return url.toString();
  } catch {
    return raw;
  }
}

const url = datasourceUrl();
const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

module.exports = prisma;
