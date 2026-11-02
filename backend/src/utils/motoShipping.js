// Envío en moto (CABA y Gran Buenos Aires): en el día o al día siguiente según la hora, con precio por
// zona. Acá están las reglas puras (sin base): qué zona le toca a un código postal, si el CP, la provincia
// y la localidad cierran entre sí, y qué día llega. Las usan la cotización del checkout y createOrder, que
// vuelve a calcular todo: el precio nunca sale de lo que manda el navegador.
//
// La configuración (precios, hora de corte, días de reparto y qué CP va en cada zona) se edita en Admin →
// Configuración → Envíos y se guarda en SiteConfig (ver services/shipping.service.js). Mientras no se haya
// guardado nada rige DEFAULT_MOTO_CONFIG.
//
// Las zonas de partida son las del mapa de la mensajería, partido por partido (CABA va aparte, con su
// precio). El mapa da partidos y el precio sale del CP, así que cada CP va en la zona de su localidad
// principal. Formato de cada renglón: "CP Localidad, Otra localidad" o "CP-CP Nombre" para un rango.
// Los renglones con # son títulos, para que la lista se pueda leer y editar a mano.

const CABA_FROM = 1000;
const CABA_TO = 1499;

const ZONA_1 = `# San Fernando
1644 Victoria
1646 San Fernando, Virreyes
# San Isidro
1607 Villa Adelina
1609 Boulogne
1640 Martínez, Acassuso
1641 Acassuso
1642 San Isidro
1643 Béccar
# Vicente López
1602 Florida
1603 Villa Martelli
1604 Florida Oeste
1605 Munro, Carapachay
1606 Carapachay
1636 Olivos, La Lucila
1637 La Lucila
1638 Vicente López
# General San Martín
1650 San Martín, General San Martín
1651 San Andrés
1653 Villa Ballester
1655 José León Suárez
1672 Villa Lynch
# Tres de Febrero
1657 Pablo Podestá, Loma Hermosa
1674 Sáenz Peña, Villa Raffo
1676 Santos Lugares
1678 Caseros
1682 Villa Bosch, Martín Coronado
1683 Martín Coronado
1702 Ciudadela
# Morón
1684 El Palomar
1685 El Palomar
1706 Haedo
1708 Morón
1712 Castelar
# Hurlingham
1686 Hurlingham, William Morris
1688 Villa Tesei, Tesei
# Ituzaingó
1713 Parque Leloir, Villa Udaondo
1714 Ituzaingó
# La Matanza Norte
1704 Ramos Mejía
1752 Lomas del Mirador
1754 San Justo, Villa Luzuriaga
1766 Tablada, La Tablada
1768 Villa Madero
1770 Aldo Bonzi, Tapiales
1772 Villa Celina
1778 Ciudad Evita
# Lanús
1822 Valentín Alsina, Fiorito, Caraza
1824 Lanús, Lanús Este, Lanús Oeste, Gerli
1825 Monte Chingolo
1826 Remedios de Escalada
# Lomas de Zamora
1773 Ingeniero Budge
1828 Banfield
1832 Lomas de Zamora
1834 Temperley, Turdera
1836 Llavallol
# Avellaneda
1870 Avellaneda, Piñeyro, Gerli
1871 Dock Sud
1872 Sarandí
1874 Villa Domínico
1875 Wilde`;

