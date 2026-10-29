// Helpers para buscar por email sin depender de mayúsculas/minúsculas.
//
// El middleware normalizeEmail deja TODO lo que entra en minúsculas, pero las filas
// que ya estaban en la DB de antes pueden tener mayúsculas ("Juan@Gmail.com").
// `findUnique({ where: { email } })` es sensible a mayúsculas y no las encontraría:
// el cliente no podría loguearse, y peor, un alta nueva no detectaría el duplicado
// y crearía una segunda cuenta para la misma persona.
//
// Con `mode: "insensitive"` de Prisma la comparación la hace Postgres con ILIKE,
// así que da igual cómo esté guardado. Se usa junto con findFirst (findUnique no
// admite filtros, solo el valor exacto de la columna única).

// OJO: Prisma arma ese ILIKE con el texto tal cual, y en ILIKE "%" es "cualquier cosa" y "_" es
// "cualquier carácter". Sin escaparlos, el email "%" coincidía con el primer cliente de la tabla
// (login, registro, "olvidé mi contraseña") y "juan_p@x.com" con "juanXp@x.com". Todo valor que
// vaya a un equals + mode "insensitive" tiene que pasar por escapeLike.
const escapeLike = (value) => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);

// Cláusula where reutilizable: { email: { equals: "x@y.com", mode: "insensitive" } }
function whereEmail(email) {
  // Antes: return { email: { equals: String(email || "").trim(), mode: "insensitive" } };
  return { email: { equals: escapeLike(String(email || "").trim()), mode: "insensitive" } };
}

// Busca un cliente por email ignorando mayúsculas. `extra` permite sumar condiciones
// (por ejemplo NOT: { id } para validar duplicados al editar).
function findCustomerByEmail(prisma, email, extra = {}) {
  return prisma.customer.findFirst({ where: { ...whereEmail(email), ...extra } });
}

// Ídem para usuarios admin.
function findUserByEmail(prisma, email, extra = {}) {
  return prisma.user.findFirst({ where: { ...whereEmail(email), ...extra } });
}

module.exports = { whereEmail, findCustomerByEmail, findUserByEmail, escapeLike };
