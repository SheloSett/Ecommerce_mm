// Cómo se entrega un pedido, para las pantallas del cliente y del panel: nombres, dirección en renglones y
// día de entrega. Mismo criterio que backend/src/utils/motoShipping.js (mails y PDF).

export const SHIPPING_NAMES = {
  RETIRO:           "Retiro en el local",
  ENVIO:            "Acordar envío",
  CORREO_ARGENTINO: "Envío por correo",
  MOTO:             "Envío en moto",
};

// Provincias con el código que usa Correo Argentino
export const PROVINCES = [
  { code: "C", name: "CABA" },
  { code: "B", name: "Buenos Aires" },
  { code: "X", name: "Córdoba" },
  { code: "S", name: "Santa Fe" },
  { code: "M", name: "Mendoza" },
  { code: "T", name: "Tucumán" },
  { code: "E", name: "Entre Ríos" },
  { code: "A", name: "Salta" },
  { code: "N", name: "Misiones" },
  { code: "W", name: "Corrientes" },
  { code: "H", name: "Chaco" },
  { code: "G", name: "Santiago del Estero" },
  { code: "K", name: "Catamarca" },
  { code: "J", name: "San Juan" },
  { code: "D", name: "San Luis" },
  { code: "P", name: "Formosa" },
  { code: "R", name: "Río Negro" },
  { code: "Q", name: "Neuquén" },
  { code: "F", name: "La Rioja" },
  { code: "L", name: "La Pampa" },
  { code: "Y", name: "Jujuy" },
  { code: "U", name: "Chubut" },
  { code: "Z", name: "Santa Cruz" },
  { code: "V", name: "Tierra del Fuego" },
];

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// "2026-11-02" → "lunes 2/11". Se arma a mano (no con new Date en hora local): la fecha es un día, no un
// momento, y en otro huso horario podría correrse.
export function formatDeliveryDate(date) {
  const m = String(date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

// Dirección del pedido en renglones de texto. Sin escapar: React lo hace solo; en las impresiones hay que
// pasarlos por esc().
export function shippingAddressLines(address) {
  if (!address) return [];
  const flat = [address.floor ? `Piso ${address.floor}` : "", address.apartment ? `Dpto ${address.apartment}` : ""].filter(Boolean).join(" ");
  const province = PROVINCES.find((p) => p.code === address.provinceCode)?.name || "";
  return [
    `${address.streetName || ""} ${address.streetNumber || ""}`.trim() + (flat ? `, ${flat}` : ""),
    [address.city, province].filter(Boolean).join(", ") + (address.postalCode ? ` · CP ${address.postalCode}` : ""),
    address.references ? `Indicaciones: ${address.references}` : "",
    address.recipientName ? `Recibe: ${address.recipientName}` : "",
  ].filter(Boolean);
}

// La dirección que corresponde mostrar según cómo se entrega hoy el pedido. Si el admin cambió el método,
// lo que cargó el cliente sigue guardado (por si vuelve atrás), pero no se muestra una entrega que ya no va:
// sin dirección en el retiro, sin zona ni día de la moto en el correo.
export function deliveryAddressOf(order) {
  const address = order?.shippingAddress;
  if (!address || order.shippingMethod === "RETIRO") return null;
  if (order.shippingMethod === "MOTO") return address;
  const { zoneId, zoneName, deliveryDate, reviewCity, ...rest } = address;
  return rest;
}

// Lo que se le muestra al cliente de la moto: "hoy" si compra antes de la hora de corte, si no el próximo
// día de reparto. Sale de la cotización (delivery = { label, sameDay, cutoffTime }).
export function motoDeliveryText(delivery) {
  if (!delivery) return "";
  return delivery.sameDay
    ? `Llega hoy si comprás antes de las ${delivery.cutoffTime} hs`
    : `Llega ${delivery.label}`;
}
