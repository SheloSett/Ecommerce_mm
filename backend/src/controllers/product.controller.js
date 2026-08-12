const { PrismaClient } = require("@prisma/client");
const path = require("path");
const fs = require("fs");
const { uploadBuffer, deleteByUrl } = require("../config/cloudinary");
// Filtrar por una categoría incluye a toda su descendencia, y la jerarquía ya no está topeada en
// dos niveles, así que la expansión es recursiva. Ver utils/categoryTree.js.
const { descendantIdsBySlugs } = require("../utils/categoryTree");

const prisma = new PrismaClient();

// Campos de uso interno (ubicación en depósito + proveedor) que SOLO el admin debe ver.
// En respuestas públicas (catálogo, detalle para clientes) se eliminan del objeto producto.
const ADMIN_ONLY_PRODUCT_FIELDS = ["module", "shelf", "supplierId", "supplier"];
function stripAdminProductFields(product) {
  if (!product) return product;
  const clone = { ...product };
  for (const f of ADMIN_ONLY_PRODUCT_FIELDS) delete clone[f];
  return clone;
}

// Determina si la request viene de un admin autenticado (token JWT con rol ADMIN/SUPERADMIN).
// Se usa para decidir si exponer o no los campos internos del producto.
function isAdminRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
    return decoded.role === "ADMIN" || decoded.role === "SUPERADMIN";
  } catch {
    return false;
  }
}

// Convierte un texto a slug URL-amigable: "Cargador USB Tipo-C" → "cargador-usb-tipo-c".
// Saca tildes, deja solo alfanumérico + guiones, colapsa guiones y recorta a 80 chars.
function toSlug(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes/diacriticos
    .replace(/[^a-z0-9\s-]/g, "")    // solo letras, números, espacios y guiones
    .trim()
    .replace(/\s+/g, "-")            // espacios → guion
    .replace(/-+/g, "-")            // guiones repetidos → uno solo
    .replace(/^-+|-+$/g, "")        // sin guiones al inicio/fin
    .substring(0, 80)
    .replace(/-+$/g, "");           // por si el corte a 80 dejó un guion colgando
}

