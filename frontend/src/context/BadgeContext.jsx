import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ordersApi } from "../services/api";

const BadgeContext = createContext({
  badges: { cotizaciones: 0, devoluciones: 0, clientes: 0, solicitudesMayorista: 0 },
  fetchBadges: () => {},
  decrementBadge: () => {},
});

export function BadgeProvider({ children }) {
  const [badges, setBadges] = useState({
    cotizaciones: 0, devoluciones: 0, clientes: 0, solicitudesMayorista: 0,
  });

  const fetchBadges = useCallback(() => {
    ordersApi.getBadgeCounts()
      .then((res) => setBadges(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchBadges();
    const interval = setInterval(fetchBadges, 60000);
    return () => clearInterval(interval);
  }, [fetchBadges]);

  // Decrementa un contador localmente de forma instantánea
  const decrementBadge = useCallback((key) => {
    setBadges((prev) => ({ ...prev, [key]: Math.max(0, (prev[key] || 0) - 1) }));
  }, []);

  return (
    <BadgeContext.Provider value={{ badges, fetchBadges, decrementBadge }}>
      {children}
    </BadgeContext.Provider>
  );
}

export const useBadges = () => useContext(BadgeContext);
