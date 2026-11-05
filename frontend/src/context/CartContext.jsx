import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useCustomerAuth } from "./CustomerAuthContext";
import { cartsApi } from "../services/api";
import { storageGet } from "../utils/storage";
import { guestKey, readGuestCart, writeGuestCart, addGuestLine, setGuestQuantity, removeGuestLine, setGuestPrice, restoreGuestLine } from "../utils/guestCart";

// Rutas donde sí queremos real-time (SSE): el cliente está mirando o editando el carrito,
// así que si el admin lo modifica/limpia debe verse al instante. En el resto de la app
// usamos solo polling cada 30s para no ocupar slots del pool HTTP/1.1.
const REALTIME_CART_PATHS = ["/carrito", "/checkout", "/pagar-cotizacion"];

const CartContext = createContext(null);

// Convierte un CartItem de la BD al formato interno del carrito
// cartItemId: ID del registro en BD (para PATCH/DELETE via API)
// id: productId (para deduplicación y compatibilidad con componentes existentes)
const mapItem = (dbItem) => ({
  cartItemId:   dbItem.id,
  id:           dbItem.productId,
  name:         dbItem.name,
  price:        dbItem.price,
  quantity:     dbItem.quantity,
  image:        dbItem.image,
  images:       dbItem.image ? [dbItem.image] : [],
  stock:        dbItem.product?.stock ?? -1,
  // ivaRate: alícuota del producto (10.5 o 21%). Default 21 si no viene del backend.
  ivaRate:      dbItem.product?.ivaRate ?? 21,
  // currency: moneda efectiva del ítem (variante > producto). GET /me ya la resuelve y la manda
  // en dbItem.currency; el POST de agregar solo trae el campo crudo del producto (sin resolver
  // variante) — se usa como fallback hasta el próximo fetchCart().
  currency:     dbItem.currency ?? dbItem.product?.currency ?? "ARS",
  variantId:    dbItem.variantId    ?? null,
  variantLabel: dbItem.variantLabel ?? null,
  // outOfStock viene del backend: true si el producto/variante no tiene stock
  // o si el producto fue despublicado (active=false). Permite avisar al cliente
  // que un item agregado previamente al carrito ya no se puede comprar.
  outOfStock:   dbItem.outOfStock === true,
  // priceChanged/previousPrice: el precio de este item cambió desde que lo agregó al carrito
  // (típicamente porque terminó una campaña de ofertas). `price` ya viene con el valor VIGENTE
  // —el mismo que va a cobrar el checkout— y previousPrice es el que veía antes, para avisarle
  // en vez de que se entere recién cuando le llega el pedido.
  priceChanged:  dbItem.priceChanged === true,
  previousPrice: dbItem.previousPrice ?? null,
});

// Los ítems de la respuesta del carrito, o ninguno si la respuesta no tiene la forma esperada.
const itemsOf = (data) => (Array.isArray(data?.items) ? data.items.map(mapItem) : []);

