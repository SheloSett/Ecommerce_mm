import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useCustomerAuth } from "./CustomerAuthContext";
import { notificationsApi } from "../services/api";

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { customer } = useCustomerAuth();
  const [unreadCount, setUnreadCount]       = useState(0);
  const [notifications, setNotifications]   = useState([]);

  const fetchNotifications = useCallback(async () => {
    if (!customer) { setUnreadCount(0); setNotifications([]); return; }
    try {
      const res = await notificationsApi.getMy();
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unreadCount);
    } catch {
      // Falla silenciosa — no bloquear la app por notificaciones
    }
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar al iniciar sesión y hacer polling cada 30s
  useEffect(() => {
    fetchNotifications();
    if (!customer) return;
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Marcar todas como leídas (llamado al abrir la página de cotizaciones)
  const markAllRead = async () => {
    if (!customer || unreadCount === 0) return;
    try {
      await notificationsApi.markAllRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Falla silenciosa
    }
  };

  return (
    <NotificationContext.Provider value={{ unreadCount, notifications, fetchNotifications, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications debe usarse dentro de NotificationProvider");
  return ctx;
}
