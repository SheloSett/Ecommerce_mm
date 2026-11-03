// "Volver adonde estaba" después de iniciar sesión o crear la cuenta.
//
// Antes el login mandaba siempre al Home (y el registro al catálogo): quien tocaba "Agregar al
// carrito" en un producto sin sesión terminaba lejos de ese producto y tenía que volver a buscarlo, y
// el link "pagá tu cotización" de un email, si la sesión había vencido, dejaba al cliente en el Home.
// Ahora el link al login lleva ?volver=/la/pagina y después de entrar se vuelve ahí.
//
// Solo se aceptan rutas internas de la tienda: un ?volver=https://otro-sitio.com (o //otro-sitio.com)
// se ignora. Si no, cualquiera podría armar un link de login que, después de entrar, mande a una página
// falsa que imite la tienda.

const AUTH_PAGE = /^\/(login|registro)(\/|\?|$)/;

export function withReturnTo(path, location) {
  // Desde el login o el registro se conserva adónde iba. Antes cada pasada de una pantalla a la otra
  // envolvía la dirección dentro de la anterior, y al entrar se perdía el producto: terminaba en el Home.
  if (AUTH_PAGE.test(location?.pathname || "")) {
    const back = safeReturnTo(location.search, "");
    return back ? `${path}?volver=${encodeURIComponent(back)}` : path;
  }
  const here = `${location?.pathname || "/"}${location?.search || ""}`;
  return `${path}?volver=${encodeURIComponent(here)}`;
}

export function safeReturnTo(search, fallback = "/") {
  let target;
  try {
    target = new URLSearchParams(search || "").get("volver");
    // Los links que ya quedaron envueltos traen el destino real adentro: se lo busca.
    for (let i = 0; target && AUTH_PAGE.test(target) && i < 20; i++) {
      target = new URLSearchParams(target.slice(target.indexOf("?") + 1 || target.length)).get("volver");
    }
  } catch { return fallback; }
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return fallback;
  // Volver al login o al registro no tiene sentido (y podría dejar dando vueltas)
  if (AUTH_PAGE.test(target)) return fallback;
  return target;
}
