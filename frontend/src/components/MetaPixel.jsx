import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSiteConfig } from "../context/SiteConfigContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { configureMetaPixel, pixelPageView, pixelContact, isWhatsAppLink, clearPixelCurrentProduct } from "../services/metaPixel";

// Carga el Pixel de Meta (si hay uno configurado en Admin → Configuración → Meta / Instagram) y
// manda un PageView en cada cambio de ruta. No renderiza nada. Vive dentro de PublicRoute, así
// nunca corre en /admin. Los demás eventos (ViewContent, AddToCart, InitiateCheckout, Purchase)
// los manda cada página desde services/metaPixel.js.
//
// Contact: acá también se escucha, a nivel documento, el clic en CUALQUIER link a WhatsApp de la
// tienda (el botón flotante, la barra de anuncios, "Cómo comprar", "Ayuda por WhatsApp" del perfil,
// una descripción de producto...) sin tener que tocar cada link. Se usa la fase de captura para
// verlo aunque el link abra una pestaña nueva. Un link con data-meta-contact="off" no cuenta: así
// está marcado el WhatsApp del desarrollador en el pie, que no es una consulta a la tienda.
export default function MetaPixel() {
  const { metaPixelId, metaTrackWholesale } = useSiteConfig();
  const { customer } = useCustomerAuth();
  const location = useLocation();

  // Eventos de compra solo para el público minorista, salvo que el admin pida incluir mayoristas.
  const commerceEvents = metaTrackWholesale || customer?.type !== "MAYORISTA";

  useEffect(() => {
    configureMetaPixel({ pixelId: metaPixelId, commerceEvents });
  }, [metaPixelId, commerceEvents]);

  useEffect(() => {
    if (!metaPixelId) return;
    pixelPageView(location.pathname + location.search);
  }, [metaPixelId, location.pathname, location.search]);

  // Al salir de una ficha de producto, el Contact ya no lleva producto.
  useEffect(() => {
    if (!location.pathname.startsWith("/producto/")) clearPixelCurrentProduct();
  }, [location.pathname]);

  useEffect(() => {
    if (!metaPixelId) return;
    const onClick = (e) => {
      const el = e.target;
      const a = el && typeof el.closest === "function" ? el.closest("a[href]") : null;
      if (!a || a.dataset?.metaContact === "off") return;
      const href = a.getAttribute("href");
      if (!isWhatsAppLink(href)) return;
      pixelContact({ href });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [metaPixelId]);

  return null;
}
