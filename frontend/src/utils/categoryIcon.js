// Ícono automático (Material Symbols) de una categoría según su slug. Se usa cuando el admin no
// eligió uno en Admin → Categorías. Antes vivía adentro de Home.jsx; se movió acá para usarlo
// también en la barra inferior del celular (hoja de Categorías).
export function getCategoryIcon(slug) {
  const s = (slug || "").toLowerCase();
  if (s.includes("auricular") || s.includes("audifonos") || s.includes("headphone")) return "headphones";
  if (s.includes("cable"))                                                             return "power";
  if (s.includes("cargador") || s.includes("carga"))                                  return "charging_station";
  if (s.includes("almacenamiento") || s.includes("disco") || s.includes("pendrive") || s.includes("memoria")) return "save";
  if (s.includes("periferico") || s.includes("mouse") || s.includes("teclado"))       return "mouse";
  if (s.includes("accesorio"))                                                         return "devices";
  if (s.includes("parlante") || s.includes("altavoz") || s.includes("bocina") || s.includes("speaker")) return "speaker";
  if (s.includes("adaptador") || s.includes("hub") || s.includes("conversor"))        return "cable";
  if (s.includes("bateria") || s.includes("pila") || s.includes("powerbank"))         return "battery_charging_full";
  if (s.includes("notebook") || s.includes("laptop") || s.includes("computadora") || s.includes("pc")) return "laptop";
  if (s.includes("celular") || s.includes("smartphone") || s.includes("movil"))       return "smartphone";
  if (s.includes("tablet") || s.includes("ipad"))                                     return "tablet";
  if (s.includes("camara") || s.includes("foto") || s.includes("video"))              return "photo_camera";
  if (s.includes("impresora") || s.includes("scanner"))                               return "print";
  if (s.includes("red") || s.includes("router") || s.includes("wifi") || s.includes("ethernet")) return "wifi";
  if (s.includes("monitor") || s.includes("pantalla") || s.includes("display"))      return "monitor";
  if (s.includes("gaming") || s.includes("juego") || s.includes("control") || s.includes("joystick") || s.includes("consola")) return "sports_esports";
  if (s.includes("iluminacion") || s.includes("lampara") || s.includes("luz"))       return "lightbulb";
  if (s.includes("funda") || s.includes("protector") || s.includes("case"))          return "phone_iphone";
  if (s.includes("soporte") || s.includes("stand") || s.includes("base"))            return "precision_manufacturing";
  if (s.includes("limpieza") || s.includes("mantenimiento"))                          return "cleaning_services";
  if (s.includes("audio") || s.includes("microfono") || s.includes("mic"))           return "mic";
  return "devices_other";
}

// Ícono final de una categoría: el elegido en el admin o, si no hay, el automático por nombre.
export function categoryIconName(cat) {
  return (cat && cat.icon) || getCategoryIcon(cat?.slug);
}