// Genera un slug ÚNICO para un producto a partir del nombre. Si ya existe, prueba "-2", "-3", etc.
// excludeId: id del propio producto (en updates) para que no colisione consigo mismo.
async function generateUniqueProductSlug(name, excludeId = null) {
  const base = toSlug(name) || "producto";
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await prisma.product.findFirst({
      where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

// Búsqueda de productos por nombre (y opcionalmente SKU) INSENSIBLE A TILDES y mayúsculas, usando la
// extensión `unaccent` de Postgres (unaccent(name) ILIKE unaccent(term)). Así "camara" encuentra
// "CÁMARA" y viceversa. Devuelve el array de IDs que coinciden, o `null` si la extensión no está
// instalada / falla — en ese caso el caller usa el filtro normal (sensible a tildes) como fallback.
async function searchProductIds(term, { includeSku = false } = {}) {
  const t = (term || "").trim();
  if (!t) return null;
  // Escapar comodines de LIKE para que % y _ del usuario se traten como literales.
  const safe = t.replace(/[\\%_]/g, (m) => "\\" + m);
  const like = `%${safe}%`;
  try {
    const rows = includeSku
      ? await prisma.$queryRaw`SELECT id FROM products WHERE unaccent(name) ILIKE unaccent(${like}) OR sku ILIKE ${like}`
      : await prisma.$queryRaw`SELECT id FROM products WHERE unaccent(name) ILIKE unaccent(${like})`;
    return rows.map((r) => r.id);
  } catch (e) {
    console.warn("searchProductIds: 'unaccent' no disponible, usando fallback sensible a tildes:", e.message);
    return null;
  }
}

// GET /api/products - Listar productos (con filtros opcionales)
async function getProducts(req, res) {
  try {
    const { category, search, featured, page = 1, limit = 20, active, visibleFor, onSale, lowStock, homeOffer, offerId, attrs, sortOrder, sortPrice } = req.query;

    const where = {};

    // Solo mostrar activos en la tienda pública (admin puede ver todos)
    if (active !== undefined) {
      where.active = active === "true";
    } else {
      where.active = true; // Por defecto solo activos
    }

    // Filtrar por visibilidad según el tipo de cliente:
    // MAYORISTA → ve productos con visibility MAYORISTA o AMBOS
    // MINORISTA (o sin sesión) → ve productos con visibility MINORISTA o AMBOS
    if (visibleFor === "MAYORISTA" || visibleFor === "MINORISTA") {
      where.visibility = { in: ["AMBOS", visibleFor] };
    }
    // Si no se envía visibleFor, no se filtra (admin o legacy)

    // Filtrado automático por stock + visibilidad de variantes según tipo de cliente.
    // Para variantes, además del active+stock, también deben ser visibles para el cliente
    // (visibility AMBOS o coincidente con el tipo de cliente).
    if (visibleFor === "MAYORISTA" || visibleFor === "MINORISTA") {
      // Set de visibilidades que el cliente puede ver
      const visibleSet = ["AMBOS", visibleFor];
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { stockUnlimited: true },
            // Sin variantes visibles para este cliente (ej: mayorista con variantes solo-minorista):
            // el producto IGUAL debe aparecer en catálogo/búsqueda para que pueda pedir COTIZACIÓN.
            // El admin le asigna después el/los color(es) y cantidades al aprobar la cotización, y ahí
            // se descuenta el stock. Por eso alcanza con que haya stock EN ALGÚN lado: el base > 0 O
            // alguna variante activa con stock (aunque esa variante no sea visible para este cliente).
            // Antes: { AND: [{ variants: { none: {...} } }, { stock: { gt: 0 } }] }
            //   ↑ exigía stock BASE > 0, pero en productos con variantes el stock base es 0 → el
            //     mayorista nunca veía el producto en el catálogo (solo entrando por la URL directa).
            {
              AND: [
                { variants: { none: { active: true, visibility: { in: visibleSet } } } },
                {
                  OR: [
                    { stock: { gt: 0 } },
                    { variants: { some: { active: true, OR: [{ stockUnlimited: true }, { stock: { gt: 0 } }] } } },
                  ],
                },
              ],
            },
            // Con variantes visibles para este cliente: al menos una con stock
            { variants: { some: { active: true, visibility: { in: visibleSet }, OR: [{ stockUnlimited: true }, { stock: { gt: 0 } }] } } },
          ],
        },
      ];
    }

    if (category) {
      // Soporta múltiples categorías separadas por "|" — ej. ?category=accesorios|cables.
      // Para cada slug se incluyen también TODAS sus subcategorías, hasta el fondo del árbol.
      const slugs = category.split("|").map((s) => s.trim()).filter(Boolean);
      if (slugs.length > 0) {
        // Antes se bajaba un solo nivel a mano:
        //   const cats = await prisma.category.findMany({
        //     where: { slug: { in: slugs } },
        //     include: { children: { select: { id: true } } },
        //   });
        //   const categoryIds = cats.flatMap((c) => [c.id, ...c.children.map((ch) => ch.id)]);
        // Con el anidado libre eso dejaba afuera a los nietos: filtrar por "Audio" no traía lo
        // cargado en "Audio › Auriculares › Inalámbricos". descendantIdsBySlugs baja hasta el final.
        const categoryIds = await descendantIdsBySlugs(prisma, slugs);
        if (categoryIds) {
          where.categories = { some: { id: { in: categoryIds } } };
        } else {
          // Si ninguno de los slugs existe, devolver vacío
          where.categories = { every: { id: -1 }, some: {} };
        }
      }
    }

    if (search) {
      // Búsqueda insensible a tildes vía unaccent (con fallback sensible a tildes si la extensión no está).
      const ids = await searchProductIds(search, { includeSku: true });
      if (ids !== null) {
        where.id = { in: ids };
      } else {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { sku:  { contains: search, mode: "insensitive" } },
        ];
      }
    }

    // Categorías ocultas (hidden=true): sus productos NO se mezclan con el resto en el listado
    // general. Solo se excluyen cuando NO se eligió una categoría y NO hay búsqueda, así:
    //   - eligiendo la categoría oculta → se ven (el filtro de arriba manda)
    //   - buscándolos → se ven
    //   - "Todos los productos" / navegación general → no aparecen
    // Se excluye solo si TODAS sus categorías son ocultas (si además está en una visible, se muestra).
    if (!category && !search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { categories: { none: {} } },                // sin categorías → se muestra
            { categories: { some: { hidden: false } } },  // tiene al menos una categoría visible
          ],
        },
      ];
    }

    if (featured === "true") {
      where.featured = true;
    }

    // homeOffer=true filtra los productos marcados como "Oferta en Home" (campo onSale booleano)
    if (homeOffer === "true") {
      where.onSale = true;
    }

    // offerId=N: productos que forman parte de una campaña de oferta (model Offer). Lo usa el Home
    // para armar la sección de cada campaña vigente. Pasa por acá a propósito, y no por un endpoint
    // aparte, para heredar todo lo que ya resuelve este handler: visibilidad por tipo de cliente,
    // filtro de stock, precio tomado de la primera variante disponible y stripAdminProductFields.
    if (offerId) {
      const oid = parseInt(offerId);
      // Antes: where.offerItems = { some: { offerId: oid } }  ← sin chequear vigencia
      // Este endpoint es PÚBLICO y no valida sesión, así que con el id pelado cualquiera podía pedir
      // ?offerId=N y ver la lista de productos de una campaña PROGRAMADA que todavía no lanzaste (o
      // de una pausada). Ahora la campaña tiene que estar vigente, que es el único caso para el que
      // el Home y el catálogo usan este filtro.
      if (!isNaN(oid)) {
        const nowOffer = new Date();
        where.offerItems = {
          some: {
            offerId: oid,
            offer: { active: true, startsAt: { lte: nowOffer }, endsAt: { gt: nowOffer } },
          },
        };
      }
    }

    // Filtrar solo productos en oferta según el tipo de cliente:
    // - MAYORISTA → solo productos con wholesaleSalePrice (oferta mayorista)
    // - MINORISTA (o sin sesión) → solo productos con salePrice (oferta minorista)
    // Antes filtraba con OR (cualquier oferta), lo que mostraba ofertas minoristas a mayoristas y viceversa.
    if (onSale === "true") {
      if (visibleFor === "MAYORISTA") {
        where.wholesaleSalePrice = { not: null };
      } else {
        where.salePrice = { not: null };
      }
    }

    // Filtrar productos con pocas unidades: stock > 0 y <= 5, no ilimitado
    if (lowStock === "true") {
      where.stockUnlimited = false;
      where.stock = { gt: 0, lte: 5 };
    }

    // Filtrar por atributos de variante: attrs = JSON { "Color": ["Negro", "Rojo"], "Longitud": ["2m"] }
    // AND entre atributos distintos, OR entre valores del mismo atributo
    if (attrs) {
      try {
        const attrsObj = JSON.parse(attrs);
        const attrConditions = Object.entries(attrsObj)
          .filter(([, values]) => Array.isArray(values) && values.length > 0)
          .map(([name, values]) => ({
            attributes: { some: { name, values: { some: { value: { in: values } } } } },
          }));
        if (attrConditions.length > 0) {
          where.AND = [...(where.AND || []), ...attrConditions];
        }
      } catch (e) {
        // JSON inválido, se ignora
      }
    }

    // Antes: const skip = (parseInt(page) - 1) * parseInt(limit);
    // El `limit` venía del query string sin ningún techo: un ?limit=99999 hacía que la ruta pública
    // devolviera el catálogo entero de una. Se acota acá, en un solo lugar, y el resto del handler
    // usa safeLimit/safePage. 100 alcanza de sobra (el catálogo pide 20 y el Home 8).
    const MAX_LIMIT = 100;
    const safeLimit = Math.min(Math.max(parseInt(limit) || 20, 1), MAX_LIMIT);
    const safePage  = Math.max(parseInt(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    // Filtro de variantes contables según tipo de cliente: solo las visibles para él.
    // Si no se envía visibleFor (admin/legacy), cuenta todas las activas.
    const variantsCountWhere = (visibleFor === "MAYORISTA" || visibleFor === "MINORISTA")
      ? { active: true, visibility: { in: ["AMBOS", visibleFor] } }
      : { active: true };

    // Orden del catálogo (mismo criterio que los dropdowns del front): el precio tiene prioridad sobre
    // el orden por nombre/fecha. Default: más nuevo primero. Se ordena en el BACKEND para que funcione
    // con la paginación — antes se ordenaba en el cliente y solo reordenaba la página actual (20 de N).
    //
    // OJO con el precio: NO se puede usar orderBy: { price } de Prisma. El precio que ve el cliente en
    // la card no es la columna `price` del producto — puede venir de la primera variante disponible, de
    // la oferta (salePrice) o de los campos mayoristas, y todo eso se resuelve recién en el .map() de
    // abajo. Ordenar por la columna daba un catálogo visiblemente desordenado (ej: $114.999 antes que
    // $122.499). Por eso, cuando se pide orden por precio, se traen TODOS los productos que matchean,
    // se resuelve el precio mostrado, se ordena en memoria y recién ahí se pagina.
    //
    // TECHO: ordenar por precio obliga a traer los productos sin paginar (hay que resolver el precio
    // de todos antes de saber cuáles entran en la página). Eso no puede ser ilimitado en una ruta
    // pública, así que se acota a los N más nuevos. Si algún día el catálogo pasa de este número, el
    // orden por precio empieza a dejar afuera a los más viejos y hay que cambiar el enfoque: guardar
    // el precio efectivo en una columna del producto (mantenida al guardar producto/variante/oferta)
    // y ordenar con orderBy de Prisma, que es lo único que escala de verdad.
    const PRICE_SORT_MAX_ROWS = 2000;
    const byPrice = sortPrice === "asc" || sortPrice === "desc";
    let orderBy;
    if (sortOrder === "az")          orderBy = { name: "asc" };
    else if (sortOrder === "za")     orderBy = { name: "desc" };
    else if (sortOrder === "oldest") orderBy = { createdAt: "asc" };
    else                             orderBy = { createdAt: "desc" };

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        // Antes: include: { category: { select: { id, name, slug } } }
        include: {
          categories: { select: { id: true, name: true, slug: true } },
          // _count.variants: cuántas variantes visibles para el cliente tiene, para que el
          // frontend decida si mostrar modal de selección o agregar directo desde la card.
          _count: { select: { variants: { where: variantsCountWhere } } },
          // Variantes visibles (solo campos de precio/stock + combination): se usan para que la
          // card muestre el precio de la PRIMERA variante DISPONIBLE, en el mismo orden en que el
          // cliente ve las opciones en el detalle (posición de los valores del atributo — NO por
          // createdAt: al regenerar variantes las fechas quedan desordenadas).
          // Antes la card mostraba el precio base del producto, que podía no corresponder a
          // ninguna variante comprable (ej: base $19.999 pero la única con stock sale $30.999).
          variants: {
            where: variantsCountWhere,
            // `currency: true` se sacó del select: la moneda de la card sale del producto.
            select: { combination: true, price: true, salePrice: true, wholesalePrice: true, wholesaleSalePrice: true, stock: true, stockUnlimited: true },
          },
          // Atributos con sus valores ordenados por posición — solo para ordenar las variantes
          // como en el detalle (se quitan de la respuesta en el map de abajo).
          attributes: {
            select: { name: true, values: { select: { value: true }, orderBy: { position: "asc" } } },
            orderBy: { position: "asc" },
          },
        },
        // Antes: orderBy: { createdAt: "desc" } (fijo). Ahora según sortOrder/sortPrice.
        orderBy,
        // Con orden por precio la paginación se hace en memoria (ver comentario arriba).
        // Antes: ...(byPrice ? {} : { skip, take: parseInt(limit) })
        // Sin `take`, ordenar por precio traía el catálogo COMPLETO con variantes, atributos y
        // categorías en cada request — y /products está exento del rate limiter, así que
        // ?sortPrice=asc en bucle era una forma trivial de voltear el servidor desde afuera.
        // Ahora hay un techo duro: se ordena sobre los PRICE_SORT_MAX_ROWS productos más nuevos.
        ...(byPrice ? { take: PRICE_SORT_MAX_ROWS } : { skip, take: safeLimit }),
      }),
      prisma.product.count({ where }),
    ]);

    // Catálogo público: nunca exponer ubicación de depósito ni proveedor
    // Antes: products: products.map(stripAdminProductFields),
    // Ahora, además, el precio de la card sale de la primera variante DISPONIBLE (en su orden):
    // si la primera no tiene stock se usa la siguiente, etc. Mismo criterio de grupos que el
    // checkout: si la variante define precio base del grupo (min/may), TODO el grupo sale de la
    // variante (su oferta solo si la define — no se hereda la del padre).
    let cards = products.map((p) => {
        const { variants: cardVariants, attributes: cardAttrs, ...rest } = p;
        const out = { ...rest };
        // hasVariants: si el producto tiene atributos/variantes configurados, SIN filtrar por
        // visibilidad (a diferencia de _count.variants, que solo cuenta las visibles para este
        // cliente). Hace falta esta señal aparte porque un producto puede tener TODAS sus variantes
        // restringidas a un tipo de cliente (ej: solo MINORISTA) — para el otro tipo, _count.variants
        // da 0, pero el producto sigue "usando variantes" y su campo stock (del padre) no es
        // confiable (nunca se sincroniza cuando hay variantes). Sin esta señal, la card lo mostraba
        // como "Sin stock" aunque las variantes SÍ tuvieran stock, solo por no ser visibles para el
        // tipo de cliente actual.
        out.hasVariants = Array.isArray(cardAttrs) && cardAttrs.length > 0;
        if (Array.isArray(cardVariants) && cardVariants.length > 0) {
          // Orden "como se ve en el detalle": clave lexicográfica por posición del valor de cada
          // atributo (los atributos y valores ya vienen ordenados por position asc).
          const sortKey = (v) => {
            const combo = Array.isArray(v.combination) ? v.combination : [];
            return (cardAttrs || []).map((a) => {
              const c = combo.find((x) => x.name === a.name);
              const idx = a.values.findIndex((val) => val.value === c?.value);
              return idx === -1 ? 999 : idx;
            });
          };
          const sorted = [...cardVariants].sort((a, b) => {
            const ka = sortKey(a), kb = sortKey(b);
            for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
              const d = (ka[i] ?? 0) - (kb[i] ?? 0);
              if (d !== 0) return d;
            }
            return 0;
          });
          const avail = sorted.find((v) => v.stockUnlimited || v.stock > 0) || sorted[0];
          if (avail.price != null) {
            out.price     = avail.price;
            out.salePrice = avail.salePrice;
          }
          if (avail.wholesalePrice != null) {
            out.wholesalePrice     = avail.wholesalePrice;
            out.wholesaleSalePrice = avail.wholesaleSalePrice;
          }
          // COMENTADO: la moneda ya no viaja con el precio de la variante, porque la variante no
          // tiene moneda propia — define el número, no la unidad. `out.currency` ya trae la del
          // producto (viene en el spread de `rest`), que es la correcta para cualquier precio de
          // este producto, salga de la base o de una variante.
          // if (avail.price != null || avail.wholesalePrice != null) {
          //   out.currency = avail.currency ?? p.currency ?? "ARS";
          // }
        }
        return stripAdminProductFields(out);
    });

    // Orden por precio: se hace acá, sobre el precio YA resuelto (variante + oferta + mayorista),
    // que es exactamente el que muestra la card. Ver ProductCard.jsx → productEffectivePrice.
    if (byPrice) {
      const isMayorista = visibleFor === "MAYORISTA";
      const shownPrice = (p) => {
        if (isMayorista && p.wholesalePrice) {
          return (p.wholesaleSalePrice && p.wholesaleSalePrice < p.wholesalePrice)
            ? p.wholesaleSalePrice
            : p.wholesalePrice;
        }
        return (p.salePrice && p.salePrice < p.price) ? p.salePrice : p.price;
      };
      const dir = sortPrice === "asc" ? 1 : -1;
      cards.sort((a, b) => {
        // Los productos en USD van SIEMPRE primeros, en las dos direcciones del orden. No hay
        // cotización guardada para convertirlos a pesos, así que mezclarlos por su número pelado
        // (ej: USD 575 junto a $575) daría un orden falso; se muestran como bloque arriba de todo.
        // Dentro de cada bloque (USD y ARS) sí se respeta la dirección elegida.
        const aUsd = (a.currency || "ARS") === "USD" ? 1 : 0;
        const bUsd = (b.currency || "ARS") === "USD" ? 1 : 0;
        if (aUsd !== bUsd) return bUsd - aUsd;
        return ((shownPrice(a) ?? 0) - (shownPrice(b) ?? 0)) * dir;
      });
      // Paginación en memoria (la query trajo hasta PRICE_SORT_MAX_ROWS de los que matchean).
      // Antes: cards.slice(skip, skip + parseInt(limit))
      cards = cards.slice(skip, skip + safeLimit);
    }

    // Con orden por precio solo se ordenaron hasta PRICE_SORT_MAX_ROWS productos, así que las páginas
    // que caen más allá de ese techo vendrían vacías. Se acota el total de páginas a las que de verdad
    // tienen contenido, para que el paginador no ofrezca páginas en blanco. `total` se informa real:
    // es la cantidad de productos que matchean el filtro, que es lo que muestra el encabezado.
    const pageableTotal = byPrice ? Math.min(total, PRICE_SORT_MAX_ROWS) : total;

    res.json({
      products: cards,
      pagination: {
        // Antes: page/limit salían del query string sin acotar; ahora se informa lo que se usó de
        // verdad, para que el frontend no calcule páginas con un límite que el backend ignoró.
        total,
        page: safePage,
        limit: safeLimit,
        // Antes: Math.ceil(total / parseInt(limit))
        totalPages: Math.ceil(pageableTotal / safeLimit),
      },
    });
  } catch (err) {
    console.error("getProducts error:", err);
    res.status(500).json({ error: "Error al obtener productos" });
  }
}

