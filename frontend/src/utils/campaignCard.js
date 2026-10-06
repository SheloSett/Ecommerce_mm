// Textos y colores de la tarjeta grande de campaña del Home (components/CampaignCard.jsx).
// Funciones puras para poder testearlas sin React (ver campaignCard.test.js).

const num = (v) => Number(v).toLocaleString("es-AR", { maximumFractionDigits: 2 });

// Descuento que anuncia la tarjeta, partido para dibujarlo grande:
//   { prefix: "Hasta" | null, amount: "20%" | "$ 5.000", suffix: "OFF" }
// badge: { value, upTo } (lo calcula el backend por público — ver cardBadge en offers.service.js).
// null si no hay descuento que anunciar (la campaña no aplica a quien mira).
export function badgeParts(badge, discountType) {
  if (!badge || !(badge.value > 0)) return null;
  return {
    prefix: badge.upTo ? "Hasta" : null,
    amount: discountType === "FIXED" ? `$ ${num(badge.value)}` : `${num(badge.value)}%`,
    suffix: "OFF",
  };
}

// Badge del público que mira el Home: el mayorista ve el suyo (si el backend se lo mandó).
export function badgeFor(offer, visibleFor) {
  const badges = offer?.badges || {};
  return visibleFor === "MAYORISTA" && badges.wholesale !== undefined ? badges.wholesale : badges.retail;
}

// Cuánto falta para que termine, por días de calendario (no por horas): una campaña que termina
// hoy a las 23:59 dice "Termina hoy" aunque falten 20 horas.
export function endsLabel(endsAt, now = new Date()) {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (isNaN(end) || end <= now) return null;
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(end) - day(now)) / 86400000);
  if (days === 0) return "¡Termina hoy!";
  if (days === 1) return "Termina mañana";
  if (days <= 7) return `Quedan ${days} días`;
  return `Hasta el ${end.getDate()}/${end.getMonth() + 1}`;
}

// Con menos de esto la cuenta regresiva se pone roja y titila (pedido: "cuando queden menos de 3 días").
export const COUNTDOWN_URGENT_MS = 3 * 86400000;

// Cuenta regresiva hasta el fin de la campaña: { days, hours, minutes, seconds, urgent }.
// null si ya terminó o no hay fecha.
export function countdownParts(endsAt, now = new Date()) {
  if (!endsAt) return null;
  const ms = new Date(endsAt) - now;
  if (isNaN(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return {
    days:    Math.floor(s / 86400),
    hours:   Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    urgent:  ms < COUNTDOWN_URGENT_MS,
  };
}

// Color del texto sobre un fondo "#rrggbb": oscuro si el fondo es claro, blanco si no.
export function textColorFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#0b1c30" : "#ffffff";
}
