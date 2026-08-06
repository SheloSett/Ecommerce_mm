// Formatea un monto según su moneda. Sin conversión: un monto en USD se muestra como "USD X" tal
// cual, nunca como estimado en pesos (ver AVANCES.md — selector de moneda por producto/variante).
// No se usa Intl.NumberFormat con currency:"USD" a propósito: el símbolo resultante ("US$" o "$"
// según locale) puede confundirse con el "$" de pesos — el prefijo "USD " es siempre inequívoco.
export function formatPrice(amount, currency = "ARS") {
  if (currency === "USD") {
    return `USD ${Number(amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(amount ?? 0);
}