// GET /api/products/admin - Listar TODOS los productos para el admin (activos e inactivos)
async function getProductsAdmin(req, res) {
  try {
    const { category, search, page = 1, limit = 50, lowStock, all, inStock } = req.query;
    // all=true: el admin trae TODOS los productos (sin paginar en el server) para que el "Capital total
    // en stock" y los tabs "Sin stock"/"Quiebre de stock" cuenten sobre el total real, no sobre una página.
    // La paginación visual (50 por página) la hace el cliente. Ver AdminProducts.jsx.
    const noPaginate = all === "true";

    const where = {};

    // inStock=true: deja afuera lo que no se puede vender por falta de stock.
    //
    // Lo usa el picker de productos de las campañas de oferta: poner en una campaña algo que está
    // agotado no sirve para nada — el descuento se escribe igual pero el producto no se muestra en
    // la tienda, así que solo ensucia la lista y el conteo de "Agregar todos".
    //
    // "Tiene stock" es el mismo criterio que usa el catálogo para decidir si muestra un producto
    // (publicVisibilityWhere en category.controller.js), sin la parte de visibilidad por tipo de
    // cliente: el stock del producto padre NO alcanza cuando hay variantes, porque en ese caso lo
    // que se vende es la variante. Los tres casos:
    //   1. stock ilimitado a nivel producto,
    //   2. producto SIN variantes activas → vale su propio stock,
    //   3. producto CON variantes activas → vale que al menos una tenga stock.
    //
    // Va en AND para no pisar un where.OR que pueda poner otro filtro más adelante.
    if (inStock === "true") {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { stockUnlimited: true },
            { AND: [{ variants: { none: { active: true } } }, { stock: { gt: 0 } }] },
            { variants: { some: { active: true, OR: [{ stockUnlimited: true }, { stock: { gt: 0 } }] } } },
          ],
        },
      ];
    }

    // Filtro de quiebre de stock: productos donde stock <= stockBreak (y stockBreak está definido)
    if (lowStock === "true") {
      where.stockBreak  = { not: null };
      where.stockUnlimited = false;
      // Prisma no permite comparar dos columnas directamente en where, usamos rawQuery via $queryRaw
      // Lo resolvemos en memoria después del fetch con un límite alto
    }

    if (category) {
      // Soporta múltiples categorías separadas por "|" — ej. ?category=accesorios|cables|cargadores
      // Las relaciones M2M usan "some" con "in" para hacer OR.
      // Para cada slug se incluyen también sus subcategorías, igual que en getProducts (público).
      const slugs = category.split("|").map((s) => s.trim()).filter(Boolean);
      if (slugs.length > 0) {
        // Antes: where.categories = { some: { slug: { in: slugs } } };
        //
        // Filtraba por la categoría EXACTA: elegir "Audio" no traía los productos cargados en
        // "Audio › Auriculares". El admin veía menos productos de los que existen bajo esa rama —
        // en el picker de campañas eso significaba armar una oferta "de Audio" que dejaba afuera
        // todas las subcategorías. El listado público ya expandía a las hijas desde siempre
        // (getProducts, más arriba); esto alinea el endpoint del admin con ese criterio.
        //
        // exactCategory=true conserva el comportamiento viejo. Lo usa el modal "productos
        // vinculados" de AdminCategories, donde el número del badge cuenta SOLO los vínculos
        // directos (_count.products) y la lista tiene que coincidir con ese número.
        if (req.query.exactCategory === "true") {
          where.categories = { some: { slug: { in: slugs } } };
        } else {
          const categoryIds = await descendantIdsBySlugs(prisma, slugs);
          if (categoryIds) {
            where.categories = { some: { id: { in: categoryIds } } };
          } else {
            // Si ninguno de los slugs existe, devolver vacío (mismo truco que en getProducts).
            where.categories = { every: { id: -1 }, some: {} };
          }
        }
      }
    }

    if (search) {
      // Buscar SOLO por título (nombre). Antes también buscaba en la descripción, lo que devolvía
      // productos sin la palabra en el título (ej: "rca" aparecía en la descripción de cables que no
      // son RCA). Si en el futuro se quiere buscar también por SKU, agregar aquí { sku: { contains... } }.
      // Antes:
      // where.OR = [
      //   { name: { contains: search, mode: "insensitive" } },
      //   { description: { contains: search, mode: "insensitive" } },
      // ];
      // Búsqueda insensible a tildes vía unaccent (fallback al filtro por nombre si no está la extensión).
      const ids = await searchProductIds(search, { includeSku: false });
      if (ids !== null) where.id = { in: ids };
      else where.name = { contains: search, mode: "insensitive" };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Para lowStock: Prisma no soporta comparar dos columnas en where,
    // se trae todos los candidatos y se filtra en memoria
    if (lowStock === "true") {
      const candidates = await prisma.product.findMany({
        where,
        // Antes: include: { category: { select: { ... } } }
        include: {
          categories: {
            include: { parent: { select: { id: true, name: true } } },
          },
        },
        orderBy: { stock: "asc" },
      });
      // Solo "Quiebre de stock": stock entre 1 y stockBreak. Si stock == 0 el producto
      // aparece exclusivamente en la pestaña "Sin stock", no acá (antes p.stock <= p.stockBreak
      // incluía los productos sin stock y duplicaba la información entre tabs).
      const filtered = candidates.filter((p) => p.stockBreak !== null && p.stock > 0 && p.stock <= p.stockBreak);
      return res.json({
        products: filtered,
        pagination: { total: filtered.length, page: 1, limit: filtered.length, totalPages: 1 },
      });
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        // Antes: include: { category: { select: { id, name, slug, parent: ... } } }
        include: {
          categories: {
            include: { parent: { select: { id: true, name: true } } },
          },
          // _count.variants: el admin siempre ve todas las variantes activas (sin filtrar por visibility)
          _count: { select: { variants: { where: { active: true } } } },
          attributes: {
            include: { values: { orderBy: { position: "asc" } } },
            orderBy: { position: "asc" },
          },
          // Variantes con SKU: solo las que tienen SKU definido, para búsqueda en registro de compras
          variants: {
            where: { sku: { not: null } },
            select: { id: true, sku: true, stock: true, stockUnlimited: true, combination: true },
          },
          // Proveedor asignado (solo admin) — para preseleccionarlo al editar y mostrarlo en el listado
          supplier: { select: { id: true, name: true } },
        },
        // Antes: orderBy: { createdAt: "desc" } siempre. Con búsqueda eso mezclaba los resultados
        // sin criterio visible (aparecían "CABLE..." antes que "ADAPTADOR..." buscando "a").
        // Ahora: buscando → alfabético (y abajo se priorizan los que EMPIEZAN con el término);
        // sin búsqueda → más nuevo primero, como siempre.
        orderBy: search ? { name: "asc" } : { createdAt: "desc" },
        // skip,                    // Comentado: con all=true no paginamos en el server; el admin pagina en el cliente.
        // take: parseInt(limit),   // Comentado: así el capital y los tabs "Sin stock/Quiebre" cuentan TODOS los productos.
        ...(noPaginate ? {} : { skip, take: parseInt(limit) }),
      }),
      prisma.product.count({ where }),
    ]);

    // Con búsqueda: priorizar los productos cuyo nombre EMPIEZA con el término tipeado
    // (insensible a mayúsculas y tildes); el resto queda alfabético (ya viene name asc de la DB).
    if (search) {
      const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const term = norm(search);
      products.sort((a, b) => {
        const aStarts = norm(a.name).startsWith(term) ? 0 : 1;
        const bStarts = norm(b.name).startsWith(term) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return norm(a.name).localeCompare(norm(b.name));
      });
    }

    // Unidades vendidas por producto (solo órdenes APPROVED)
    const productIds = products.map((p) => p.id);
    let soldMap = {};
    let variantStockMap = {};
    let variantCapitalMap = {}; // productId -> { capital, finiteStock } (capital de variantes finitas)
    if (productIds.length > 0) {
      // Prisma no tiene @map en orderId/productId → columnas en DB son camelCase
      const soldStats = await prisma.$queryRaw`
        SELECT oi."productId", COALESCE(SUM(oi.quantity), 0)::int AS "totalSold"
        FROM order_items oi
        JOIN orders o ON oi."orderId" = o.id
        WHERE o.status = 'APPROVED'
          AND oi."productId" = ANY(${productIds})
        GROUP BY oi."productId"
      `;
      soldStats.forEach((r) => { soldMap[r.productId] = r.totalSold; });

      // Stock efectivo de variantes: si alguna es ilimitada → -1 (ilimitado), sino suma de stocks activos
      const variantStockStats = await prisma.$queryRaw`
        SELECT "productId",
          CASE WHEN bool_or("stockUnlimited") THEN -1
               ELSE COALESCE(SUM(stock), 0)::int
          END AS "variantStock"
        FROM product_variants
        WHERE active = true
          AND "productId" = ANY(${productIds})
        GROUP BY "productId"
      `;
      variantStockStats.forEach((r) => { variantStockMap[r.productId] = r.variantStock; });

      // Capital en stock aportado por las variantes FINITAS: suma de (stock × costo de la variante,
      // con fallback al costo del producto). Las variantes ilimitadas aportan 0 pero NO descartan al
      // producto: si tiene alguna variante finita con stock, ese valor se cuenta igual.
      const variantCapitalStats = await prisma.$queryRaw`
        SELECT v."productId",
          COALESCE(SUM(CASE WHEN v."stockUnlimited" THEN 0 ELSE v.stock * COALESCE(v.cost, p.cost, 0) END), 0)::float AS "capital",
          COALESCE(SUM(CASE WHEN v."stockUnlimited" THEN 0 ELSE v.stock END), 0)::int AS "finiteStock"
        FROM product_variants v
        JOIN products p ON v."productId" = p.id
        WHERE v.active = true
          AND v."productId" = ANY(${productIds})
        GROUP BY v."productId"
      `;
      variantCapitalStats.forEach((r) => {
        variantCapitalMap[r.productId] = { capital: Number(r.capital) || 0, finiteStock: r.finiteStock || 0 };
      });
    }

    res.json({
      products: products.map((p) => {
        const hasActiveVariants = variantStockMap[p.id] !== undefined;
        // stockCapital: valor del stock FINITO del producto (para "Capital total en stock").
        // capitalStatus: cómo se cuenta en la tarjeta → "counted" (suma), "noCost" (tiene stock pero
        // sin costo), "unlimited" (no hay stock finito que contar).
        let stockCapital = 0;
        let capitalStatus;
        if (hasActiveVariants) {
          const vc = variantCapitalMap[p.id] || { capital: 0, finiteStock: 0 };
          if (vc.capital > 0)          { capitalStatus = "counted";   stockCapital = vc.capital; }
          else if (vc.finiteStock > 0) { capitalStatus = "noCost";    stockCapital = 0; }
          else                         { capitalStatus = "unlimited"; stockCapital = 0; }
        } else if (p.stockUnlimited)                 { capitalStatus = "unlimited"; stockCapital = 0; }
        else if (p.cost != null && p.cost > 0)       { capitalStatus = "counted";   stockCapital = p.stock * p.cost; }
        else                                         { capitalStatus = "noCost";    stockCapital = 0; }

        return {
          ...p,
          totalSold: soldMap[p.id] || 0,
          // variantStockTotal: -1 = ilimitado, número = suma de stocks de variantes activas, null = sin variantes
          variantStockTotal: variantStockMap[p.id] !== undefined ? variantStockMap[p.id] : null,
          stockCapital,
          capitalStatus,
        };
      }),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("getProductsAdmin error:", err);
    res.status(500).json({ error: "Error al obtener productos" });
  }
}