const ZONA_2 = `# Tigre
1611 Don Torcuato
1617 General Pacheco, Pacheco, El Talar, Ricardo Rojas
1618 El Talar
1621 Benavídez
1648 Tigre
# Malvinas Argentinas
1612 Adolfo Sourdeaux, Sourdeaux
1613 Los Polvorines, Pablo Nogués
1614 Villa de Mayo
1615 Grand Bourg
1616 Ingeniero Pablo Nogués, Pablo Nogués
1667 Tortuguitas, Manuel Alberti
# José C. Paz
1665 José C. Paz
# San Miguel
1659 Campo de Mayo
1661 Bella Vista
1663 San Miguel, Muñiz
# Moreno
1664 Trujui
1742 Paso del Rey
1744 Moreno, La Reja
1746 Francisco Álvarez
# Merlo
1716 Libertad
1718 San Antonio de Padua, Padua
1722 Merlo
1723 Mariano Acosta
1761 Pontevedra
# La Matanza Sur
1755 Rafael Castillo
1757 Laferrere, Gregorio de Laferrere
1759 González Catán
1763 Virrey del Pino
1765 Isidro Casanova
# Ezeiza
1804 Ezeiza, Canning
1806 Tristán Suárez
# Esteban Echeverría
1776 9 de Abril
1838 Luis Guillón
1842 Monte Grande, El Jagüel
# Almirante Brown
1846 Adrogué, José Mármol
1847 Rafael Calzada
1849 Claypole
1852 Burzaco
1854 Longchamps
1856 Glew
# Quilmes
1876 Bernal
1878 Quilmes
1879 Quilmes Oeste
1881 San Francisco Solano, Solano
1882 Ezpeleta
# Berazategui
1884 Berazategui
1885 Plátanos, Guillermo Hudson, Hudson
1886 Ranelagh, Sourigues
1890 Juan María Gutiérrez
1893 Centro Agrícola El Pato, El Pato
# Florencio Varela
1888 Florencio Varela
1889 Bosques
1891 Ingeniero Allan`;

const ZONA_3 = `# Escobar
1619 Garín
1623 Ingeniero Maschwitz, Maschwitz
1625 Belén de Escobar, Escobar
1627 Matheu
# Nordelta
1670 Nordelta
# Pilar
1629 Pilar
1631 Villa Rosa
1633 Fátima
1635 Presidente Derqui, Derqui
1669 Del Viso
# General Rodríguez
1748 General Rodríguez
# Marcos Paz
1727 Marcos Paz
# Guernica y San Vicente
1862 Guernica
1864 Alejandro Korn
1865 San Vicente
# Cañuelas
1812 Máximo Paz, Carlos Spegazzini, Spegazzini
1814 Cañuelas
# La Plata
1894 Villa Elisa
1895 Arturo Seguí
1896 City Bell
1897 Gonnet, Manuel B. Gonnet
1900 La Plata, Tolosa, Los Hornos
1901 Ringuelet, Lisandro Olmos
1903 Melchor Romero, Abasto
# Berisso y Ensenada
1923 Berisso
1925 Ensenada
1931 Punta Lara
# Luján
6700 Luján
6706 Jáuregui
6708 Open Door
# Campana y Zárate
2800 Zárate
2804 Campana`;

const DEFAULT_MOTO_CONFIG = {
  enabled: true,
  // Antes de esta hora (Argentina, "HH:MM") sale en el día; desde esa hora, el próximo día de reparto.
  cutoffTime: "13:30",
  // 0 = domingo … 6 = sábado
  // El sábado la moto solo sale con lo que no pudo entregar el viernes: al cliente no se le promete.
  workDays: [1, 2, 3, 4, 5],
  // Feriados y días sin reparto: "AAAA-MM-DD"
  closedDates: [],
  zones: [
    { id: "caba",  name: "CABA",   price: 4500, postalCodes: "1000-1499 CABA, Capital Federal, Ciudad de Buenos Aires, Ciudad Autónoma de Buenos Aires" },
    { id: "zona1", name: "Zona 1", price: 6200, postalCodes: ZONA_1 },
    { id: "zona2", name: "Zona 2", price: 7800, postalCodes: ZONA_2 },
    { id: "zona3", name: "Zona 3", price: 9200, postalCodes: ZONA_3 },
  ],
};

// Código de provincia del formulario (el mismo que usa Correo Argentino).
const PROVINCE_NAMES = {
  C: "CABA", B: "Buenos Aires", X: "Córdoba", S: "Santa Fe", M: "Mendoza", T: "Tucumán", E: "Entre Ríos", A: "Salta",
  N: "Misiones", W: "Corrientes", H: "Chaco", G: "Santiago del Estero", K: "Catamarca", J: "San Juan", D: "San Luis",
  P: "Formosa", R: "Río Negro", Q: "Neuquén", F: "La Rioja", L: "La Pampa", Y: "Jujuy", U: "Chubut", Z: "Santa Cruz",
  V: "Tierra del Fuego",
};
const PROVINCE_CODES = Object.keys(PROVINCE_NAMES);

