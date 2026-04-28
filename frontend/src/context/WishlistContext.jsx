import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useCustomerAuth } from "./CustomerAuthContext";
import { wishlistApi } from "../services/api";

const WishlistContext = createContext(null);
const STORAGE_KEY = "igwt_wishlist_guest";

// Lee la wishlist de invitado (localStorage)
const readGuest = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
};

export function WishlistProvider({ children }) {
  const { customer } = useCustomerAuth();
  const [wishlist, setWishlist] = useState([]);
  const [loading, setLoading] = useState(false);

  // Carga inicial: si hay sesión, traer desde la API; si no, desde localStorage
  useEffect(() => {
    if (customer) {
      setLoading(true);
      wishlistApi.getAll()
        .then((res) => setWishlist(res.data))
        .catch(() => setWishlist([]))
        .finally(() => setLoading(false));
    } else {
      setWishlist(readGuest());
    }
  }, [customer]);

  // Cuando el invitado guarda su lista, persistir en localStorage
  useEffect(() => {
    if (!customer) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wishlist));
    }
  }, [wishlist, customer]);

  const isInWishlist = useCallback(
    (id) => wishlist.some((p) => p.id === id),
    [wishlist]
  );

  const toggle = useCallback(
    async (product) => {
      const already = isInWishlist(product.id);

      if (customer) {
        // Optimistic update
        setWishlist((prev) =>
          already ? prev.filter((p) => p.id !== product.id) : [...prev, product]
        );
        try {
          if (already) {
            await wishlistApi.remove(product.id);
          } else {
            await wishlistApi.add(product.id);
          }
        } catch {
          // Revertir si falló
          setWishlist((prev) =>
            already ? [...prev, product] : prev.filter((p) => p.id !== product.id)
          );
        }
      } else {
        // Invitado: solo localStorage
        setWishlist((prev) =>
          already ? prev.filter((p) => p.id !== product.id) : [...prev, product]
        );
      }
    },
    [customer, isInWishlist]
  );

  const remove = useCallback(
    async (id) => {
      setWishlist((prev) => prev.filter((p) => p.id !== id));
      if (customer) {
        try { await wishlistApi.remove(id); }
        catch { /* el item ya no está en la UI, silenciar el error */ }
      }
    },
    [customer]
  );

  return (
    <WishlistContext.Provider value={{ wishlist, toggle, remove, isInWishlist, loading }}>
      {children}
    </WishlistContext.Provider>
  );
}

export const useWishlist = () => useContext(WishlistContext);