// GET /api/products/:id - Obtener un producto por ID
async function getProduct(req, res) {
  try {
    const { id } = req.params;
    const { visibleFor } = req.query;

    // El parámetro puede ser un id numérico (links viejos, QR, PDFs ya impresos) o un slug legible
    // (URLs nuevas). Si es solo dígitos → busca por id; si no → por slug. Así no se rompe nada previo.
    const where = /^\d+$/.test(String(id)) ? { id: parseInt(id) } : { slug: String(id) };

    // Filtrar variantes según visibilidad para el tipo de cliente actual.
    // Si no se envía visibleFor (admin), devuelve todas las activas.
    const variantsWhere = (visibleFor === "MAYORISTA" || visibleFor === "MINORISTA")
      ? { active: true, visibility: { in: ["AMBOS", visibleFor] } }
      : { active: true };

    // Los ATRIBUTOS se devuelven SIN filtrar por visibilidad, a propósito — no es un olvido.
    // Tentación: filtrarlos igual que las variantes, para que un MAYORISTA no reciba el atributo
    // "Color" que es solo-MINORISTA. Pero el frontend usa attributes.length como señal de "este
    // producto USA variantes", y de esa señal depende el stock: cuando un producto tiene variantes,
    // product.stock (el del padre) no se sincroniza y no es confiable. Si el atributo desapareciera,
    // el detalle mostraría "Sin stock" en esos productos (el bug que arregló b278e95).
    // Que el cliente reciba el atributo NO significa que se le muestre el selector: para eso está
    // la regla "hay atributos Y hay variantes visibles", que aplican tanto ProductDetail como
    // ProductCard antes de pedir que elija una opción.
    const product = await prisma.product.findUnique({
      where,
      include: {
        categories: { include: { parent: { select: { id: true, name: true, slug: true } } } },
        attributes: { include: { values: { orderBy: { position: "asc" } } }, orderBy: { position: "asc" } },
        variants:   { where: variantsWhere, orderBy: { createdAt: "asc" } },
        supplier:   { select: { id: true, name: true } },
      },
    });

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Si el producto está despublicado (sin stock, oculto), solo el admin puede verlo.
    // El cliente que toquetea la URL e intenta entrar a /producto/X de un producto inactivo
    // recibe un 404 como si no existiera.
    if (!product.active) {
      let isAdmin = false;
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
          const jwt = require("jsonwebtoken");
          const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
          isAdmin = decoded.role === "ADMIN" || decoded.role === "SUPERADMIN";
        } catch {
          // Token inválido — tratamos como anónimo
        }
      }
      if (!isAdmin) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }
    }

    // Si quien consulta no es admin, ocultar los campos internos (depósito + proveedor)
    res.json(isAdminRequest(req) ? product : stripAdminProductFields(product));
  } catch (err) {
    console.error("getProduct error:", err);
    res.status(500).json({ error: "Error al obtener el producto" });
  }
}

