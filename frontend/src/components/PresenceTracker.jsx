import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { pingPresence, setPresenceLabel, trackPageView } from "../services/tracking";

const PING_MS = 25 * 1000;

// Etiqueta legible de la página actual para el panel "En vivo" del admin.
// La ficha de producto pisa esto con el nombre del producto (setPresenceLabel desde ProductDetail).
function labelFor(pathname, search) {
  const params = new URLSearchParams(search);
  if (pathname === "/") return "Inicio";
  if (pathname === "/catalogo") {
    const s = params.get("search");
    const c = params.get("category");
    if (s) return `Buscando "${s}"`;
    if (c) return `Catálogo · ${c}`;
    return "Catálogo";
  }
  if (pathname.startsWith("/producto/")) return null; // lo completa ProductDetail
  const fixed = {
    "/carrito": "Carrito", "/checkout": "Checkout", "/login": "Iniciar sesión", "/registro": "Registro",
    "/favoritos": "Favoritos", "/pedidos": "Mis pedidos", "/cotizaciones": "Mis cotizaciones", "/perfil": "Perfil",
    "/sobre-nosotros": "Sobre nosotros", "/como-comprar": "Cómo comprar", "/arrepentimiento": "Arrepentimiento",
  };
  if (fixed[pathname]) return fixed[pathname];
  if (pathname.startsWith("/pago/")) return "Resultado de pago";
  if (pathname.startsWith("/pedidos/")) return "Detalle de pedido";
  if (pathname.startsWith("/pagar-cotizacion/")) return "Pagando cotización";
  return pathname;
}

// Manda una señal de presencia al entrar a cada página y cada 25 s mientras la pestaña está visible.
// No renderiza nada. Vive dentro de PublicRoute, así nunca corre en /admin.
export default function PresenceTracker() {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname + location.search;
    const label = labelFor(location.pathname, location.search);
    setPresenceLabel(label);
    // La ficha de producto pone su nombre apenas carga; el primer ping lleva la ruta igual.
    pingPresence(path);
    // Recorrido del visitante para Analíticas. Producto y búsqueda tienen su propio evento.
    const isProduct = location.pathname.startsWith("/producto/");
    const isSearch = location.pathname === "/catalogo" && new URLSearchParams(location.search).get("search");
    if (!isProduct && !isSearch) trackPageView(path);

    let timer = null;
    const start = () => { if (!timer) timer = setInterval(() => pingPresence(path), PING_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => { if (document.visibilityState === "visible") { pingPresence(path); start(); } else stop(); };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [location.pathname, location.search]);

  return null;
}
