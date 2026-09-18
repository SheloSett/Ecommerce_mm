const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs");
const { uploadBuffer, deleteByUrl } = require("../config/cloudinary");

const prisma = new PrismaClient();

// Transformación panorámica para banners del hero (1920x600 recomendado).
// crop "limit": solo achica si excede el tamaño, nunca recorta ni rellena —
// a diferencia de la transformación cuadrada usada para fotos de producto.
const SLIDE_EAGER = {
  width: 1920, height: 600,
  crop: "limit",
  quality: "auto",
  fetch_format: "webp",
};

// Versión para celular: vertical o cuadrada (1080×1350 o 1080×1080 recomendado). "limit" solo achica
// si se pasa de ese tamaño; nunca recorta, así se conserva la proporción que eligió quien la diseñó.
const SLIDE_MOBILE_EAGER = {
  width: 1080, height: 1350,
  crop: "limit",
  quality: "auto",
  fetch_format: "webp",
};

// Archivos de la request (upload.fields): { image: [file], mobileImage: [file] }
const fileOf = (req, name) => req.files?.[name]?.[0] || (name === "image" ? req.file : undefined);

// Sube la imagen de celular y devuelve los campos a guardar, con las medidas de la versión final
async function uploadMobile(file) {
  const up = await uploadBuffer(file.buffer, "ecommerce/slides", SLIDE_MOBILE_EAGER);
  const e = up.eager?.[0];
  return {
    mobileImage: up.secure_url,
    mobileWidth: e?.width ?? up.width ?? null,
    mobileHeight: e?.height ?? up.height ?? null,
  };
}

// Borra una imagen de slide: de Cloudinary si es URL, del disco si es un archivo local (slides viejos)
async function removeSlideImage(img) {
  if (!img) return;
  if (img.startsWith("http")) {
    await deleteByUrl(img);
  } else {
    const p = path.join(__dirname, "../../uploads", img);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

// GET /api/slides — Listar slides activos (público, para el carrusel)
async function getSlides(req, res) {
  try {
    const onlyActive = req.query.all !== "true"; // ?all=true para el admin
    const slides = await prisma.slide.findMany({
      where: onlyActive ? { active: true } : {},
      orderBy: { order: "asc" },
    });
    res.json(slides);
  } catch (err) {
    console.error("getSlides error:", err);
    res.status(500).json({ error: "Error al obtener slides" });
  }
}

// POST /api/slides — Crear slide (admin, con imagen)
async function createSlide(req, res) {
  try {
    const { title, subtitle, url, order, active } = req.body;

    const imageFile = fileOf(req, "image");
    if (!imageFile) {
      return res.status(400).json({ error: "La imagen es requerida" });
    }

    const uploaded = await uploadBuffer(imageFile.buffer, "ecommerce/slides", SLIDE_EAGER);
    const mobileFile = fileOf(req, "mobileImage");
    const mobile = mobileFile ? await uploadMobile(mobileFile) : {};

    const slide = await prisma.slide.create({
      data: {
        image: uploaded.secure_url,
        ...mobile,
        title: title || null,
        subtitle: subtitle || null,
        url: url || null,
        order: order !== undefined ? parseInt(order) : 0,
        active: active !== "false" && active !== false,
      },
    });

    res.status(201).json(slide);
  } catch (err) {
    console.error("createSlide error:", err);
    res.status(500).json({ error: "Error al crear slide" });
  }
}

// PATCH /api/slides/:id — Actualizar slide (admin)
async function updateSlide(req, res) {
  try {
    const { id } = req.params;
    const { title, subtitle, url, order, active } = req.body;

    const existing = await prisma.slide.findUnique({ where: { id: parseInt(id) } });
    if (!existing) return res.status(404).json({ error: "Slide no encontrado" });

    const data = {};
    if (title !== undefined) data.title = title || null;
    if (subtitle !== undefined) data.subtitle = subtitle || null;
    if (url !== undefined) data.url = url || null;
    if (order !== undefined) data.order = parseInt(order);
    if (active !== undefined) data.active = active === true || active === "true";

    // Si se subió nueva imagen, subir a Cloudinary y eliminar la anterior
    const imageFile = fileOf(req, "image");
    if (imageFile) {
      const uploaded = await uploadBuffer(imageFile.buffer, "ecommerce/slides", SLIDE_EAGER);
      data.image = uploaded.secure_url;
      // Eliminar imagen anterior: Cloudinary si es URL, disco si es path local (slide viejo)
      await removeSlideImage(existing.image);
    }

    // Versión para celular: nueva (reemplaza a la anterior) o quitada a pedido del admin
    const mobileFile = fileOf(req, "mobileImage");
    if (mobileFile) {
      Object.assign(data, await uploadMobile(mobileFile));
      await removeSlideImage(existing.mobileImage);
    } else if (req.body.removeMobileImage === "true" && existing.mobileImage) {
      await removeSlideImage(existing.mobileImage);
      data.mobileImage = null;
      data.mobileWidth = null;
      data.mobileHeight = null;
    }

    const slide = await prisma.slide.update({
      where: { id: parseInt(id) },
      data,
    });

    res.json(slide);
  } catch (err) {
    console.error("updateSlide error:", err);
    res.status(500).json({ error: "Error al actualizar slide" });
  }
}

// DELETE /api/slides/:id — Eliminar slide (admin)
async function deleteSlide(req, res) {
  try {
    const { id } = req.params;
    const slide = await prisma.slide.findUnique({ where: { id: parseInt(id) } });
    if (!slide) return res.status(404).json({ error: "Slide no encontrado" });

    // Eliminar imágenes: Cloudinary si es URL, disco si es path local (slide viejo)
    await removeSlideImage(slide.image);
    await removeSlideImage(slide.mobileImage);

    await prisma.slide.delete({ where: { id: parseInt(id) } });
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteSlide error:", err);
    res.status(500).json({ error: "Error al eliminar slide" });
  }
}

module.exports = { getSlides, createSlide, updateSlide, deleteSlide };