// ── Helpers de módulo ─────────────────────────────────────────────────────────

// Parsea price tiers desde FormData (JSON string o array).
// allowUndefined=true → si raw es undefined devuelve undefined (para update, "no tocar").
// allowUndefined=false → si raw es undefined/vacío devuelve null (para create).
function parseTiers(raw, allowUndefined = false) {
  if (raw === undefined) return allowUndefined ? undefined : null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .map((t) => ({ minQty: parseInt(t.minQty), price: parseFloat(t.price) }))
        .filter((t) => t.minQty > 0 && t.price > 0)
        .sort((a, b) => a.minQty - b.minQty);
    }
  } catch (_) { /* JSON inválido → tratar como vacío */ }
  return null;
}

// Máximo de productos permitidos por cada sección del carrusel de la home.
// Si al marcar un producto ya se alcanzó el límite, el más viejo se desmarca.
const CAROUSEL_LIMIT = 20;

async function enforceCarouselLimit(field, excludeId = null) {
  const where = { [field]: true };
  if (excludeId) where.id = { not: excludeId };

  // Trae exactamente CAROUSEL_LIMIT productos ordenados del más viejo al más nuevo.
  // Si la lista tiene CAROUSEL_LIMIT elementos, significa que ya se alcanzó el tope
  // y el primero (índice 0) es el candidato a desmarcar — sin necesidad de count() separado.
  const items = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: CAROUSEL_LIMIT,
    select: { id: true, name: true },
  });

  if (items.length >= CAROUSEL_LIMIT) {
    const oldest = items[0];
    await prisma.product.update({
      where: { id: oldest.id },
      data: { [field]: false },
    });
    console.log(`[carousel] Se quitó ${field} del producto ID ${oldest.id} ("${oldest.name}") por alcanzar el límite de ${CAROUSEL_LIMIT}.`);
  }
}

// POST /api/products - Crear producto (admin)
async function createProduct(req, res) {
  try {
    const { name, description, price, cost, currency, ivaRate, salePrice, wholesalePrice, wholesaleSalePrice, minQuantity, stock, stockUnlimited, stockBreak, priceTiers: priceTiersRaw, wholesalePriceTiers: wholesalePriceTiersRaw, sku, youtubeUrl, featured, onSale, hotSeller, hotSellerThreshold, weight, length, width, height, visibility, module, shelf, supplierId } = req.body;
    const priceTiers = parseTiers(priceTiersRaw);
    const wholesalePriceTiers = parseTiers(wholesalePriceTiersRaw);
    // categoryIds puede venir como string (1 sola) o array (varias) desde FormData
    // Antes: categoryId (single) — ahora: categoryIds (multiple)
    const rawCategoryIds = req.body.categoryIds;
    const categoryIds = rawCategoryIds
      ? (Array.isArray(rawCategoryIds) ? rawCategoryIds : [rawCategoryIds])
          .map((id) => parseInt(id)).filter(Boolean)
      : [];

    if (!name || !price || !cost || !wholesalePrice) {
      return res.status(400).json({ error: "Nombre, precio minorista, precio mayorista y costo son requeridos" });
    }

    // Validar que salePrice minorista sea menor al precio normal
    if (salePrice && parseFloat(salePrice) >= parseFloat(price)) {
      return res.status(400).json({ error: "El precio de oferta minorista debe ser menor al precio minorista" });
    }

    // Validar que wholesaleSalePrice sea menor al precio mayorista
    if (wholesaleSalePrice && wholesalePrice && parseFloat(wholesaleSalePrice) >= parseFloat(wholesalePrice)) {
      return res.status(400).json({ error: "El precio de oferta mayorista debe ser menor al precio mayorista" });
    }

    // Subir imágenes a Cloudinary y obtener las URLs
    const images = req.files && req.files.length > 0
      ? await Promise.all(req.files.map((f) => uploadBuffer(f.buffer, "ecommerce/products").then((r) => r.secure_url)))
      : [];

    // Si se activa featured u onSale, verificar que no se supere el límite del carrusel.
    // Si ya hay 20, el más viejo se desmarca automáticamente antes de insertar el nuevo.
    if (featured === "true" || featured === true) await enforceCarouselLimit("featured");
    if (onSale === "true" || onSale === true)     await enforceCarouselLimit("onSale");

    // slug URL-amigable único, generado desde el nombre (ver getProduct: acepta id numérico o slug).
    const slug = await generateUniqueProductSlug(name.trim());

    const product = await prisma.product.create({
      data: {
        name: name.trim(), // trim: sin espacios al inicio/fin, que rompían el orden A→Z del catálogo
        slug,
        description: description || null,
        price: parseFloat(price),
        cost: cost ? parseFloat(cost) : null,
        currency: ["ARS", "USD"].includes(currency) ? currency : "ARS",
        ivaRate: ivaRate ? parseFloat(ivaRate) : 21,
        salePrice: salePrice ? parseFloat(salePrice) : null,
        wholesalePrice: wholesalePrice ? parseFloat(wholesalePrice) : null,
        wholesaleSalePrice: wholesaleSalePrice ? parseFloat(wholesaleSalePrice) : null,
        minQuantity: minQuantity ? parseInt(minQuantity) : 1,
        stock: parseInt(stock) || 0,
        stockUnlimited: stockUnlimited === "true" || stockUnlimited === true,
        stockBreak: stockBreak ? parseInt(stockBreak) : null,
        sku: sku || null,
        youtubeUrl: youtubeUrl || null,
        weight: weight ? parseFloat(weight) : null,
        length: length ? parseFloat(length) : null,
        width:  width  ? parseFloat(width)  : null,
        height: height ? parseFloat(height) : null,
        // Ubicación en depósito (módulo/estante) — texto libre, opcional
        module: module ? module.trim() : null,
        shelf:  shelf  ? shelf.trim()  : null,
        // Proveedor: relación opcional. Si viene un id válido lo conectamos, sino queda sin proveedor.
        supplier: supplierId ? { connect: { id: parseInt(supplierId) } } : undefined,
        // Antes: categoryId: categoryId ? parseInt(categoryId) : null
        categories: categoryIds.length > 0 ? { connect: categoryIds.map((id) => ({ id })) } : undefined,
        featured: featured === "true" || featured === true,
        // onSale: marca el producto para la sección "Ofertas" de la home
        onSale: onSale === "true" || onSale === true,
        hotSeller: hotSeller === "true" || hotSeller === true,
        // En creación totalSold=0 → el threshold nunca se cumple de entrada
        hotSellerThreshold: hotSellerThreshold ? parseInt(hotSellerThreshold) : null,
        visibility: ["AMBOS", "MAYORISTA", "MINORISTA"].includes(visibility) ? visibility : "AMBOS",
        priceTiers: priceTiers || undefined,
        wholesalePriceTiers: wholesalePriceTiers || undefined,
        images,
      },
      include: { categories: { include: { parent: { select: { id: true, name: true } } } }, supplier: { select: { id: true, name: true } } },
    });

    res.status(201).json(product);
  } catch (err) {
    console.error("createProduct error:", err);
    res.status(500).json({ error: "Error al crear el producto" });
  }
}

