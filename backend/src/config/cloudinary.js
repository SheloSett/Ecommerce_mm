const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

// Sube un buffer a Cloudinary y retorna el secure_url de la versión transformada.
// eager genera la versión procesada de forma síncrona antes de responder.
// c_limit: achica si supera 1200x1200 pero no agranda imágenes más chicas.
// webp + q_auto: menor peso sin pérdida visible de calidad.
function uploadBuffer(buffer, folder = "ecommerce") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        eager: [
          // c_pad: ajusta al cuadrado manteniendo proporción + rellena con fondo blanco
          // Paso 1: encuadrar con fondo blanco en 1200x1200
          // Paso 2: convertir a WebP con calidad automática
          {
            width: 1200, height: 1200,
            crop: "pad",
            background: "white",
            quality: "auto",
            fetch_format: "webp",
          },
        ],
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

// Extrae el public_id de una URL de Cloudinary para poder eliminarlo.
// Las URLs eager tienen transformaciones antes del version: /upload/{transforms}/v{ts}/{public_id}.ext
// El public_id siempre viene DESPUÉS del segmento v{número}/.
function extractPublicId(url) {
  if (!url || !url.includes("cloudinary.com")) return null;
  const match = url.match(/\/v\d+\/(.+)\.[a-z0-9]+$/i);
  return match ? match[1] : null;
}

// Elimina una imagen de Cloudinary a partir de su URL
async function deleteByUrl(url) {
  const publicId = extractPublicId(url);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch { /* silencioso: la imagen puede no existir */ }
}

module.exports = { uploadBuffer, deleteByUrl };
