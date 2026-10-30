// Límites de los días para los filtros de los reportes ("YYYY-MM-DD" → Date).
//
// Hay dos tipos de fecha y cada uno se corta distinto:
//  - MOMENTOS (createdAt de los pedidos): el día va de 00:00 a 23:59:59.999 hora ARGENTINA (UTC-3), igual
//    que Analíticas (parseRange en analytics.controller.js). Antes el Dashboard, Métricas y las
//    estadísticas en dólares usaban new Date("YYYY-MM-DD") (medianoche UTC = 21:00 del día anterior en
//    Argentina) más setHours en la hora del servidor: una venta del 31/10 a las 22:00 no entraba en
//    octubre del Dashboard pero sí en Analíticas, y los números de las dos pantallas no coincidían.
//  - FECHAS SIN HORA (gastos de Caja, compras): se guardan a las 00:00 UTC del día tipeado, así que el
//    día se corta en UTC. Así lo guardado coincide con lo que escribió el admin.
// Argentina no tiene horario de verano desde 2009, por eso el -03:00 fijo.

const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

const arDayStart    = (s) => new Date(`${s}T00:00:00.000-03:00`);
const arDayEnd      = (s) => new Date(`${s}T23:59:59.999-03:00`);
const dateOnlyStart = (s) => new Date(`${s}T00:00:00.000Z`);
const dateOnlyEnd   = (s) => new Date(`${s}T23:59:59.999Z`);

module.exports = { isDay, arDayStart, arDayEnd, dateOnlyStart, dateOnlyEnd };