// PUT /api/products/:id - Actualizar producto (admin)
async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { name, description, price, cost, currency, ivaRate, salePrice, wholesalePrice, wholesaleSalePrice, minQuantity, stock, stockUnlimited, stockBreak, priceTiers: priceTiersRaw, wholesalePriceTiers: wholesalePriceTiersRaw, sku, youtubeUrl, featured, onSale, hotSeller, hotSellerThreshold, active, keepImages, weight, length, width, height, visibility, module, shelf, supplierId } = req.body;
    // undefined → no tocar (allowUndefined=true); null/[] → borrar tiers
    const priceTiersUpdate = parseTiers(priceTiersRaw, true);
    const wholesalePriceTiersUpdate = parseTiers(wholesalePriceTiersRaw, true);
    // categoryIds puede venir como string (1 sola) o array (varias) desde FormData
    // Antes: categoryId (single) — ahora: categoryIds (multiple)
    const rawCategoryIds = req.body.categoryIds;
    const categoryIds = rawCategoryIds !== undefined
      ? (Array.isArray(rawCategoryIds) ? rawCategoryIds : [rawCategoryIds])
          .map((id) => parseInt(id)).filter(Boolean)
      : null; // null significa "no vino en el body, no tocar"

    const existing = await prisma.product.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Para productos con variantes el stock es la suma de las variantes — no se edita directamente
    const productHasActiveVariants = await prisma.productVariant.count({
      where: { productId: parseInt(id), active: true },
    }) > 0;

    // Validar que el costo no se borre si ya tenía uno (campo obligatorio)
    if (cost !== undefined && cost === "") {
      return res.status(400).json({ error: "El costo es obligatorio" });
    }

    // El precio mayorista es obligatorio: si se manda explícitamente vacío, rechazar
    if (wholesalePrice !== undefined && (wholesalePrice === "" || wholesalePrice === null)) {
      return res.status(400).json({ error: "El precio mayorista es obligatorio" });
    }

    // Validar salePrice minorista contra el precio que quedará (el nuevo o el actual)
    const finalPrice = price ? parseFloat(price) : existing.price;
    if (salePrice && parseFloat(salePrice) >= finalPrice) {
      return res.status(400).json({ error: "El precio de oferta minorista debe ser menor al precio minorista" });
    }

    // Validar wholesaleSalePrice contra el precio mayorista que quedará
    const finalWholesalePrice = wholesalePrice ? parseFloat(wholesalePrice) : existing.wholesalePrice;
    if (wholesaleSalePrice && finalWholesalePrice && parseFloat(wholesaleSalePrice) >= finalWholesalePrice) {
      return res.status(400).json({ error: "El precio de oferta mayorista debe ser menor al precio mayorista" });
    }

    // Manejo de imágenes:
    // keepImages puede ser un array de URLs de imágenes que se quieren conservar
    let images = existing.images;

    if (req.files && req.files.length > 0) {
      const newImages = await Promise.all(req.files.map((f) => uploadBuffer(f.buffer, "ecommerce/products").then((r) => r.secure_url)));

      // Si keepImages se envía, combinamos las que se quieren conservar con las nuevas
      // Filtramos __NONE__ que es el marcador que envía el frontend cuando no hay imágenes a conservar
      if (keepImages) {
        const toKeep = (Array.isArray(keepImages) ? keepImages : [keepImages]).filter((k) => k !== "__NONE__");
        images = [...toKeep, ...newImages];
      } else {
        // Si no se especifica keepImages, reemplazamos todas con las nuevas
        images = newImages;
      }
    } else if (keepImages !== undefined) {
      // Solo conservar las imágenes especificadas (sin nuevas imágenes subidas)
      // __NONE__ es el marcador que envía el frontend cuando se borraron todas las imágenes
      const keepArr = Array.isArray(keepImages) ? keepImages : [keepImages];
      images = keepArr.filter((k) => k !== "__NONE__");
    }

    // Eliminar de Cloudinary las imágenes que ya no se van a usar
    const removedImages = existing.images.filter((img) => !images.includes(img));
    for (const img of removedImages) {
      if (img.startsWith("http")) {
        await deleteByUrl(img);
      } else {
        const fullPath = require("path").join(__dirname, "../../", img);
        if (require("fs").existsSync(fullPath)) require("fs").unlinkSync(fullPath);
      }
    }

    // Si se activa featured u onSale (y antes no lo estaba), verificar límite del carrusel.
    // Se ejecutan en paralelo si ambas condiciones aplican — excludeId evita contar el producto actual.
    const isFeaturedNow = featured !== undefined ? (featured === "true" || featured === true) : existing.featured;
    const isOnSaleNow   = onSale   !== undefined ? (onSale   === "true" || onSale   === true) : existing.onSale;
    const numericId = parseInt(id);
    const carouselChecks = [];
    if (isFeaturedNow && !existing.featured) carouselChecks.push(enforceCarouselLimit("featured", numericId));
    if (isOnSaleNow   && !existing.onSale)   carouselChecks.push(enforceCarouselLimit("onSale",   numericId));
    if (carouselChecks.length) await Promise.all(carouselChecks);

    // slug: se mantiene ESTABLE (no se regenera al cambiar el nombre) para no romper links ya
    // compartidos. Solo se genera si el producto todavía no tiene (productos previos al backfill).
    let slug = existing.slug;
    if (!slug) slug = await generateUniqueProductSlug(name ? name.trim() : existing.name, existing.id);

    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: {
        name: name ? name.trim() : existing.name, // trim: sin espacios al inicio/fin (rompían el orden A→Z)
        slug,
        description: description !== undefined ? description : existing.description,
        price: price ? parseFloat(price) : existing.price,
        cost: cost !== undefined ? (cost ? parseFloat(cost) : null) : existing.cost,
        currency: ["ARS", "USD"].includes(currency) ? currency : existing.currency,
        ivaRate: ivaRate !== undefined ? parseFloat(ivaRate) : existing.ivaRate,
        salePrice: salePrice !== undefined ? (salePrice ? parseFloat(salePrice) : null) : existing.salePrice,
        wholesalePrice: wholesalePrice !== undefined ? (wholesalePrice ? parseFloat(wholesalePrice) : null) : existing.wholesalePrice,
        wholesaleSalePrice: wholesaleSalePrice !== undefined ? (wholesaleSalePrice ? parseFloat(wholesaleSalePrice) : null) : existing.wholesaleSalePrice,
        minQuantity: minQuantity !== undefined ? parseInt(minQuantity) : existing.minQuantity,
        // Si tiene variantes activas, el stock es la suma de las variantes — ignorar el campo stock del body
        stock: (!productHasActiveVariants && stock !== undefined) ? parseInt(stock) : existing.stock,
        stockUnlimited: (!productHasActiveVariants && stockUnlimited !== undefined) ? (stockUnlimited === "true" || stockUnlimited === true) : existing.stockUnlimited,
        stockBreak: stockBreak !== undefined ? (stockBreak ? parseInt(stockBreak) : null) : existing.stockBreak,
        sku: sku !== undefined ? (sku || null) : existing.sku,
        youtubeUrl: youtubeUrl !== undefined ? (youtubeUrl || null) : existing.youtubeUrl,
        weight: weight !== undefined ? (weight ? parseFloat(weight) : null) : existing.weight,
        length: length !== undefined ? (length ? parseFloat(length) : null) : existing.length,
        width:  width  !== undefined ? (width  ? parseFloat(width)  : null) : existing.width,
        height: height !== undefined ? (height ? parseFloat(height) : null) : existing.height,
        // Ubicación en depósito: si viene en el body se actualiza (vacío → null), sino se conserva
        module: module !== undefined ? (module ? module.trim() : null) : existing.module,
        shelf:  shelf  !== undefined ? (shelf  ? shelf.trim()  : null) : existing.shelf,
        // Proveedor: si no vino en el body, no tocar. Si vino con id → conectar; si vino vacío → desvincular.
        ...(supplierId !== undefined
          ? { supplier: supplierId ? { connect: { id: parseInt(supplierId) } } : { disconnect: true } }
          : {}),
        // Antes: categoryId: categoryId !== undefined ? (categoryId ? parseInt(categoryId) : null) : existing.categoryId
        // set: reemplaza todas las categorías por las nuevas; si no vino en el body, no tocar
        ...(categoryIds !== null ? { categories: { set: categoryIds.map((id) => ({ id })) } } : {}),
        featured: featured !== undefined ? (featured === "true" || featured === true) : existing.featured,
        // onSale: si viene en el body lo actualiza, sino conserva el valor actual
        onSale: onSale !== undefined ? (onSale === "true" || onSale === true) : existing.onSale,
        // hotSellerThreshold: umbral de unidades vendidas para activar automáticamente el badge de fuego
        hotSellerThreshold: hotSellerThreshold !== undefined
          ? (hotSellerThreshold ? parseInt(hotSellerThreshold) : null)
          : existing.hotSellerThreshold,
        // hotSeller: manual override O auto-activado si totalSold >= hotSellerThreshold al guardar
        hotSeller: await (async () => {
          const newThreshold = hotSellerThreshold !== undefined
            ? (hotSellerThreshold ? parseInt(hotSellerThreshold) : null)
            : existing.hotSellerThreshold;
          if (newThreshold != null) {
            // Calcular totalSold actual para evaluar si ya supera el umbral
            const [{ totalSold }] = await prisma.$queryRaw`
              SELECT COALESCE(SUM(oi.quantity), 0)::int AS "totalSold"
              FROM order_items oi JOIN orders o ON oi."orderId" = o.id
              WHERE o.status = 'APPROVED' AND oi."productId" = ${parseInt(id)}
            `;
            return totalSold >= newThreshold;
          }
          // Sin threshold: usar el valor manual enviado o el existente
          return hotSeller !== undefined ? (hotSeller === "true" || hotSeller === true) : existing.hotSeller;
        })(),
        active: active !== undefined ? (active === "true" || active === true) : existing.active,
        visibility: ["AMBOS", "MAYORISTA", "MINORISTA"].includes(visibility) ? visibility : existing.visibility,
        ...(priceTiersUpdate !== undefined ? { priceTiers: priceTiersUpdate } : {}),
        ...(wholesalePriceTiersUpdate !== undefined ? { wholesalePriceTiers: wholesalePriceTiersUpdate } : {}),
        images,
      },
      include: { categories: { include: { parent: { select: { id: true, name: true } } } }, supplier: { select: { id: true, name: true } } },
    });

    res.json(product);
  } catch (err) {
    console.error("updateProduct error:", err);
    res.status(500).json({ error: "Error al actualizar el producto" });
  }
}

