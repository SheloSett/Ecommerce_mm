const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const SITE_URL = (process.env.FRONTEND_URL || "https://igwtstore.com.ar").split(",")[0].trim();

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripHtml(html) {
  return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// GET /api/sitemap.xml — sitemap dinámico: páginas estáticas + un <url> por cada producto activo
async function getSitemap(req, res) {
  try {
    const products = await prisma.product.findMany({
      where: { active: true, visibility: { in: ["AMBOS", "MINORISTA"] } },
      select: { id: true, slug: true, updatedAt: true },
    });

    const staticPages = [
      { loc: "/", priority: "1.0", changefreq: "daily" },
      { loc: "/catalogo", priority: "0.9", changefreq: "daily" },
      { loc: "/login", priority: "0.3", changefreq: "monthly" },
      { loc: "/registro", priority: "0.4", changefreq: "monthly" },
      { loc: "/como-comprar", priority: "0.3", changefreq: "monthly" },
      { loc: "/sobre-nosotros", priority: "0.3", changefreq: "monthly" },
      { loc: "/terminos", priority: "0.2", changefreq: "yearly" },
      { loc: "/privacidad", priority: "0.2", changefreq: "yearly" },
    ];

    const urls = [
      ...staticPages.map(
        (p) => `  <url>\n    <loc>${SITE_URL}${p.loc}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
      ),
      ...products.map((p) => {
        const loc = `${SITE_URL}/producto/${p.slug || p.id}`;
        const lastmod = p.updatedAt.toISOString().slice(0, 10);
        return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
      }),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    console.error("getSitemap error:", err);
    res.status(500).json({ error: "Error al generar el sitemap" });
  }
}

// GET /api/feed.xml — feed de productos formato Google Merchant (RSS 2.0 + namespace g:).
// Compatible con Google Shopping/Merchant Center y con Meta Commerce Manager (acepta el mismo formato).
async function getProductFeed(req, res) {
  try {
    const products = await prisma.product.findMany({
      where: {
        active: true,
        visibility: { in: ["AMBOS", "MINORISTA"] },
        images: { isEmpty: false },
      },
      orderBy: { id: "asc" },
    });

    const items = products.map((p) => {
      const link = `${SITE_URL}/producto/${p.slug || p.id}`;
      const inStock = p.stockUnlimited || p.stock > 0;
      const price = p.price.toFixed(2);
      const salePrice = p.salePrice && p.salePrice < p.price ? p.salePrice.toFixed(2) : null;
      const description = stripHtml(p.description) || p.name;

      const extraImages = p.images
        .slice(1, 11)
        .map((img) => `      <g:additional_image_link>${escapeXml(img)}</g:additional_image_link>`)
        .join("\n");

      return [
        "    <item>",
        `      <g:id>${p.id}</g:id>`,
        `      <title>${escapeXml(p.name)}</title>`,
        `      <description>${escapeXml(description.slice(0, 5000))}</description>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <g:image_link>${escapeXml(p.images[0])}</g:image_link>`,
        extraImages,
        `      <g:availability>${inStock ? "in stock" : "out of stock"}</g:availability>`,
        `      <g:price>${price} ARS</g:price>`,
        salePrice ? `      <g:sale_price>${salePrice} ARS</g:sale_price>` : "",
        `      <g:condition>new</g:condition>`,
        `      <g:brand>IGWT Store</g:brand>`,
        `      <g:identifier_exists>no</g:identifier_exists>`,
        p.sku ? `      <g:mpn>${escapeXml(p.sku)}</g:mpn>` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>IGWT Store — Catálogo</title>\n    <link>${SITE_URL}</link>\n    <description>Feed de productos de IGWT Store</description>\n${items.join("\n")}\n  </channel>\n</rss>\n`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    console.error("getProductFeed error:", err);
    res.status(500).json({ error: "Error al generar el feed de productos" });
  }
}

module.exports = { getSitemap, getProductFeed };
