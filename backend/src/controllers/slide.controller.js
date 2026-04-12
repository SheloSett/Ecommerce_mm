const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs");

const prisma = new PrismaClient();

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

    if (!req.file) {
      return res.status(400).json({ error: "La imagen es requerida" });
    }

    const slide = await prisma.slide.create({
      data: {
        image: req.file.filename,
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

    // Si se subió nueva imagen, reemplazar la anterior
    if (req.file) {
      data.image = req.file.filename;
      // Eliminar imagen antigua del filesystem
      const oldPath = path.join(__dirname, "../../uploads", existing.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
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

    // Eliminar imagen del filesystem
    const imgPath = path.join(__dirname, "../../uploads", slide.image);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

    await prisma.slide.delete({ where: { id: parseInt(id) } });
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteSlide error:", err);
    res.status(500).json({ error: "Error al eliminar slide" });
  }
}

module.exports = { getSlides, createSlide, updateSlide, deleteSlide };