// PATCH /api/products/:id/quick - Actualización rápida de campos simples sin multipart (admin)
// Usado desde la edición rápida en el listado de productos (precio, stock, precios especiales, estado)
async function quickUpdateProduct(req, res) {
  try {
    const { id } = req.params;
    const { price, salePrice, wholesalePrice, wholesaleSalePrice, minQuantity, stock, stockUnlimited, active, cost, currency, sku, supplierId } = req.body;

    const existing = await prisma.product.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Para productos con variantes el stock es la suma de las variantes — no se edita directamente
    const qHasActiveVariants = await prisma.productVariant.count({
      where: { productId: parseInt(id), active: true },
    }) > 0;

    const updateData = {};

    // Determinar el precio efectivo (el nuevo o el existente) para validar salePrice
    const effectivePrice = price !== undefined ? parseFloat(price) : existing.price;

    // Validar que salePrice minorista sea menor al precio minorista
    if (salePrice !== undefined && salePrice) {
      const salePriceNum = parseFloat(salePrice);
      if (isNaN(salePriceNum) || salePriceNum >= effectivePrice) {
        return res.status(400).json({ error: "El precio de oferta minorista debe ser menor al precio minorista" });
      }
    }

    // Validar que wholesaleSalePrice sea menor al precio mayorista
    const effectiveWholesalePrice = wholesalePrice !== undefined ? parseFloat(wholesalePrice) : existing.wholesalePrice;
    if (wholesaleSalePrice !== undefined && wholesaleSalePrice && effectiveWholesalePrice) {
      const wsNum = parseFloat(wholesaleSalePrice);
      if (isNaN(wsNum) || wsNum >= effectiveWholesalePrice) {
        return res.status(400).json({ error: "El precio de oferta mayorista debe ser menor al precio mayorista" });
      }
    }

    // Solo actualizar los campos que vienen en el body
    if (price !== undefined) updateData.price = effectivePrice;
    if (salePrice !== undefined) updateData.salePrice = salePrice ? parseFloat(salePrice) : null;
    if (wholesalePrice !== undefined) updateData.wholesalePrice = wholesalePrice ? parseFloat(wholesalePrice) : null;
    if (wholesaleSalePrice !== undefined) updateData.wholesaleSalePrice = wholesaleSalePrice ? parseFloat(wholesaleSalePrice) : null;
    if (minQuantity !== undefined) updateData.minQuantity = parseInt(minQuantity) || 1;
    // Para productos con variantes, el stock es la suma de las variantes — no se actualiza directamente
    if (stock !== undefined && !qHasActiveVariants) {
      const newStock = parseInt(stock) || 0;
      updateData.stock = newStock;
      const isUnlimited = stockUnlimited !== undefined ? Boolean(stockUnlimited) : existing.stockUnlimited;
      if (active === undefined) {
        if (newStock <= 0 && !isUnlimited) {
          // Si el admin pone stock en 0 (y no es ilimitado), despublicar automáticamente
          updateData.active = false;
        } else if (newStock > 0 && !existing.active) {
          // Si el admin agrega stock y el producto estaba despublicado, republicar automáticamente
          updateData.active = true;
        }
      }
    }
    if (stockUnlimited !== undefined && !qHasActiveVariants) updateData.stockUnlimited = Boolean(stockUnlimited);
    if (active !== undefined) updateData.active = Boolean(active);
    // cost y sku faltaban — el frontend los manda en la edición rápida pero antes se ignoraban
    if (cost !== undefined && cost !== "") updateData.cost = parseFloat(cost);
    if (currency !== undefined && ["ARS", "USD"].includes(currency)) updateData.currency = currency;
    if (sku !== undefined) updateData.sku = sku || null;
    // supplierId: permite cambiar el proveedor del producto sin abrir la edición completa
    // (se usa desde la vista de cotizaciones). "" o null = sin proveedor asignado.
    if (supplierId !== undefined) {
      updateData.supplierId = supplierId === "" || supplierId === null ? null : parseInt(supplierId);
    }

    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: updateData,
      // Antes: include: { category: { select: { id, name, slug, parent } } }
      include: {
        categories: {
          include: { parent: { select: { id: true, name: true } } },
        },
        // supplier: para que el front pueda refrescar el chip de proveedor al vuelo
        supplier: { select: { id: true, name: true } },
      },
    });

    if (stock !== undefined || stockUnlimited !== undefined) {
      await syncProductVisibility(parseInt(id));
    }

    res.json(product);
  } catch (err) {
    console.error("quickUpdateProduct error:", err);
    res.status(500).json({ error: "Error al actualizar el producto" });
  }
}

// Helper reutilizable: elimina las imágenes de un producto del almacenamiento.
// Cloudinary si es URL https, disco local si es path relativo (imágenes viejas).
// Se extrajo del cuerpo de deleteProduct para poder reusarlo desde purchase.controller
// (al auto-borrar productos creados por una compra que se elimina).
async function deleteProductImages(images) {
  for (const imgPath of images || []) {
    if (imgPath.startsWith("http")) {
      await deleteByUrl(imgPath);
    } else {
      const fullPath = path.join(__dirname, "../../", imgPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
  }
}

// DELETE /api/products/:id - Eliminar producto (admin)
async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const pid = parseInt(id);
    // force: permite borrar igual un producto con ventas (desvinculándolo de las órdenes vía SetNull).
    // Llega como ?force=true (query) o { force: true } (body).
    const force = req.query.force === "true" || req.body?.force === true;

    const existing = await prisma.product.findUnique({ where: { id: pid } });
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Verificar si el producto tiene ventas (items de órdenes que lo referencian). Si las tiene y NO
    // se pidió force, devolvemos 409 con el detalle para que el front pida confirmación. Borrarlo
    // dejaría esos pedidos mostrando "Producto eliminado" (se conservan precio/cantidad/costo).
    const salesCount = await prisma.orderItem.count({ where: { productId: pid } });
    if (salesCount > 0 && !force) {
      return res.status(409).json({
        error: `Este producto tiene ${salesCount} venta(s) registrada(s). Si lo borrás, esos pedidos mostrarán "Producto eliminado".`,
        hasSales: true,
        salesCount,
      });
    }

    if (salesCount > 0) {
      // Force-delete de un producto CON ventas: guardamos una COPIA (nombre + foto principal) en sus
      // items de orden, para que los pedidos sigan identificándolo tras el borrado. CONSERVAMOS las
      // imágenes (no las borramos) para que la foto del snapshot siga disponible en la orden.
      await prisma.orderItem.updateMany({
        where: { productId: pid },
        data: {
          productName:  existing.name,
          productImage: existing.images?.[0] || null,
        },
      });
    } else {
      // Sin ventas: borrado normal. Liberamos las imágenes del almacenamiento.
      // IMPORTANTE: se borran SOLO cuando ya vamos a borrar el producto (antes se borraban antes del
      // delete, y si el delete fallaba el producto quedaba sin fotos).
      await deleteProductImages(existing.images);
    }

    // Con onDelete: SetNull en OrderItem.product, este delete ya no es bloqueado por las ventas:
    // los order_items quedan con productId = null pero conservan el snapshot (productName/productImage).
    await prisma.product.delete({ where: { id: pid } });

    res.json({ message: "Producto eliminado correctamente" });
  } catch (err) {
    console.error("deleteProduct error:", err);
    res.status(500).json({ error: "Error al eliminar el producto" });
  }
}

