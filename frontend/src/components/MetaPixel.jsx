import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSiteConfig } from "../context/SiteConfigContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { configureMetaPixel, pixelPageView } from "../services/metaPixel";

// Carga el Pixel de Meta (si hay uno configurado en Admin → Configuración → Meta / Instagram) y
// manda un PageView en cada cambio de ruta. No renderiza nada. Vive dentro de PublicRoute, así
// nunca corre en /admin. Los demás eventos (ViewContent, AddToCart, InitiateCheckout, Purchase)
// los manda cada página desde services/metaPixel.js.
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

  return null;
}