// "1425", "C1425ABC", "c 1425" → { cp: 1425, text: "1425", letter: "C" }. null si no es un CP argentino.
function parsePostalCode(raw) {
  const m = String(raw ?? "").trim().toUpperCase().match(/^([A-Z])?\s*(\d{4})\s*([A-Z]{3})?$/);
  if (!m) return null;
  return { cp: parseInt(m[2], 10), text: m[2], letter: m[1] || null };
}

// "Martínez " → "martinez". Para comparar localidades sin que importen acentos ni mayúsculas.
function normalizeName(raw) {
  return String(raw ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ¿El CP cierra con la provincia? null si sí; si no, el mensaje para el cliente. Lo único que se puede
// asegurar sin una tabla de todo el país: CABA usa del 1000 al 1499 y nadie más, y un CP de 8 caracteres
// (C1425ABC) empieza con la letra de su provincia.
function postalCodeProvinceError(parsed, provinceCode) {
  const isCabaCp = parsed.cp >= CABA_FROM && parsed.cp <= CABA_TO;
  if (isCabaCp && provinceCode !== "C") return `El código postal ${parsed.text} es de CABA: revisá la provincia.`;
  if (!isCabaCp && provinceCode === "C") return `CABA usa códigos postales del ${CABA_FROM} al ${CABA_TO}: revisá la provincia o el código postal.`;
  if (parsed.letter && parsed.letter !== provinceCode) return "La letra del código postal no corresponde a esa provincia: revisalo.";
  return null;
}

// Texto del panel → [{ from, to, names }]. errors: los renglones que no se entienden.
function parseZoneAreas(text) {
  const areas = [];
  const errors = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\d{4})(?:\s*-\s*(\d{4}))?(?:\s+(.*))?$/);
    if (!m || (m[2] && parseInt(m[2], 10) < parseInt(m[1], 10))) {
      errors.push(line);
      continue;
    }
    const from = parseInt(m[1], 10);
    areas.push({
      from,
      to: m[2] ? parseInt(m[2], 10) : from,
      names: (m[3] || "").split(",").map(normalizeName).filter(Boolean),
    });
  }
  return { areas, errors };
}

function zonesWithAreas(config) {
  return (config.zones || []).map((zone) => ({ ...zone, areas: parseZoneAreas(zone.postalCodes).areas }));
}

const ymd = (d) => d.toISOString().slice(0, 10);
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Qué día llega si se compra en este momento. Argentina no tiene horario de verano: siempre UTC-3.
// null si en las próximas dos semanas no hay ningún día de reparto (quedó mal cargado).
function deliveryPromise(config, now = new Date()) {
  const today = new Date(now.getTime() - 3 * 60 * 60 * 1000); // sus getUTC* dan la hora argentina
  const closed = new Set(config.closedDates || []);
  const delivers = (d) => (config.workDays || []).includes(d.getUTCDay()) && !closed.has(ymd(d));
  const [cutoffH, cutoffM] = String(config.cutoffTime).split(":").map(Number);
  const beforeCutoff = today.getUTCHours() * 60 + today.getUTCMinutes() < cutoffH * 60 + cutoffM;
  for (let offset = 0; offset <= 14; offset++) {
    if (offset === 0 && !beforeCutoff) continue;
    const day = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
    if (!delivers(day)) continue;
    const label = offset === 0 ? "hoy"
      : offset === 1 ? "mañana"
      : `el ${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()}/${day.getUTCMonth() + 1}`;
    return { date: ymd(day), label, sameDay: offset === 0, cutoffTime: config.cutoffTime };
  }
  return null;
}

