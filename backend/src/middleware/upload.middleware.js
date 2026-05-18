const multer = require("multer");
// const path = require("path");  // Ya no se necesita: las imágenes van a Cloudinary, no al disco
// const fs = require("fs");      // Idem
// const { v4: uuidv4 } = require("uuid");  // Idem

// Cloudinary maneja el almacenamiento — los archivos se suben desde memoria (buffer)
// diskStorage reemplazado por memoryStorage para no escribir archivos temporales al disco
const storage = multer.memoryStorage();

// Filtro: solo permite imágenes
function fileFilter(req, file, cb) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Solo se permiten imágenes (JPG, PNG, WEBP, GIF)"), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB máximo por imagen
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

// Con memoryStorage los archivos están en file.buffer (RAM), no en disco
// checkMagicBytes ahora recibe el buffer directamente en vez de leer del filesystem
function checkMagicBytes(buffer) {
  try {
    return matchesSignature(buffer);
  } catch {
    return false;
  }
}

// Middleware: se usa DESPUÉS de upload.single() o upload.array() en las rutas.
// Verifica magic bytes sobre el buffer en RAM — no hay disco involucrado.
function verifyImageBytes(req, res, next) {
  const files = req.files
    ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
    : req.file
    ? [req.file]
    : [];

  for (const file of files) {
    if (!file.buffer || !checkMagicBytes(file.buffer)) {
      return res.status(400).json({
        error: `El archivo "${file.originalname}" no es una imagen válida.`,
      });
    }
  }

  next();
}

module.exports = upload;
module.exports.verifyImageBytes = verifyImageBytes;
