// Estilos especiales de los banners de anuncio (components/AnnouncementBar.jsx). Son los de las categorías
// y los de fecha especial de las campañas, en versión finita (.cc-bar en category-cards.css).
// El estilo se guarda en cada banner, dentro del JSON de announcementBanners, como `theme`.
// Función pura para poder testearla sin React (ver bannerTheme.test.js).

export const BANNER_THEMES = [
  { key: "normal",      label: "Normal",       icon: "palette",               hint: "Una barra lisa, con los colores que elijas abajo" },
  { key: "blackfriday", label: "Black Friday", icon: "shopping_bag",          hint: "Negro con letra amarilla y un brillo dorado que cruza" },
  { key: "cybermonday", label: "Cyber Monday", icon: "computer",              hint: "Violeta oscuro con letra de neón y una línea de colores que corre" },
  { key: "fire",        label: "Fuego",        icon: "local_fire_department", hint: "Llamas animadas. Para hot sale u oportunidades" },
  { key: "sale",        label: "Oferta",       icon: "sell",                  hint: "Rojo con un brillo que cruza. Para descuentos y liquidaciones" },
  { key: "fresh",       label: "Nuevo",        icon: "auto_awesome",          hint: "Verde con un brillo que cruza. Para lo recién llegado" },
  { key: "premium",     label: "Premium",      icon: "workspace_premium",     hint: "Negro con líneas doradas. Para líneas caras o de marca" },
  { key: "bolt",        label: "Rayo",         icon: "bolt",                  hint: "Azul eléctrico con relámpagos. Para ofertas relámpago" },
  { key: "neon",        label: "Neón",         icon: "sports_esports",        hint: "Líneas de colores que corren arriba y abajo, estética gamer" },
  { key: "ice",         label: "Congelado",    icon: "ac_unit",               hint: "Azul hielo con copos. Para precios congelados" },
];

// Los banners guardados antes de que existieran los estilos no tienen `theme`: siguen con sus colores.
export const bannerTheme = (banner) =>
  BANNER_THEMES.find((t) => t.key === banner?.theme) || BANNER_THEMES[0];
