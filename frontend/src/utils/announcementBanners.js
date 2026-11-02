// Guardado de los banners de anuncio del panel (components/admin/CarouselSectionContent.jsx).
// Funciones puras para poder testearlas sin React (ver announcementBanners.test.js).

// Lista a guardar al prender o apagar un banner: la última guardada con solo ese cambio, así no se publican
// otras ediciones que siguen a medio hacer en pantalla. null si el banner todavía no se guardó nunca.
export function bannerToggled(saved, id, active) {
  if (!saved.some((b) => b.id === id)) return null;
  return saved.map((b) => (b.id === id ? { ...b, active } : b));
}

// ¿Hay algo en pantalla distinto de lo guardado?
export const bannersChanged = (current, saved) => JSON.stringify(current) !== JSON.stringify(saved);
