// URL de una foto de Cloudinary a otro tamaño: cuadrada, con fondo blanco como la versión guardada,
// formato y calidad automáticos. La usa getImageUrl (services/api.js); vive acá, sin dependencias, para
// poder testearla. Las URLs que no son de Cloudinary se devuelven tal cual.
export function cloudinarySized(url, size) {
  if (!url || !size || !url.includes("res.cloudinary.com/") || !url.includes("/image/upload/")) return url;
  const [base, rest] = url.split("/image/upload/");
  const parts = rest.split("/");
  // El primer tramo después de /upload/ es la transformación de la versión guardada
  // (ej. "c_pad,b_white,h_1200,w_1200,..."); si es la versión ("v123") no hay transformación.
  const hasTransform = parts[0].includes("_") && !/^v\d+$/.test(parts[0]);
  const transform = `c_pad,b_white,w_${size},h_${size},q_auto,f_auto`;
  return `${base}/image/upload/${transform}/${(hasTransform ? parts.slice(1) : parts).join("/")}`;
}

// URL de un banner del carrusel (flyer ancho) a `width` de ancho como máximo, sin recortar ni rellenar
// y con la mejor calidad automática. Se arma desde el ORIGINAL que guarda Cloudinary, así mejora también
// los slides ya subidos sin volver a cargarlos.
//
// Por qué (23/11/2026, "los flyers del inicio se ven pixelados"): la versión guardada al subir era
// c_limit,w_1920,h_600,q_auto. Los diseños miden 1920×640, así que el tope de 600 de alto los achicaba a
// 1800×600 y en una pantalla de 1920 el navegador los volvía a estirar; y q_auto los comprimía de ~500 KB
// a ~55 KB, que en letras de colores y degradés se ve como ruido. Con q_auto:best y solo tope de ancho,
// queda prácticamente igual al PNG original (~100 KB).
export function cloudinaryBanner(url, width) {
  if (!url || !width || !url.includes("res.cloudinary.com/") || !url.includes("/image/upload/")) return url;
  const [base, rest] = url.split("/image/upload/");
  const parts = rest.split("/");
  // Mismo criterio que cloudinarySized: el primer tramo es la transformación guardada, salvo que sea la versión
  const hasTransform = parts[0].includes("_") && !/^v\d+$/.test(parts[0]);
  const transform = `c_limit,w_${width},q_auto:best,f_auto`;
  return `${base}/image/upload/${transform}/${(hasTransform ? parts.slice(1) : parts).join("/")}`;
}
