import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useCustomerAuth } from "./CustomerAuthContext";
import { cartsApi } from "../services/api";

const CartContext = createContext(null);

// Convierte un CartItem de la BD al formato interno del carrito
// cartItemId: ID del registro en BD (para PATCH/DELETE via API)
// id: productId (para deduplicación y compatibilidad con componentes existentes)
const mapItem = (dbItem) => ({
  cartItemId: dbItem.id,
  id:         dbItem.productId,
  name:       dbItem.name,
  price:      dbItem.price,
  quantity:   dbItem.quantity,
  image:      dbItem.image,
  images:     dbItem.image ? [dbItem.image] : [],
  stock:      dbItem.product?.stock ?? -1,
  // ivaRate: alícuota del producto (10.5 o 21%). Default 21 si no viene del backend.
  ivaRate:    dbItem.product?.ivaRate ?? 21,
});

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

  // Fetch del carrito desde el backend (fuente de verdad)
  const fetchCart = useCallback(async () => {
    if (!customer) { setItems([]); return; }
    try {
      const res = await cartsApi.getMe();
      setItems(res.data ? res.data.items.map(mapItem) : []);
    } catch {
      setItems([]);
    }
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar de usuario (login/logout), cargar el carrito desde el backend
  useEffect(() => {
    fetchCart();
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conexión SSE: recibir cambios del admin en tiempo real
  // Cuando el admin modifica o limpia el carrito, re-fetcheamos desde el backend
  useEffect(() => {
    if (!customer) return;
    const token = localStorage.getItem("customer_token");
    if (!token) return;

    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
    const es = new EventSource(`${API_URL}/api/carts/sse?token=${encodeURIComponent(token)}`);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "cart_cleared" || data.type === "cart_updated") {
          // Re-fetch en lugar de intentar reconstruir el estado desde el evento
          fetchCart();
        }
      } catch {
        // Ignorar mensajes malformados
      }
    };

    // Si la conexión SSE falla, falla silenciosamente
    es.onerror = () => es.close();

    return () => es.close();
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Agrega un item al carrito — llama directo al backend sin localStorage
  // priceOverride: si se pasa, usa ese precio en vez del precio efectivo (para descuentos por cantidad)
  const addItem = async (product, quantity = 1, priceOverride = null) => {
    if (!customer) return;
    const effectivePrice = priceOverride !== null ? priceOverride : getEffectivePrice(product);
    setLoading(true);
    try {
      const res = await cartsApi.addItem({
        productId: product.id,
        quantity,
        name:      product.name,
        price:     effectivePrice,
        image:     product.images?.[0] || null,
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
    setLoading(true);
    try {
      const res = await cartsApi.updateMyItem(cartItemId, quantity);
      setItems(res.data ? res.data.items.map(mapItem) : []);
    } catch (err) {
      console.error("Error al actualizar cantidad:", err);
    } finally {
      setLoading(false);
    }
  };

  // Elimina un item del carrito — usa cartItemId (ID del registro en BD)
  const removeItem = async (cartItemId) => {
    setLoading(true);
    try {
      const res = await cartsApi.removeMyItem(cartItemId);
      setItems(res.data ? res.data.items.map(mapItem) : []);
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
      for (const item of orderItems) {
        // Omitir productos que ya no existen o están desactivados
        if (!item.product?.active) continue;

        const effectivePrice = getEffectivePrice(item.product);
        await cartsApi.addItem({
          productId: item.productId,
          quantity: item.quantity,
          name: item.product.name,
          price: effectivePrice,
          image: item.product.images?.[0] || null,
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
    if (!customer) return;
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
