// Aviso de costo mayor que el precio de venta (26/11/2026). Pasó con un cargador: el costo quedó cargado en
// $ 45.000 en vez de $ 4.500 (se vendía a $ 6.599) y el pedido #281 mostraba $ 12.266 de ganancia en vez de
// $ 295.766. Ahora se avisa al cargar el costo del producto (ficha y alta), al modificar un pedido, en la
// cotización y en el detalle del pedido. Solo avisa, no frena nada: puede haber una venta a pérdida a
// propósito (liquidar algo). Funciones puras, con tests en costCheck.test.js.

// { cost, price, ceroDeMas } si el costo es MAYOR que el precio; si no, null. Un valor vacío, en 0 o que no
// es número no se compara (no hay nada que avisar). ceroDeMas: el error típico (45.000 por 4.500): el costo
// es por lo menos el doble del precio y con un cero menos ya no lo superaría. Si apenas lo pasa (8.000
// contra 6.599) no se sugiere, porque ahí no es un cero.
export function costoSobrePrecio(cost, price) {
  const c = Number(cost);
  const p = Number(price);
  if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0 || p <= 0 || c <= p) return null;
  return { cost: c, price: p, ceroDeMas: c >= 2 * p && c / 10 <= p };
}

// Ficha del producto: los precios cargados que quedan por debajo del costo.
// prices: [{ label, value }] (los vacíos se ignoran). Devuelve [{ label, price }] y ceroDeMas si en todos
// los casos el costo con un cero menos alcanzaría.
export function preciosBajoCosto(cost, prices) {
  const bajos = [];
  let ceroDeMas = true;
  for (const x of prices || []) {
    const hit = costoSobrePrecio(cost, x?.value);
    if (!hit) continue;
    bajos.push({ label: x.label, price: hit.price });
    if (!hit.ceroDeMas) ceroDeMas = false;
  }
  return { bajos, ceroDeMas: bajos.length > 0 && ceroDeMas };
}
