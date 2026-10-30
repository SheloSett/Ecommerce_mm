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
