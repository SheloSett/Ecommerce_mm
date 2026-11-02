import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { HelmetProvider } from "react-helmet-async";
import App, { PageLoader } from "./App";
import "./index.css";

// Avisa al servidor de un error del navegador (POST /api/events/client-error), que lo registra y le
// manda un email al admin. keepalive: el aviso sale aunque la página se esté recargando.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
function reportClientError(error, extra = "") {
  try {
    fetch(`${API_URL}/api/events/client-error`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: String(error?.message || error).slice(0, 500),
        stack:   String(error?.stack || "").slice(0, 2000) + (extra ? `\n${String(extra).slice(0, 1000)}` : ""),
        url:     window.location.href.slice(0, 300),
      }),
    }).catch(() => {});
  } catch { /* reportar nunca puede romper nada */ }
}

// Después de un deploy, una pestaña abierta con la versión anterior pide archivos de pantallas que ya
// no existen (ver los lazy de App.jsx). Se recarga una vez para traer la versión nueva; la marca en
// sessionStorage evita recargar en bucle si el problema es otro.
// También pasa sin deploy: un corte de internet del visitante en plena descarga cae en este mismo camino.
//
// recargandoPorArchivo: al cancelar el error con preventDefault, Vite le entrega a React.lazy una
// pantalla vacía y React rompe con "Cannot read properties of undefined (reading 'default')" mientras
// la recarga viene en camino. Esa rotura es un efecto de esta recarga, no un error: sin esta marca
// llegaba un email de error falso al admin y el visitante veía "Algo falló" hasta que cargaba la
// página (ver AppErrorBoundary). Si la recarga tampoco alcanza, acá se entra con la marca de
// sessionStorage puesta: no se cancela nada y el error real se muestra y se avisa como siempre.
let recargandoPorArchivo = false;
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem("chunkReload") === "1") return;
    sessionStorage.setItem("chunkReload", "1");
  } catch { /* sin sessionStorage: recargar igual */ }
  recargandoPorArchivo = true;
  event.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => { setTimeout(() => { try { sessionStorage.removeItem("chunkReload"); } catch { /* nada */ } }, 10000); });

// Antes: cualquier error de una pantalla mostraba "Sesión expirada — Tu sesión venció" y el botón
// BORRABA la sesión y mandaba al login. Un bug en una ficha deslogueaba a cada cliente que la abría,
// y el error no quedaba registrado en ningún lado. Ahora dice lo que pasa, lo reporta al servidor y
// el botón solo recarga. La sesión se borra únicamente ante un 401 real (interceptores de api.js).
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error(error);
    if (recargandoPorArchivo) return; // la página ya se está recargando sola: no hay nada que avisar
    reportClientError(error, info?.componentStack);
  }
  render() {
    if (this.state.hasError) {
      if (recargandoPorArchivo) return <PageLoader />; // lo mismo que se ve al cargar cualquier pantalla
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", fontFamily: "sans-serif" }}>
          <div style={{ textAlign: "center", padding: "40px", background: "#1e293b", borderRadius: "16px", maxWidth: "400px" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>⚠️</div>
            <h2 style={{ color: "#f1f5f9", margin: "0 0 8px" }}>Algo falló</h2>
            <p style={{ color: "#94a3b8", margin: "0 0 24px", fontSize: "14px" }}>Ya nos llegó el aviso del error. Probá de nuevo; si sigue pasando, escribinos por WhatsApp.</p>
            <button
              onClick={() => window.location.reload()}
              style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 24px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HelmetProvider>
    <BrowserRouter>
      <AppErrorBoundary>
      <App />
      </AppErrorBoundary>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            borderRadius: "10px",
            background: "#1e293b",
            color: "#f8fafc",
          },
          success: { iconTheme: { primary: "#22c55e", secondary: "#f8fafc" } },
          error: { iconTheme: { primary: "#ef4444", secondary: "#f8fafc" } },
        }}
      />
    </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
);
