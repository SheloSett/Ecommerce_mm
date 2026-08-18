const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

// Transformación default: pensada para fotos de producto (cuadradas, fondo blanco).
// c_pad: ajusta al cuadrado manteniendo proporción + rellena con fondo blanco.
// webp + q_auto: menor peso sin pérdida visible de calidad.
const PRODUCT_EAGER = {
  width: 1200, height: 1200,
  crop: "pad",
  background: "white",
  quality: "auto",
  fetch_format: "webp",
};

// Sube un buffer a Cloudinary y retorna el secure_url de la versión transformada.
// eager genera la versión procesada de forma síncrona antes de responder.
// eagerTransform: por defecto usa PRODUCT_EAGER (cuadrado); pasar una transformación
// distinta para imágenes con otra proporción (ej. banners panorámicos) evita que
// se recorten/pixelen al forzarlas a un cuadrado que no les corresponde.
function uploadBuffer(buffer, folder = "ecommerce", eagerTransform = PRODUCT_EAGER) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        eager: [eagerTransform],
        eager_async: false,
      },
      (error, result) => {
        if (error) reject(error);
        else {
          const url = result.eager?.[0]?.secure_url ?? result.secure_url;
          console.log("[Cloudinary] URL almacenada:", url);
          resolve({ ...result, secure_url: url });
        }
      }
    );
    stream.end(buffer);
  });
}

// Sube un video a Cloudinary. Va por upload_chunked_stream (no upload_stream) porque
// el endpoint de subida directa corta en 100 MB y un archivo de ese tamaño en una sola
// request se cae por timeout; chunked lo parte en tramos de 20 MB y los reensambla.
// Sin eager: transcodificar un video de forma síncrona haría esperar la request minutos.
// Cloudinary ya sirve el mp4 original y se encarga del streaming.
function uploadVideoBuffer(buffer, folder = "ecommerce") {
  return new Promise((resolve, reject) => {
    // Ojo con el orden de los argumentos: el adaptador v2 del SDK espera (options, callback),
    // al revés que la función v1 subyacente. Igual que upload_stream acá arriba.
    const stream = cloudinary.uploader.upload_chunked_stream(
      {
        folder,
        resource_type: "video",
        chunk_size: 20 * 1024 * 1024,
      },
      (error, result) => {
        if (error) reject(error);
        else {
          console.log("[Cloudinary] Video almacenado:", result.secure_url);
          resolve(result);
        }
      }
    );
    stream.end(buffer);
  });
}

// Extrae el public_id de una URL de Cloudinary para poder eliminarlo.
// Las URLs eager tienen transformaciones antes del version: /upload/{transforms}/v{ts}/{public_id}.ext
// El public_id siempre viene DESPUÉS del segmento v{número}/.
function extractPublicId(url) {
  if (!url || !url.includes("cloudinary.com")) return null;
  const match = url.match(/\/v\d+\/(.+)\.[a-z0-9]+$/i);
  return match ? match[1] : null;
}

// Elimina una imagen o video de Cloudinary a partir de su URL.
// destroy() asume resource_type "image" por defecto: para un video hay que decírselo
// explícitamente o el borrado no encuentra nada. Se detecta por el segmento /video/upload/
// que Cloudinary incluye en las URLs de video.
async function deleteByUrl(url) {
  const publicId = extractPublicId(url);
  if (!publicId) return;
  const resourceType = url.includes("/video/upload/") ? "video" : "image";
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch { /* silencioso: el archivo puede no existir */ }
}

module.exports = { uploadBuffer, uploadVideoBuffer, deleteByUrl };
