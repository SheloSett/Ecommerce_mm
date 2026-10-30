// Fechas del panel sin pasar por UTC.
//
// localDay: "YYYY-MM-DD" del día de la computadora. Antes se usaba new Date().toISOString().slice(0, 10),
// que da el día en UTC: en Argentina, después de las 21:00 ya es "mañana" (un gasto cargado a las 22:30
// arrancaba con la fecha del día siguiente).
//
// formatDateOnly: muestra una fecha SIN hora (gastos de Caja, compras), que el backend guarda a las 00:00
// UTC del día tipeado. Mostrarla en la zona de la computadora la corría al día anterior (el gasto del 28/10
// aparecía como 27/10), así que se muestra en UTC.

const pad = (n) => String(n).padStart(2, "0");

export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateOnly(value, options = { day: "2-digit", month: "2-digit", year: "numeric" }) {
  return new Date(value).toLocaleDateString("es-AR", { ...options, timeZone: "UTC" });
}
