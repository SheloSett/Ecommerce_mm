const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// visibleFor: mismo criterio que getProducts (product.controller.js) — filtra el conteo de
// variantes según el tipo del cliente dueño de la wishlist.
const PRODUCT_SELECT = (visibleFor) => ({
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
  // _count.variants: variantes ACTIVAS y VISIBLES para este cliente (para el texto del modal
  // "elegí opciones" vs "elegí cantidad" en ProductCard).
  _count: { select: { variants: { where: { active: true, visibility: { in: ["AMBOS", visibleFor] } } } } },
  // attributes: SIN filtrar por visibilidad — solo para derivar hasVariants (ver abajo).
  attributes: { select: { id: true } },
});

// GET /api/wishlist — devuelve los favoritos del cliente autenticado
const getWishlist = async (req, res) => {
  try {
    const visibleFor = req.user.type === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
    const items = await prisma.wishlist.findMany({
      where: { customerId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: { product: { select: PRODUCT_SELECT(visibleFor) } },
    });
    res.json(items.map((i) => {
      const { attributes, ...product } = i.product;
      // hasVariants: si el producto usa variantes, sin importar si son visibles para este cliente.
      // Necesario porque product.stock (del padre) nunca refleja el stock real cuando hay variantes
      // — sin esta señal, ProductCard mostraba "Sin stock" en cualquier producto con variantes
      // guardado en favoritos (mismo bug que ya se corrigió en el listado del catálogo).
      return { ...product, hasVariants: Array.isArray(attributes) && attributes.length > 0 };
    }));
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