// POST /api/products/bulk-price-adjust
// Aplica un ajuste porcentual a los precios de todos los productos activos.
// Body: { type: "MINORISTA" | "MAYORISTA" | "AMBOS", percent: number }
// percent positivo = aumento, negativo = reducción. Ej: 10 = +10%, -5 = -5%.
async function bulkPriceAdjust(req, res) {
  try {
    const { type, percent } = req.body;

    if (!["MINORISTA", "MAYORISTA", "AMBOS"].includes(type)) {
      return res.status(400).json({ error: "type debe ser MINORISTA, MAYORISTA o AMBOS" });
    }
    const pct = parseFloat(percent);
    if (isNaN(pct) || pct === 0) {
      return res.status(400).json({ error: "percent debe ser un número distinto de 0" });
    }

    const factor = 1 + pct / 100;
    const round2 = (v) => Math.round(v * factor * 100) / 100;
    const adjustTiers = (tiers) =>
      Array.isArray(tiers)
        ? tiers.map((t) => ({ ...t, price: Math.round(parseFloat(t.price) * factor * 100) / 100 }))
        : tiers;

    // Solo productos en ARS: un % de ajuste (pensado para inflación en pesos) no tiene sentido
    // aplicado a un precio ya cargado en USD — esos quedan afuera del ajuste masivo.
    const products = await prisma.product.findMany({
      where: { currency: "ARS" },
      select: {
        id: true,
        price: true,
        salePrice: true,
        wholesalePrice: true,
        wholesaleSalePrice: true,
        priceTiers: true,
        wholesalePriceTiers: true,
      },
    });

    const updates = products.map((p) => {
      const data = {};
      const applyMinorista = type === "MINORISTA" || type === "AMBOS";
      const applyMayorista = type === "MAYORISTA" || type === "AMBOS";

      if (applyMinorista) {
        data.price     = round2(p.price);
        if (p.salePrice != null)  data.salePrice  = round2(p.salePrice);
        if (p.priceTiers)         data.priceTiers = adjustTiers(p.priceTiers);
      }
      if (applyMayorista) {
        if (p.wholesalePrice != null)     data.wholesalePrice     = round2(p.wholesalePrice);
        if (p.wholesaleSalePrice != null) data.wholesaleSalePrice = round2(p.wholesaleSalePrice);
        if (p.wholesalePriceTiers)        data.wholesalePriceTiers = adjustTiers(p.wholesalePriceTiers);
      }

      return prisma.product.update({ where: { id: p.id }, data });
    });

    await prisma.$transaction(updates);

    // Campañas de oferta: este ajuste escala también los salePrice/wholesaleSalePrice, incluidos los
    // que escribió una campaña vigente. La campaña reconoce sus precios comparando contra el número
    // exacto que anotó, así que si no reajustamos esa anotación deja de reconocerlos, los toma por
    // "oferta cargada a mano" y AL TERMINAR NO LOS REVIERTE: el descuento queda pegado para siempre.
    // Se escala la anotación con el mismo factor y redondeo, y después se re-sincroniza para que el
    // descuento se recalcule sobre el precio nuevo (necesario con descuentos de monto fijo, donde
    // escalar no da el mismo resultado que volver a restar el monto).
    let offersResynced = 0;
    try {
      const { rescaleAppliedPrices, syncOffers } = require("../services/offers.service");
      const r = await rescaleAppliedPrices(factor, {
        retail:    type === "MINORISTA" || type === "AMBOS",
        wholesale: type === "MAYORISTA" || type === "AMBOS",
      });
      offersResynced = r.rescaled;
      await syncOffers();
    } catch (e) {
      // Si esto falla, el ajuste de precios ya quedó hecho y no se revierte: el cron va a re-aplicar
      // las campañas en el próximo minuto. Se loguea para poder revisar los precios de oferta a mano.
      console.error("bulkPriceAdjust: error re-sincronizando campañas de oferta:", e.message);
    }

    res.json({ ok: true, updated: products.length, offersResynced });
  } catch (err) {
    console.error("bulkPriceAdjust error:", err);
    res.status(500).json({ error: "Error al ajustar precios" });
  }
}

// GET /api/products/facets - Atributos únicos de los productos del conjunto actual (para filtros dinámicos)
// Acepta los mismos filtros que getProducts (category, search, visibleFor, onSale, lowStock, offerId)
// pero devuelve los atributos agregados en lugar de productos paginados.
async function getProductFacets(req, res) {
  try {
    const { category, search, visibleFor, onSale, lowStock, offerId } = req.query;

    const where = { active: true };

    if (visibleFor === "MAYORISTA" || visibleFor === "MINORISTA") {
      where.visibility = { in: ["AMBOS", visibleFor] };
    }

    if (category) {
      // Antes bajaba un solo nivel:
      //   const cat = await prisma.category.findUnique({
      //     where: { slug: category },
      //     include: { children: { select: { id: true } } },
      //   });
      //   const categoryIds = [cat.id, ...cat.children.map((c) => c.id)];
      // Tiene que usar el MISMO criterio que getProducts o los filtros de características quedarían
      // calculados sobre un conjunto de productos distinto del que se muestra en la grilla.
      const categoryIds = await descendantIdsBySlugs(prisma, [category]);
      if (categoryIds) {
        where.categories = { some: { id: { in: categoryIds } } };
      } else {
        where.categories = { every: { id: -1 }, some: {} };
      }
    }

    if (search) {
      // Búsqueda insensible a tildes vía unaccent (con fallback sensible a tildes si la extensión no está).
      const ids = await searchProductIds(search, { includeSku: true });
      if (ids !== null) {
        where.id = { in: ids };
      } else {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { sku:  { contains: search, mode: "insensitive" } },
        ];
      }
    }

    // Mismo criterio que getProducts: los productos que solo están en categorías ocultas no
    // participan del listado general, así los filtros de atributos reflejan lo que se ve.
    if (!category && !search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { categories: { none: {} } },
            { categories: { some: { hidden: false } } },
          ],
        },
      ];
    }

    if (onSale === "true") {
      if (visibleFor === "MAYORISTA") {
        where.wholesaleSalePrice = { not: null };
      } else {
        where.salePrice = { not: null };
      }
    }

    // Mismo filtro por campaña que getProducts, para que al elegir una campaña en el catálogo los
    // filtros de características muestren solo los atributos de esos productos.
    // Incluye el chequeo de vigencia por el mismo motivo que allá: es un endpoint público.
    if (offerId) {
      const oid = parseInt(offerId);
      if (!isNaN(oid)) {
        const nowOffer = new Date();
        where.offerItems = {
          some: {
            offerId: oid,
            offer: { active: true, startsAt: { lte: nowOffer }, endsAt: { gt: nowOffer } },
          },
        };
      }
    }

    if (lowStock === "true") {
      where.stockUnlimited = false;
      where.stock = { gt: 0, lte: 5 };
    }

    const products = await prisma.product.findMany({
      where,
      select: {
        attributes: {
          select: {
            name: true,
            position: true,
            values: { select: { value: true }, orderBy: { position: "asc" } },
          },
          orderBy: { position: "asc" },
        },
      },
    });

    // Agregar atributos únicos a través de todos los productos del conjunto
    const facetMap = new Map(); // name -> { values: Set, position: number }
    for (const product of products) {
      for (const attr of product.attributes) {
        if (!facetMap.has(attr.name)) {
          facetMap.set(attr.name, { values: new Set(), position: attr.position });
        }
        for (const val of attr.values) {
          facetMap.get(attr.name).values.add(val.value);
        }
      }
    }

    const facets = Array.from(facetMap.entries())
      .sort((a, b) => a[1].position - b[1].position)
      .map(([name, { values }]) => ({ name, values: Array.from(values) }));

    res.json({ facets });
  } catch (err) {
    console.error("getProductFacets error:", err);
    res.status(500).json({ error: "Error al obtener facetas" });
  }
}

// ── Visibilidad automática según stock ───────────────────────────────────────
// Para productos con variantes: activa/desactiva el producto según si hay stock en alguna variante.
// Para productos sin variantes: el active lo gestiona directamente el cambio de product.stock.
// Ya no toca el campo visibility (MAYORISTA/MINORISTA/AMBOS) — ese lo controla el admin.
async function syncProductVisibility(productId, tx = prisma) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: { variants: { where: { active: true }, select: { stock: true, stockUnlimited: true } } },
  });
  if (!product) return;

  let hasStock;
  if (product.variants.length === 0) {
    // Producto sin variantes: visibilidad basada en su propio stock
    // Antes se salía con return acá y el producto nunca se ocultaba al quedarse sin stock
    hasStock = product.stockUnlimited || product.stock > 0;
  } else {
    // Producto con variantes: visible si al menos una variante activa tiene stock
    hasStock = product.variants.some((v) => v.stockUnlimited || v.stock > 0);
  }

  if (!hasStock && product.active) {
    await tx.product.update({ where: { id: productId }, data: { active: false } });
  } else if (hasStock && !product.active) {
    await tx.product.update({ where: { id: productId }, data: { active: true } });
  }
}

module.exports = {
  getProducts,
  getProductsAdmin,
  getProduct,
  createProduct,
  updateProduct,
  quickUpdateProduct,
  deleteProduct,
  deleteProductImages, // helper reutilizado por purchase.controller
  bulkPriceAdjust,
  getProductFacets,
  syncProductVisibility,
};
