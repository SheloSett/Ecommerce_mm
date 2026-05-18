import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import "./index.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  handleReload() {
    // Si hay sesión activa, limpiarla y redirigir al login correspondiente
    const isAdmin = window.location.pathname.startsWith("/admin");
    if (isAdmin) {
      localStorage.removeItem("admin_token");
      localStorage.removeItem("admin_user");
      window.location.href = "/admin/login";
    } else {
      localStorage.removeItem("customer_token");
      localStorage.removeItem("customer_user");
      window.location.href = "/login";
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", fontFamily: "sans-serif" }}>
          <div style={{ textAlign: "center", padding: "40px", background: "#1e293b", borderRadius: "16px", maxWidth: "400px" }}>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>⚠️</div>
            <h2 style={{ color: "#f1f5f9", margin: "0 0 8px" }}>Sesión expirada</h2>
            <p style={{ color: "#94a3b8", margin: "0 0 24px", fontSize: "14px" }}>Tu sesión venció. Ingresá nuevamente para continuar.</p>
            <button
              onClick={() => this.handleReload()}
              style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: "8px", padding: "10px 24px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}
            >
              Ir al login
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
