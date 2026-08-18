const multer = require("multer");
// const path = require("path");  // Ya no se necesita: las imágenes van a Cloudinary, no al disco
// const fs = require("fs");      // Idem
// const { v4: uuidv4 } = require("uuid");  // Idem

// Cloudinary maneja el almacenamiento — los archivos se suben desde memoria (buffer)
// diskStorage reemplazado por memoryStorage para no escribir archivos temporales al disco
const storage = multer.memoryStorage();

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// Formatos de video que Cloudinary procesa sin problema y que los navegadores reproducen.
// quicktime = .mov (lo que graba un iPhone); Cloudinary lo transcodifica a mp4 al servir.
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;    // 5 MB por imagen
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;  // 100 MB por video (tope de Cloudinary en plan free)

function isVideoMime(mimetype) {
  return VIDEO_MIMES.includes(mimetype);
}

// Filtro: solo permite imágenes
function fileFilter(req, file, cb) {
  if (IMAGE_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Solo se permiten imágenes (JPG, PNG, WEBP, GIF)"), false);
  }
}

// Filtro mixto: imágenes o videos. Se usa en las rutas que aceptan ambos (productos, variantes).
function mediaFileFilter(req, file, cb) {
  if (IMAGE_MIMES.includes(file.mimetype) || isVideoMime(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Solo se permiten imágenes (JPG, PNG, WEBP, GIF) o videos (MP4, WEBM, MOV)"), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_IMAGE_BYTES,
  },
});

// Uploader para rutas que aceptan imágenes Y videos.
// El límite de multer tiene que ser el más alto de los dos (no se puede variar por archivo),
// así que se pone en MAX_VIDEO_BYTES y el tamaño real de cada imagen se valida después,
// en verifyMediaBytes, donde ya se sabe si el archivo es imagen o video.
const uploadMedia = multer({
  storage,
  fileFilter: mediaFileFilter,
  limits: {
    fileSize: MAX_VIDEO_BYTES,
  },
});

// ── Verificación de magic bytes ───────────────────────────────────────────────
// El fileFilter de multer solo chequea el mimetype que el cliente declara,
// lo cual se puede falsificar renombrando cualquier archivo a .jpg o similar.
// Esta función lee los primeros 12 bytes del archivo ya guardado en disco y
// los compara contra las firmas reales de los formatos permitidos.

const SIGNATURES = [
  { label: "JPEG",  bytes: [0xFF, 0xD8, 0xFF] },
  { label: "PNG",   bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { label: "GIF87", bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
  { label: "GIF89", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
];

function matchesSignature(buf) {
  // WebP: "RIFF" en bytes 0-3 y "WEBP" en bytes 8-11
  const isWebP =
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  if (isWebP) return true;

  return SIGNATURES.some(({ bytes }) =>
    bytes.every((byte, i) => buf[i] === byte)
  );
}

// Firmas de video. MP4 y MOV comparten el contenedor ISO-BMFF: bytes 4-7 son "ftyp"
// (el tamaño del box ocupa los primeros 4, por eso no se puede matchear desde el byte 0).
// WEBM usa el header de Matroska (EBML): 1A 45 DF A3.
function matchesVideoSignature(buf) {
  const isIsoBmff =
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70; // "ftyp"
  if (isIsoBmff) return true;

  const isMatroska =
    buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
  return isMatroska;
}

// Con memoryStorage los archivos están en file.buffer (RAM), no en disco
// checkMagicBytes ahora recibe el buffer directamente en vez de leer del filesystem
function checkMagicBytes(buffer) {
  try {
    return matchesSignature(buffer);
  } catch {
    return false;
  }
}

function collectFiles(req) {
  return req.files
    ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
    : req.file
    ? [req.file]
    : [];
}

// Middleware: se usa DESPUÉS de upload.single() o upload.array() en las rutas.
// Verifica magic bytes sobre el buffer en RAM — no hay disco involucrado.
function verifyImageBytes(req, res, next) {
  for (const file of collectFiles(req)) {
    if (!file.buffer || !checkMagicBytes(file.buffer)) {
      return res.status(400).json({
        error: `El archivo "${file.originalname}" no es una imagen válida.`,
      });
    }
  }

  next();
}

// Igual que verifyImageBytes pero acepta también videos. Valida contra la firma que
// corresponde al mimetype declarado (un .mp4 renombrado a .jpg no pasa: se chequea
// contra las firmas de imagen y falla). También aplica el límite de 5 MB a las
// imágenes, que multer no pudo aplicar porque su límite está en 100 MB por el video.
function verifyMediaBytes(req, res, next) {
  for (const file of collectFiles(req)) {
    if (!file.buffer) {
      return res.status(400).json({ error: `El archivo "${file.originalname}" está vacío.` });
    }

    if (isVideoMime(file.mimetype)) {
      if (!matchesVideoSignature(file.buffer)) {
        return res.status(400).json({
          error: `El archivo "${file.originalname}" no es un video válido (se aceptan MP4, WEBM y MOV).`,
        });
      }
    } else {
      if (!checkMagicBytes(file.buffer)) {
        return res.status(400).json({
          error: `El archivo "${file.originalname}" no es una imagen válida.`,
        });
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return res.status(400).json({
          error: `La imagen "${file.originalname}" supera el máximo de 5 MB.`,
        });
      }
    }
  }

  next();
}

module.exports = upload;
module.exports.verifyImageBytes = verifyImageBytes;
module.exports.uploadMedia = uploadMedia;
module.exports.verifyMediaBytes = verifyMediaBytes;
module.exports.isVideoMime = isVideoMime;
module.exports.MAX_IMAGE_BYTES = MAX_IMAGE_BYTES;
module.exports.MAX_VIDEO_BYTES = MAX_VIDEO_BYTES;
