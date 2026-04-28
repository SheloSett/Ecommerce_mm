const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PRODUCT_SELECT = {
  id: true,
  name: true,
  price: true,
  salePrice: true,
  wholesalePrice: true,
  wholesaleSalePrice: true,
  images: true,
  active: true,
  stock: true,
  stockUnlimited: true,
  categories: { select: { id: true, name: true, slug: true } },
};

// GET /api/wishlist — devuelve los favoritos del cliente autenticado
const getWishlist = async (req, res) => {
  try {
    const items = await prisma.wishlist.findMany({
      where: { customerId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: { product: { select: PRODUCT_SELECT } },
    });
    res.json(items.map((i) => i.product));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/wishlist { productId } — agrega si no existe, no hace nada si ya está
const addToWishlist = async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: "productId requerido" });
  try {
    await prisma.wishlist.upsert({
      where: { customerId_productId: { customerId: req.user.id, productId: Number(productId) } },
      update: {},
      create: { customerId: req.user.id, productId: Number(productId) },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/wishlist/:productId — elimina el favorito
const removeFromWishlist = async (req, res) => {
  const productId = Number(req.params.productId);
  try {
    await prisma.wishlist.deleteMany({
      where: { customerId: req.user.id, productId },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getWishlist, addToWishlist, removeFromWishlist };
