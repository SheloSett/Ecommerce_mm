const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// Configuración del almacenamiento de imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../../uploads"));
  },
  filename: (req, file, cb) => {
    // Nombre único para evitar colisiones
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

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

function checkMagicBytes(filePath) {
  try {
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    return matchesSignature(buf);
  } catch {
    return false;
  }
}

// Middleware: se usa DESPUÉS de upload.single() o upload.array() en las rutas.
// Si algún archivo no pasa la verificación de magic bytes, lo elimina de disco
// y responde 400 para evitar que se almacene contenido malicioso.
function verifyImageBytes(req, res, next) {
  const files = req.files
    ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat())
    : req.file
    ? [req.file]
    : [];

  for (const file of files) {
    if (!checkMagicBytes(file.path)) {
      // Eliminar el archivo inválido antes de responder
      try { fs.unlinkSync(file.path); } catch { /* ya fue borrado o no existe */ }
      return res.status(400).json({
        error: `El archivo "${file.originalname}" no es una imagen válida.`,
      });
    }
  }

  next();
}

module.exports = upload;
module.exports.verifyImageBytes = verifyImageBytes;
