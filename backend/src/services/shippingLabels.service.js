// Etiquetas de envío: sugerir a qué cliente corresponde una etiqueta importada de BarTender.
//
// Las etiquetas viejas no tienen ningún vínculo con la tienda: son archivos con el nombre del cliente y
// sus datos. Al importarlas se busca el cliente más probable con lo que traen escrito:
//   1. DNI (7 u 8 cifras en los datos) contra el documento de la cuenta (DNI o CUIT, que lo contiene).
//   2. Teléfono (últimos 8 números) contra el de la cuenta.
//   3. Nombre: igual (sin tildes ni mayúsculas) o con al menos dos palabras en común.
// Es una sugerencia: el que importa la confirma o la cambia en la pantalla.

// Remitente por defecto (elegido por el dueño el 18/11/2026). Se puede cambiar en cada etiqueta.
const DEFAULT_SENDER = "LS MARKET SRL\nAV LA PLATA 744 T3 (1235) CABA\nTel (011)5039-5166";

const norm = (s) => (s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Palabras de un nombre que sirven para comparar (sin "ENVIO", tamaños, etc.)
const STOP = new Set(["ENVIO", "ETIQUETA", "ML", "SRL", "SA", "DE", "DEL", "LA", "Y", "10X10", "10X15", "15X10", "X", "CABA"]);
const nameTokens = (s) => norm(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));

const digits = (s) => (s || "").replace(/\D+/g, "");

// DNIs escritos en los datos ("DNI: 32.578.485", "DNi 30589217")
function dnisIn(text) {
  const found = new Set();
  for (const m of (text || "").matchAll(/\b(\d{1,2}\.?\d{3}\.?\d{3})\b/g)) {
    const d = digits(m[1]);
    if (d.length >= 7 && d.length <= 8) found.add(d);
  }
  return [...found];
}

// Teléfonos: tiras de 8 o más números (con guiones, espacios o paréntesis en el medio)
function phonesIn(text) {
  const found = new Set();
  for (const m of (text || "").matchAll(/[\d][\d\s\-()]{7,}\d/g)) {
    const d = digits(m[0]);
    if (d.length >= 8 && d.length <= 13) found.add(d.slice(-8));
  }
  return [...found];
}

// Lo que se compara de cada cliente, calculado una sola vez (la lista de pendientes compara cientos de
// etiquetas contra todos los clientes en el mismo pedido).
function prep(c) {
  if (!c.__p) {
    Object.defineProperty(c, "__p", {
      value: { cuit: digits(c.cuit), phone: digits(c.phone).slice(-8), name: norm(c.name), tokens: new Set(nameTokens(c.name)) },
      enumerable: false,
    });
  }
  return c.__p;
}

// label: { recipientName, recipientDetails }. customers: [{ id, name, phone, cuit, email }].
// Devuelve hasta 3 sugerencias [{ customerId, name, score, reason }], la mejor primero.
function suggestCustomers(label, customers) {
  const dnis = dnisIn(label.recipientDetails);
  const phones = phonesIn(label.recipientDetails);
  const lName = norm(label.recipientName);
  const lTokens = nameTokens(label.recipientName);
  const out = [];
  for (const c of customers) {
    let score = 0;
    let reason = null;
    const p = prep(c);
    const cuit = p.cuit;
    if (cuit && dnis.some((d) => cuit === d || (cuit.length === 11 && cuit.slice(2, 10).replace(/^0/, "") === d.replace(/^0/, "")))) {
      score = 1; reason = "mismo DNI";
    }
    const cPhone = p.phone;
    if (score < 0.9 && cPhone.length === 8 && phones.includes(cPhone)) { score = 0.9; reason = "mismo teléfono"; }
    const cName = p.name;
    if (score < 0.85 && cName && cName === lName) { score = 0.85; reason = "mismo nombre"; }
    if (score < 0.6 && lTokens.length >= 2) {
      const cTokens = p.tokens;
      const common = lTokens.filter((w) => cTokens.has(w)).length;
      if (common >= 2) { score = 0.6 + Math.min(0.2, (common - 2) * 0.1); reason = "nombre parecido"; }
    }
    if (score > 0) out.push({ customerId: c.id, name: c.name, email: c.email, score, reason });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

// Clave para detectar la misma persona en dos archivos (el de 10×10 y el de 10×15)
const personKey = (label) => nameTokens(label.recipientName).sort().join(" ");

module.exports = { DEFAULT_SENDER, suggestCustomers, personKey, dnisIn, phonesIn, norm };
