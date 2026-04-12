import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useCustomerAuth } from "./CustomerAuthContext";
import { notificationsApi } from "../services/api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

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

  useEffect(() => {
    // Sin cliente logueado: limpiar estado y cerrar SSE
    if (!customer) {
      setUnreadCount(0);
      setNotifications([]);
      closeSSE();
      return;
    }

    const token = localStorage.getItem("customer_token");
    if (!token) return;

    // Abrir conexión SSE — el servidor enviará las notificaciones existentes como primer evento
    // y luego pusheará nuevas en tiempo real sin necesidad de polling
    const url = `${API_URL}/api/notifications/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "init") {
          // Primer evento: estado completo de notificaciones al conectar
          setNotifications(data.notifications);
          setUnreadCount(data.unreadCount);
        } else if (data.type === "notification") {
          // Nueva notificación pusheada en tiempo real
          setNotifications((prev) => [data.notification, ...prev].slice(0, 50));
          setUnreadCount((prev) => prev + 1);
        }
      } catch {
        // Ignorar mensajes malformados
      }
    };

    es.onerror = () => {
      // El EventSource tiene reconexión automática integrada en el browser.
      // No hacemos nada manual; si el servidor cae, el browser reintentará solo.
    };

    return () => {
      closeSSE();
    };
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