// "2026-11-02" → "lunes 2/11", para mails y pantallas.
function formatDeliveryDate(date) {
  const m = String(date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

const SHIPPING_NAMES = {
  RETIRO: "Retiro en el local",
  ENVIO: "Acordar envío",
  CORREO_ARGENTINO: "Envío por correo",
  MOTO: "Envío en moto",
};

// Dirección del pedido en renglones de texto (sin escapar: cada plantilla escapa lo suyo).
function shippingAddressLines(address) {
  if (!address) return [];
  const flat = [address.floor ? `Piso ${address.floor}` : "", address.apartment ? `Dpto ${address.apartment}` : ""].filter(Boolean).join(" ");
  const province = PROVINCE_NAMES[address.provinceCode] || "";
  return [
    `${address.streetName || ""} ${address.streetNumber || ""}`.trim() + (flat ? `, ${flat}` : ""),
    [address.city, province].filter(Boolean).join(", ") + (address.postalCode ? ` · CP ${address.postalCode}` : ""),
    address.references ? `Indicaciones: ${address.references}` : "",
    address.recipientName ? `Recibe: ${address.recipientName}` : "",
  ].filter(Boolean);
}

const unavailable = (code, message) => ({ available: false, code, message });

// Cotización para una dirección: cruza CP, provincia y localidad, y devuelve zona, precio y día de entrega.
//
// La localidad frena solo si es de OTRA zona (CP 1425 con "Pilar"): ahí el precio saldría mal, sea error o
// sea para pagar menos. Si no la conocemos (un barrio, una forma de escribirla que no está en la lista) se
// cotiza igual por el CP y queda marcado para que el panel lo revise: rebotarle la compra a alguien porque
// escribió su barrio sale más caro que mirarlo.
function quoteMoto(config, { postalCode, provinceCode, city } = {}, now = new Date()) {
  if (!config?.enabled) return unavailable("DISABLED", "El envío en moto no está disponible por el momento.");
  const parsed = parsePostalCode(postalCode);
  if (!parsed) return unavailable("INVALID_CP", "Ingresá un código postal válido, por ejemplo 1425.");
  if (provinceCode !== "C" && provinceCode !== "B") {
    return unavailable("OUT_OF_AREA", "El envío en moto es solo para CABA y Gran Buenos Aires.");
  }
  const provinceError = postalCodeProvinceError(parsed, provinceCode);
  if (provinceError) return unavailable("PROVINCE", provinceError);

  const zones = zonesWithAreas(config);
  const zone = zones.find((z) => z.areas.some((a) => parsed.cp >= a.from && parsed.cp <= a.to));
  if (!zone) {
    return unavailable("OUT_OF_AREA", `La moto no llega al código postal ${parsed.text}. Podés elegir el envío por correo o acordar el envío.`);
  }

  const cityName = normalizeName(city);
  let reviewCity = false;
  if (cityName) {
    const inZone = zone.areas.some((a) => a.names.includes(cityName));
    if (!inZone) {
      const other = zones.find((z) => z.id !== zone.id && z.areas.some((a) => a.names.includes(cityName)));
      if (other) {
        return unavailable("CITY_CONFLICT", `El código postal ${parsed.text} es de ${zone.name}, pero la localidad que pusiste es de ${other.name}. Revisá la localidad o el código postal.`);
      }
      // En CABA se escribe el barrio, y los barrios no están en la lista: no hay nada que revisar.
      reviewCity = zone.id !== "caba";
    }
  }

  const delivery = deliveryPromise(config, now);
  if (!delivery) return unavailable("NO_DELIVERY_DAY", "El envío en moto no está disponible por el momento.");
  return { available: true, zoneId: zone.id, zoneName: zone.name, price: zone.price, delivery, reviewCity };
}

// Valida lo que se guarda desde el panel. Devuelve { config } o { error } con un mensaje para el admin.
function validateMotoConfig(input) {
  const cutoffTime = String(input?.cutoffTime ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime)) return { error: "La hora de corte tiene que tener el formato 13:30" };
  const workDays = [...new Set(Array.isArray(input?.workDays) ? input.workDays.map(Number) : [])].sort();
  if (workDays.length === 0 || workDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { error: "Elegí al menos un día de reparto" };
  const closedDates = [...new Set(Array.isArray(input?.closedDates) ? input.closedDates.map((d) => String(d).trim()).filter(Boolean) : [])].sort();
  if (closedDates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return { error: "Los días sin reparto tienen que ser fechas" };
  if (!Array.isArray(input?.zones) || input.zones.length === 0 || input.zones.length > 12) return { error: "Tiene que haber entre 1 y 12 zonas" };

  const zones = [];
  const usedBy = []; // { from, to, zone } para detectar un CP en dos zonas
  for (const raw of input.zones) {
    const name = String(raw?.name ?? "").trim();
    if (!name || name.length > 40) return { error: "Cada zona necesita un nombre (hasta 40 caracteres)" };
    // Number("") da 0: un campo vaciado por error dejaría la zona con envío gratis.
    const price = String(raw?.price ?? "").trim() === "" ? NaN : Number(raw.price);
    if (!Number.isFinite(price) || price < 0) return { error: `Precio inválido en ${name}` };
    const postalCodes = String(raw?.postalCodes ?? "");
    if (postalCodes.length > 20000) return { error: `La lista de ${name} es demasiado larga` };
    const { areas, errors } = parseZoneAreas(postalCodes);
    if (errors.length > 0) return { error: `${name}: no se entiende el renglón "${errors[0].slice(0, 60)}". El formato es "1708 Morón, Haedo".` };
    for (const area of areas) {
      const clash = usedBy.find((u) => area.from <= u.to && area.to >= u.from);
      if (clash) return { error: `El código postal ${Math.max(area.from, clash.from)} está en ${clash.zone} y en ${name}: tiene que estar en una sola zona.` };
    }
    // Se comparan contra las zonas ANTERIORES: repetir un CP dentro de la misma zona no molesta.
    usedBy.push(...areas.map((a) => ({ from: a.from, to: a.to, zone: name })));
    const id = String(raw?.id ?? "").trim().slice(0, 40) || normalizeName(name).replace(/ /g, "-");
    zones.push({ id, name, price, postalCodes });
  }
  if (new Set(zones.map((z) => z.id)).size !== zones.length) return { error: "Hay dos zonas con el mismo nombre" };

  return { config: { enabled: input.enabled !== false, cutoffTime, workDays, closedDates, zones } };
}

// Dirección que llega del checkout → la que se guarda en el pedido. Solo los campos conocidos, recortados.
// Devuelve { address } o { error }.
function sanitizeShippingAddress(raw) {
  const text = (value, max) => (typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "");
  const address = {
    streetName:    text(raw?.streetName, 100),
    streetNumber:  text(raw?.streetNumber, 10),
    floor:         text(raw?.floor, 10),
    apartment:     text(raw?.apartment, 10),
    city:          text(raw?.city, 80),
    provinceCode:  text(raw?.provinceCode, 1).toUpperCase(),
    postalCode:    text(raw?.postalCode, 10),
    references:    text(raw?.references, 200), // entre calles, timbre, etc.
    recipientName: text(raw?.recipientName, 100), // si recibe otra persona
  };
  if (address.streetName.length < 2 || !address.streetNumber) return { error: "Completá la calle y el número de la dirección de entrega" };
  if (address.city.length < 2) return { error: "Completá la localidad de la dirección de entrega" };
  if (!PROVINCE_CODES.includes(address.provinceCode)) return { error: "Elegí la provincia de la dirección de entrega" };
  const parsed = parsePostalCode(address.postalCode);
  if (!parsed) return { error: "Ingresá un código postal válido, por ejemplo 1425" };
  const provinceError = postalCodeProvinceError(parsed, address.provinceCode);
  if (provinceError) return { error: provinceError };
  address.postalCode = parsed.text;
  return { address };
}

module.exports = {
  DEFAULT_MOTO_CONFIG,
  PROVINCE_CODES,
  SHIPPING_NAMES,
  formatDeliveryDate,
  shippingAddressLines,
  parsePostalCode,
  normalizeName,
  postalCodeProvinceError,
  parseZoneAreas,
  deliveryPromise,
  quoteMoto,
  validateMotoConfig,
  sanitizeShippingAddress,
};
