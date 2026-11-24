// Promos de descuento por monto vigentes (Black Friday, etc.), para el carrito, el checkout y la venta
// manual del panel. Se piden una vez y se reusan entre pantallas por 5 minutos: el carrito lateral, la
// página del carrito y el checkout las usan todos, y no hace falta pedirlas en cada uno.
// Si el pedido falla, la lista queda vacía: el carrito se ve como siempre y el servidor igual aplica la
// promo al crear el pedido.

import { useEffect, useState } from "react";
import { cartPromosApi } from "../services/api";
import { storageGet } from "../utils/storage";

const TTL = 5 * 60 * 1000;
let cache = { at: 0, promise: null, who: null };

// who: con qué sesión se pidieron. Un mayorista que inicia sesión recibe otras promos que el visitante,
// así que al cambiar la sesión se vuelven a pedir sin esperar los 5 minutos.
function loadPromos() {
  const who = `${storageGet("admin_token") || ""}|${storageGet("customer_token") || ""}`;
  if (!cache.promise || Date.now() - cache.at > TTL || cache.who !== who) {
    cache = {
      at: Date.now(),
      who,
      promise: cartPromosApi.getActive().then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
    };
  }
  return cache.promise;
}

export function useCartPromos() {
  const [promos, setPromos] = useState([]);
  useEffect(() => {
    let vivo = true;
    loadPromos().then((p) => { if (vivo) setPromos(p); });
    return () => { vivo = false; };
  }, []);
  return promos;
}
