// Nombres de lugares para comparar: sin acentos, sin mayúsculas y con las abreviaturas de siempre escritas
// completas ("Gral. Rodríguez" y "General Rodriguez" son el mismo lugar).

const ABBREVIATIONS = {
  gral: "general", ing: "ingeniero", pte: "presidente", pres: "presidente", alte: "almirante", sta: "santa", sto: "santo",
  tte: "teniente", cnel: "coronel", dr: "doctor", pto: "puerto", cap: "capitan",
};

// "Martínez " → "martinez"
function normalizeName(raw) {
  return String(raw ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").map((word) => ABBREVIATIONS[word] || word).join(" ");
}

module.exports = { normalizeName };
