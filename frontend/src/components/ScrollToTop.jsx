import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Hace scroll al tope de la página cada vez que cambia la ruta.
// Esto soluciona el comportamiento por defecto de React Router que mantiene
// la posición del scroll al navegar entre páginas.
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
