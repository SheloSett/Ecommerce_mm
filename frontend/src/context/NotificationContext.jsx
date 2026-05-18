import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useCustomerAuth } from "./CustomerAuthContext";
import { notificationsApi } from "../services/api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Rutas donde el cliente está mirando notificaciones (cotizaciones, pedidos): ahí abrimos SSE
// para tener push en tiempo real. En el resto de la app polling cada 60s es suficiente.
const REALTIME_NOTIF_PATHS = ["/cotizaciones", "/pedidos", "/cuenta"];

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { customer } = useCustomerAuth();
  const [unreadCount, setUnreadCount]     = useState(0);
  const [notifications, setNotifications] = useState([]);
  const eventSourceRef = useRef(null);

  // Cierra la conexión SSE activa si hay una
  function closeSSE() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  // Polling de fondo: fetch inicial + cada 60s + al volver a la pestaña.
  // Cubre todas las páginas. En las rutas críticas, además, se abre SSE para push instantáneo.
  useEffect(() => {
    if (!customer) {
      setUnreadCount(0);
      setNotifications([]);
      closeSSE();
      return;
    }

    const doFetch = async () => {
      try {
        const res = await notificationsApi.getMy();
        setNotifications(res.data.notifications);
        setUnreadCount(res.data.unreadCount);
      } catch {
        // Falla silenciosa
      }
    };

    doFetch();
    const interval = setInterval(doFetch, 60000);
    const onFocus  = () => doFetch();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE solo en rutas donde el usuario está mirando notificaciones — fuera de ahí se cierra
  // para no ocupar un slot del pool HTTP/1.1 del browser (límite 6 por origen).
  const location = useLocation();
  const needsRealtimeNotif = REALTIME_NOTIF_PATHS.some((p) => location.pathname.startsWith(p));
  useEffect(() => {
    if (!customer || !needsRealtimeNotif) {
      closeSSE();
      return;
    }

    const token = localStorage.getItem("customer_token");
    if (!token) return;

    const url = `${API_URL}/api/notifications/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "init") {
          setNotifications(data.notifications);
          setUnreadCount(data.unreadCount);
        } else if (data.type === "notification") {
          setNotifications((prev) => [data.notification, ...prev].slice(0, 50));
          setUnreadCount((prev) => prev + 1);
        }
      } catch {
        // Ignorar mensajes malformados
      }
    };

    es.onerror = () => {
      // El browser reintenta automáticamente
    };

    return () => closeSSE();
  }, [customer?.id, needsRealtimeNotif]); // eslint-disable-line react-hooks/exhaustive-deps

  // Marcar todas como leídas (llamado al abrir la página de cotizaciones)
  const markAllRead = useCallback(async () => {
    if (!customer || unreadCount === 0) return;
    try {
      await notificationsApi.markAllRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      // Falla silenciosa
    }
  }, [customer, unreadCount]);

  // fetchNotifications: se mantiene como fallback por si algún componente lo llama directamente
  // pero ya no es necesario para el flujo normal — SSE lo cubre
  const fetchNotifications = useCallback(async () => {
    if (!customer) return;
    try {
      const res = await notificationsApi.getMy();
      setNotifications(res.data.notifications);
      setUnreadCount(res.data.unreadCount);
    } catch {
      // Falla silenciosa
    }
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