export function CartProvider({ children }) {
  const { customer } = useCustomerAuth();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(false);

  // Calcula el precio efectivo según el tipo de cliente:
  // - MAYORISTA: usa wholesaleSalePrice si existe y < wholesalePrice, sino wholesalePrice, sino price
  // - MINORISTA: usa salePrice si existe y < price, sino price
  const getEffectivePrice = useCallback((product) => {
    const isMayorista = customer?.type === "MAYORISTA";
    if (isMayorista && product.wholesalePrice) {
      if (product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice) {
        return product.wholesaleSalePrice;
      }
      return product.wholesalePrice;
    }
    if (!isMayorista && product.salePrice && product.salePrice < product.price) return product.salePrice;
    return product.price;
  }, [customer?.type]);

  // Cada pedido del carrito lleva un número: si mientras viajaba se pidió otro (por ejemplo, el cliente
  // inició sesión), la respuesta vieja se descarta para no pisar el carrito nuevo.
  const fetchSeq = useRef(0);

  // Fetch del carrito desde el backend (fuente de verdad)
  const fetchCart = useCallback(async () => {
    const seq = ++fetchSeq.current;
    // Sin cuenta: el carrito vive en el navegador (utils/guestCart.js) y el servidor le pone nombre, foto,
    // precio de hoy y disponibilidad. Antes: sin cuenta no había carrito (setItems([])).
    if (!customer) {
      const lines = readGuestCart();
      if (lines.length === 0) { setItems([]); return; }
      try {
        const res = await cartsApi.guest(lines);
        if (seq === fetchSeq.current) setItems(itemsOf(res.data));
      } catch { /* sin conexión: queda lo que se estaba mostrando */ }
      return;
    }
    try {
      const res = await cartsApi.getMe();
      if (seq === fetchSeq.current) setItems(itemsOf(res.data));
    } catch {
      if (seq === fetchSeq.current) setItems([]);
    }
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo que el cliente cargó antes de iniciar sesión pasa al carrito de su cuenta (el servidor suma las
  // cantidades si ya lo tenía y pone el precio que le corresponde a esa cuenta).
  const mergeGuestCart = async () => {
    const lines = readGuestCart();
    if (lines.length === 0) return;
    writeGuestCart([]); // se vacía ya: si esto corre dos veces seguidas, la segunda no vuelve a sumar lo mismo
    let guestItems;
    try {
      guestItems = itemsOf((await cartsApi.guest(lines)).data);
    } catch {
      writeGuestCart([...readGuestCart(), ...lines]); // no se pudo consultar: queda para el próximo intento
      return;
    }
    // Lo que no se pudo pasar por un problema pasajero vuelve al carrito del navegador, para no perderlo
    const pending = [];
    for (const it of guestItems) {
      try {
        await cartsApi.addItem({
          productId: it.id, quantity: it.quantity, name: it.name, price: it.price,
          image: it.image, variantId: it.variantId, variantLabel: it.variantLabel,
        });
      } catch (err) {
        // 4xx: a esta cuenta no se le puede vender (lo despublicaron, es para otro tipo de cliente): se
        // descarta. Sin respuesta, un error del servidor, la sesión rechazada o el tope de pedidos son
        // pasajeros: esa línea se guarda para el próximo intento.
        const status = err.response?.status;
        const gone = status >= 400 && status < 500 && status !== 401 && status !== 429;
        const line = lines.find((l) => guestKey(l.productId, l.variantId) === it.cartItemId);
        if (!gone && line) pending.push(line);
      }
    }
    if (pending.length) writeGuestCart([...readGuestCart(), ...pending]);
  };

  // Al cambiar de usuario (login/logout), cargar el carrito que corresponde
  useEffect(() => {
    let cancelled = false;
    // Mientras llega el carrito nuevo no se sigue mostrando el del usuario anterior (al cerrar sesión, el de
    // la cuenta con sus precios; al entrar, el del navegador)
    fetchSeq.current++;
    setItems([]);
    (async () => {
      if (customer) await mergeGuestCart();
      if (!cancelled) fetchCart();
    })();
    return () => { cancelled = true; };
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling de fondo: en cualquier página, refresca el carrito cada 30s y al volver a la pestaña.
  // Esto cubre las páginas donde no abrimos SSE (home, catálogo, etc.).
  // Sin cuenta nadie más cambia el carrito: alcanza con refrescar al volver a la pestaña (precios y stock).
  useEffect(() => {
    const interval = customer ? setInterval(fetchCart, 30000) : null;
    const onFocus  = () => fetchCart();
    window.addEventListener("focus", onFocus);
    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guarda el carrito sin cuenta y lo vuelve a pedir al servidor (cambio de cantidad o sacar una línea).
  // key: la línea que se tocó; el precio que responda el servidor queda como su "precio al agregar".
  const changeGuestCart = async (lines, key) => {
    writeGuestCart(lines);
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const list = lines.length ? itemsOf((await cartsApi.guest(lines)).data) : [];
      const touched = list.find((i) => i.cartItemId === key);
      if (touched) writeGuestCart(setGuestPrice(readGuestCart(), key, touched.price));
      if (seq === fetchSeq.current) setItems(list);
    } catch (err) {
      console.error("Error al actualizar el carrito:", err);
      // Sin conexión: el cambio se refleja igual, con lo que ya se estaba mostrando
      const qty = new Map(lines.map((l) => [guestKey(l.productId, l.variantId), l.quantity]));
      setItems((prev) => prev.filter((i) => qty.has(i.cartItemId)).map((i) => ({ ...i, quantity: qty.get(i.cartItemId) })));
    } finally {
      setLoading(false);
    }
  };

  // SSE: solo en las rutas críticas (carrito/checkout/pagar) para tener push instantáneo si el
  // admin modifica/limpia el carrito durante el checkout. Fuera de esas rutas el SSE se cierra
  // y libera el slot del pool HTTP/1.1.
  const location = useLocation();
  const needsRealtimeCart = REALTIME_CART_PATHS.some((p) => location.pathname.startsWith(p));
  useEffect(() => {
    if (!customer || !needsRealtimeCart) return;
    const token = storageGet("customer_token");
    if (!token) return;

    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
    const es = new EventSource(`${API_URL}/api/carts/sse?token=${encodeURIComponent(token)}`);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "cart_cleared" || data.type === "cart_updated") {
          fetchCart();
        }
      } catch {
        // Ignorar mensajes malformados
      }
    };

    es.onerror = () => es.close();

    return () => es.close();
  }, [customer?.id, needsRealtimeCart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Agrega un item al carrito — llama directo al backend sin localStorage
  // priceOverride: si se pasa, usa ese precio en vez del precio efectivo (para descuentos por cantidad)
  const addItem = async (product, quantity = 1, priceOverride = null, variantId = null, variantLabel = null) => {
    const effectivePrice = priceOverride !== null ? priceOverride : getEffectivePrice(product);
    // Sin cuenta: se guarda en el navegador. Antes: if (!customer) return; (no se podía agregar nada)
    if (!customer) {
      const key = guestKey(product.id, variantId);
      const before = readGuestCart();
      const previous = before.find((l) => guestKey(l.productId, l.variantId) === key);
      const lines = addGuestLine(before, { productId: product.id, variantId, quantity });
      const fail = (message) => Object.assign(new Error(message), { response: { data: { error: message } } });
      if (!lines.some((l) => guestKey(l.productId, l.variantId) === key)) {
        throw fail("Tu carrito ya tiene muchos productos distintos. Sacá alguno para agregar otro.");
      }
      // Se guarda ya en el navegador: así dos "Agregar" seguidos no se pisan (el segundo ya ve al primero).
      // Si después el servidor dice que no se puede comprar, o no responde, se deshace.
      writeGuestCart(lines);
      const seq = ++fetchSeq.current;
      setLoading(true);
      try {
        const list = itemsOf((await cartsApi.guest(lines)).data);
        const added = list.find((i) => i.cartItemId === key);
        if (!added || added.outOfStock) {
          writeGuestCart(removeGuestLine(readGuestCart(), key));
          throw fail("Este producto ya no está disponible");
        }
        // El precio que respondió el servidor queda como "precio al agregar"
        writeGuestCart(setGuestPrice(readGuestCart(), key, added.price));
        if (seq === fetchSeq.current) setItems(list);
      } catch (err) {
        // Sin respuesta del servidor no se sabe si se puede comprar: la línea vuelve a como estaba
        if (!err.response) writeGuestCart(restoreGuestLine(readGuestCart(), key, previous));
        console.error("Error al agregar item:", err);
        throw err;
      } finally {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    try {
      const res = await cartsApi.addItem({
        productId:    product.id,
        quantity,
        name:         product.name,
        price:        effectivePrice,
        image:        product.images?.[0] || null,
        variantId:    variantId    || null,
        variantLabel: variantLabel || null,
      });
      setItems(res.data.items.map(mapItem));
    } catch (err) {
      console.error("Error al agregar item:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Actualiza la cantidad de un item — usa cartItemId (ID del registro en BD)
  const updateQuantity = async (cartItemId, quantity) => {
    if (!customer) return changeGuestCart(setGuestQuantity(readGuestCart(), cartItemId, quantity), cartItemId);
    setLoading(true);
    try {
      const res = await cartsApi.updateMyItem(cartItemId, quantity);
      setItems(itemsOf(res.data));
    } catch (err) {
      console.error("Error al actualizar cantidad:", err);
    } finally {
      setLoading(false);
    }
  };

  // Elimina un item del carrito — usa cartItemId (ID del registro en BD)
  const removeItem = async (cartItemId) => {
    if (!customer) return changeGuestCart(removeGuestLine(readGuestCart(), cartItemId), cartItemId);
    setLoading(true);
    try {
      const res = await cartsApi.removeMyItem(cartItemId);
      setItems(itemsOf(res.data));
    } catch (err) {
      console.error("Error al eliminar item:", err);
    } finally {
      setLoading(false);
    }
  };

  // Carga los items de un pedido anterior al carrito para "Repetir pedido"
  // Limpia el carrito actual y agrega los items con precios vigentes
  const repeatOrder = async (orderItems) => {
    if (!customer) return;
    setLoading(true);
    try {
      // 1. Limpiar carrito actual
      await cartsApi.clearMyCart();

      // 2. Agregar cada item del pedido con precio efectivo actual
      // isMayorista ya no se usa para decidir las variantes (ahora se usa el flag
      // variantByAdmin del item), pero se deja comentado por si vuelve a hacer falta.
      // const isMayorista = customer?.type === "MAYORISTA";
      for (const item of orderItems) {
        // Omitir productos que ya no existen o están desactivados
        if (!item.product?.active) continue;

        // Precio efectivo según tipo de cliente; si es null/undefined, usa el precio histórico del pedido
        const effectivePrice = getEffectivePrice(item.product) ?? item.price;
        // No copiar la variante si fue asignada por el admin en la cotización (variantByAdmin).
        // Esas variantes las elige el admin al separar el pedido, no el cliente, así que al
        // repetir no deben heredarse. Las variantes que eligió el cliente (variantByAdmin=false)
        // sí se copian, tanto para mayoristas como minoristas.
        const skipVariant = item.variantByAdmin === true;
        await cartsApi.addItem({
          productId:    item.productId,
          quantity:     item.quantity,
          name:         item.product.name,
          price:        effectivePrice,
          image:        item.product.images?.[0] || null,
          variantId:    skipVariant ? null : (item.variantId    || null),
          variantLabel: skipVariant ? null : (item.variantLabel || null),
        });
      }

      // 3. Refrescar el carrito desde el backend
      await fetchCart();
    } catch (err) {
      console.error("Error al repetir pedido:", err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Limpia el carrito completo — usado después del pago en Checkout/PaymentResult
  const clearCart = async () => {
    if (!customer) {
      // Sin cuenta: el carrito es el del navegador
      fetchSeq.current++;
      writeGuestCart([]);
      setItems([]);
      return;
    }
    try {
      await cartsApi.clearMyCart();
    } catch {
      // Falla silenciosa — el estado local se limpia de todas formas
    }
    setItems([]);
  };

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, loading, totalItems, totalPrice, addItem, removeItem, updateQuantity, clearCart, repeatOrder }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de CartProvider");
  return ctx;
}
