import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import SiteMeta from "../components/SiteMeta";
import { productsApi, getImageUrl } from "../services/api";
import { saveRecent } from "../utils/recentlyViewed";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import toast from "react-hot-toast";

// Convierte cualquier URL de YouTube a URL de embed
function getYoutubeEmbedUrl(url) {
  if (!url) return null;
  // Formato: youtu.be/ID
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}`;
  // Formato: youtube.com/watch?v=ID
  const longMatch = url.match(/[?&]v=([^?&]+)/);
  if (longMatch) return `https://www.youtube.com/embed/${longMatch[1]}`;
  return null;
}

export default function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [selectedTier, setSelectedTier] = useState(null); // tier de descuento seleccionado
  // Variantes: { [attrName]: value } — combinación seleccionada por el cliente
  const [selectedAttrs, setSelectedAttrs] = useState({});
  const [videoOpen, setVideoOpen] = useState(false);
  const [slideDir, setSlideDir] = useState("next"); // "next" | "prev"
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [zoom, setZoom] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const { addItem, items } = useCart();
  const { customer } = useCustomerAuth();
  const autoplayRef = useRef(null);

  // ── Variante activa + galería filtrada ──────────────────────────────────────
  // Si la variante elegida tiene fotos asignadas, el carrusel se filtra a solo esas.
  // Si no, muestra todas las fotos del producto.
  const hasVariants = product?.attributes?.length > 0;
  const allAttrsSelected = hasVariants &&
    product.attributes.every((a) => selectedAttrs[a.name]);
  const activeVariant = (() => {
    if (!hasVariants || !allAttrsSelected) return null;
    return (product.variants || []).find((v) => {
      const combo = Array.isArray(v.combination)
        ? v.combination
        : (typeof v.combination === "string" ? JSON.parse(v.combination) : null);
      if (!combo) return false;
      return combo.every((c) => selectedAttrs[c.name] === c.value);
    }) || null;
  })();
  const variantImages = (() => {
    if (!activeVariant) return null;
    if (Array.isArray(activeVariant.images) && activeVariant.images.length > 0) return activeVariant.images;
    if (activeVariant.image) return [activeVariant.image]; // legacy single-image
    return null;
  })();
  const galleryImages = variantImages && variantImages.length > 0 ? variantImages : (product?.images || []);
  const totalImages = galleryImages.length;

  const resetTimer = useCallback((nextFn) => {
    clearInterval(autoplayRef.current);
    nextFn();
    if (totalImages > 1) {
      autoplayRef.current = setInterval(() => {
        setSlideDir("next");
        setSelectedImage((i) => (i + 1) % totalImages);
      }, 5000);
    }
  }, [totalImages]);

  const goNext = useCallback(() => {
    resetTimer(() => {
      setSlideDir("next");
      setSelectedImage((i) => (i + 1) % totalImages);
    });
  }, [totalImages, resetTimer]);

  const goPrev = useCallback(() => {
    resetTimer(() => {
      setSlideDir("prev");
      setSelectedImage((i) => (i - 1 + totalImages) % totalImages);
    });
  }, [totalImages, resetTimer]);

  // Autoplay: avanza cada 5 segundos si hay más de 1 imagen
  useEffect(() => {
    if (totalImages <= 1) return;
    autoplayRef.current = setInterval(() => {
      setSlideDir("next");
      setSelectedImage((i) => (i + 1) % totalImages);
    }, 5000);
    return () => clearInterval(autoplayRef.current);
  }, [totalImages]);

  // Al clickear miniatura, resetea con dirección relativa
  const handleSelectImage = (i) => {
    resetTimer(() => {
      setSlideDir(i > selectedImage ? "next" : "prev");
      setSelectedImage(i);
    });
  };

  useEffect(() => {
    // Flag para cancelar actualizaciones de estado si el componente se desmonta o el id cambia
    let cancelled = false;

    setLoading(true);
    setProduct(null);
    setRelatedProducts([]);
    setSelectedImage(0);
    setSelectedAttrs({});
    setQuantity(1);
    setSelectedTier(null);

    // Pasamos visibleFor para que el backend filtre las variantes según visibility del cliente
    const visibleFor = customer?.type === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
    productsApi
      .getById(id, { visibleFor })
      .then((res) => {
        if (cancelled) return;
        // Ordenar las variantes según el orden de los valores del primer atributo (controlado por el admin
        // con las flechas ↑/↓ en el editor). Si no hay atributos, dejamos el orden tal como viene de la DB.
        const attrs = res.data.attributes || [];
        if (attrs.length > 0 && Array.isArray(res.data.variants)) {
          const firstAttr = attrs[0];
          // Mapa "valor → posición" para el primer atributo
          const valuePos = {};
          firstAttr.values.forEach((v, i) => { valuePos[v.value] = i; });
          // Sort estable por la posición del valor del primer atributo en cada combinación
          const positionOf = (variant) => {
            const combo = Array.isArray(variant.combination) ? variant.combination : [];
            const c = combo.find((x) => x.name === firstAttr.name);
            return c ? (valuePos[c.value] ?? 9999) : 9999;
          };
          res.data.variants = [...res.data.variants].sort((a, b) => positionOf(a) - positionOf(b));
        }
        setProduct(res.data);
        saveRecent(res.data);
        // Auto-seleccionar la primera variante DISPONIBLE (con stock) — ya ordenada según el admin.
        const variants = res.data.variants || [];
        if (variants.length > 0) {
          const firstAvailable = variants.find((v) => v.stockUnlimited || v.stock > 0) || variants[0];
          if (firstAvailable && Array.isArray(firstAvailable.combination)) {
            const initialAttrs = {};
            for (const c of firstAvailable.combination) {
              initialAttrs[c.name] = c.value;
            }
            setSelectedAttrs(initialAttrs);
          }
        }
        // Cargar productos relacionados con jerarquía de categorías:
        // 1) misma subcategoría → 2) categoría padre → 3) cualquier producto
        const currentId = res.data.id;
        const firstCat = res.data.categories?.[0];
        const leafSlug   = firstCat?.slug;
        const parentSlug = firstCat?.parent?.slug;
        const visibleFor = customer?.type === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
        const exclude = (list) => list.filter((p) => p.id !== currentId);
        const merge   = (base, extra) => {
          const ids = new Set(base.map((p) => p.id));
          return [...base, ...extra.filter((p) => !ids.has(p.id))];
        };

        const fetchRelated = async () => {
          let results = [];
          // 1) Misma subcategoría (ej: "teclados")
          if (leafSlug) {
            const r = await productsApi.getAll({ limit: 5, visibleFor, category: leafSlug });
            if (cancelled) return;
            results = exclude(r.data.products ?? r.data ?? []);
          }
          // 2) Categoría padre (ej: "perifericos") — ya incluye todos los hijos en el backend
          if (results.length < 4 && parentSlug) {
            const r = await productsApi.getAll({ limit: 8, visibleFor, category: parentSlug });
            if (cancelled) return;
            results = merge(results, exclude(r.data.products ?? r.data ?? []));
          }
          // 3) Todo el catálogo como último recurso
          if (results.length < 4) {
            const r = await productsApi.getAll({ limit: 9, visibleFor });
            if (cancelled) return;
            results = merge(results, exclude(r.data.products ?? r.data ?? []));
          }
          if (!cancelled) setRelatedProducts(results.slice(0, 4));
        };
        fetchRelated().catch(() => {});
      })
      .catch((err) => { if (!cancelled) console.error(err); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id]);

  const navigate = useNavigate();

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  const isMayorista = customer?.type === "MAYORISTA";

  // Al cambiar de variante, resetear el índice al primero de la galería filtrada.
  useEffect(() => {
    setSelectedImage(0);
    setSlideDir("next");
  }, [activeVariant?.id]);

  // Precio efectivo: prioriza precio de variante según tipo de cliente, sino cae al precio base.
  // Mayorista → wholesaleSalePrice > wholesalePrice (de la variante o producto)
  // Minorista → salePrice > price (de la variante o producto)
  const effectivePrice = (() => {
    if (activeVariant) {
      if (isMayorista) {
        if (activeVariant.wholesaleSalePrice != null && activeVariant.wholesalePrice != null
            && activeVariant.wholesaleSalePrice < activeVariant.wholesalePrice) {
          return activeVariant.wholesaleSalePrice;
        }
        if (activeVariant.wholesalePrice != null) return activeVariant.wholesalePrice;
        // Fallback al precio del producto padre si la variante no tiene mayorista
      } else {
        if (activeVariant.salePrice != null && activeVariant.price != null
            && activeVariant.salePrice < activeVariant.price) {
          return activeVariant.salePrice;
        }
        if (activeVariant.price != null) return activeVariant.price;
      }
    }
    if (!product) return 0;
    if (isMayorista && product.wholesalePrice) {
      if (product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice)
        return product.wholesaleSalePrice;
      return product.wholesalePrice;
    }
    if (product.salePrice && product.salePrice < product.price) return product.salePrice;
    return product.price;
  })();

  // Cantidad ya en el carrito para este producto/variante
  // Con variantes: buscar por variantId para no bloquear otras variantes del mismo producto
  const cartQty = (() => {
    if (!product) return 0;
    if (hasVariants && activeVariant) {
      return items.find((i) => i.id === product.id && i.variantId === activeVariant.id)?.quantity || 0;
    }
    return items.find((i) => i.id === product.id)?.quantity || 0;
  })();

  // Si el producto tiene variantes, el stock lo maneja la variante activa
  const activeStock     = activeVariant ? activeVariant.stock          : product?.stock;
  const activeUnlimited = activeVariant ? activeVariant.stockUnlimited : product?.stockUnlimited;
  const availableStock  = activeUnlimited || isMayorista ? Infinity : Math.max(0, (activeStock || 0) - cartQty);
  // Sin stock si: tiene variantes pero ninguna seleccionada → no bloquear; si está seleccionada y sin stock → sí
  const outOfStock = hasVariants
    ? (allAttrsSelected && !activeUnlimited && !isMayorista && availableStock === 0)
    : (!activeUnlimited && !isMayorista && availableStock === 0);

  // Devuelve el tier que corresponde a una cantidad dada (el de mayor minQty que no la supere)
  // Mayoristas usan wholesalePriceTiers; minoristas usan priceTiers
  const getTierForQty = (qty) => {
    const tiers = isMayorista
      ? (product?.wholesalePriceTiers?.length > 0 ? product.wholesalePriceTiers : null)
      : (product?.priceTiers?.length > 0 ? product.priceTiers : null);
    if (!tiers) return null;
    // parseInt/parseFloat para defender contra valores string guardados en DB antes del fix del backend
    return [...tiers]
      .sort((a, b) => parseInt(b.minQty) - parseInt(a.minQty))
      .find((t) => parseInt(qty) >= parseInt(t.minQty)) || null;
  };

  // Cambia la cantidad y auto-selecciona el tier correspondiente
  const changeQuantity = (newQty) => {
    setQuantity(newQty);
    setSelectedTier(getTierForQty(newQty));
  };

  const handleAddToCart = async () => {
    if (!product) return;
    if (!customer) {
      navigate("/login");
      return;
    }
    // Si hay variantes visibles para este cliente (sea minorista o mayorista), debe seleccionarlas.
    // Si product.variants viene vacío (todas filtradas por visibility), no se exige selección.
    const hasVisibleVariants = hasVariants && (product.variants?.length || 0) > 0;
    if (hasVisibleVariants && !allAttrsSelected) {
      toast.error("Seleccioná todas las opciones del producto");
      return;
    }
    if (outOfStock) return;
    const safeQty = isMayorista ? quantity : Math.min(quantity, availableStock);
    const tierPrice = (selectedTier && safeQty >= parseInt(selectedTier.minQty))
      ? selectedTier.price
      : null;
    // Pasar la variante seleccionada al carrito para mostrarla en el resumen
    const variantLabel = activeVariant
      ? activeVariant.combination.map((c) => `${c.name}: ${c.value}`).join(" / ")
      : null;
    // Si hay variante, el precio efectivo ya está calculado arriba (effectivePrice) y considera
    // la variante + tipo de cliente. Si además hay tier price (descuento por cantidad), ese tiene prioridad.
    const priceToCharge = tierPrice !== null ? tierPrice : (activeVariant ? effectivePrice : null);
    await addItem(product, safeQty, priceToCharge, activeVariant?.id || null, variantLabel);
    toast.success(`${safeQty}x "${product.name}"${variantLabel ? ` (${variantLabel})` : ""} agregado al carrito`);
  };

  if (loading) {
    return (
      <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          {/* Antes: border-blue-600 — actualizado a color verde del sistema de diseño */}
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00873a]" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          {/* Antes: emoji 😕 — reemplazado por Material Symbol para consistencia visual */}
          {/* <p className="text-5xl mb-4">😕</p> */}
          <span className="material-symbols-outlined text-[72px] text-[#bdcaba]">sentiment_dissatisfied</span>
          <p className="text-xl font-semibold text-[#0b1c30]">Producto no encontrado</p>
          {/* Antes: text-blue-600 — actualizado a color verde del sistema de diseño */}
          <Link to="/catalogo" className="text-sm text-[#006b2c] hover:underline font-medium">
            Volver al catálogo
          </Link>
        </div>
      </div>
    );
  }

  const SITE_URL = import.meta.env.VITE_SITE_URL || "https://igwtstore.com.ar";
  const metaTitle = `${product.name} | IGWT Store`;
  const metaDesc  = product.description
    ? product.description.replace(/<[^>]+>/g, "").slice(0, 160)
    : `Comprá ${product.name} en IGWT Store. Envíos a todo Argentina.`;
  const metaImage = product.images?.[0] ? getImageUrl(product.images[0]) : undefined;
  const metaUrl   = `${SITE_URL}/producto/${product.slug || product.id}`;

  return (
    <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta title={metaTitle} description={metaDesc} image={metaImage} url={metaUrl} />
      <Navbar />
      <main className="flex-1 max-w-[1280px] mx-auto px-6 py-8 w-full">

        {/* Breadcrumbs — chevron_right Material Symbol según template */}
        {/* Antes: separador "/ " de texto plano — ahora usa Material Symbol */}
        <nav className="flex items-center gap-1 mb-8 text-[#565e74] text-xs flex-wrap">
          <Link to="/" className="hover:text-[#006b2c] transition-colors">Inicio</Link>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_right</span>
          <Link to="/catalogo" className="hover:text-[#006b2c] transition-colors">Catálogo</Link>
          {/* Antes: product.category (single) — ahora product.categories (array M2M) */}
          {product.categories && product.categories.length > 0 && (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_right</span>
              {product.categories.map((cat, i) => (
                <span key={cat.id} className="flex items-center gap-1">
                  {i > 0 && <span className="mx-0.5">·</span>}
                  <Link to={`/catalogo?category=${cat.slug}`} className="hover:text-[#006b2c] transition-colors">
                    {cat.name}
                  </Link>
                </span>
              ))}
            </>
          )}
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>chevron_right</span>
          <span className="text-[#0b1c30] font-semibold">{product.name}</span>
        </nav>

        {/* Product Hero — lg:grid-cols-12 según template */}
        {/* Antes: grid grid-cols-1 md:grid-cols-2 gap-10 */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mb-16">

          {/* ── Galería — col-span-6 ── */}
          {/* Antes: col-span-7 — reducido a 6 para que la imagen no quede excesivamente grande */}
          <div className="lg:col-span-6">
            <div className="flex gap-4">

              {/* Thumbnails verticales — solo en desktop; en mobile se muestran debajo */}
              {totalImages > 1 && (
                <div className="hidden lg:flex flex-col gap-3 flex-shrink-0" style={{ width: 72 }}>
                  {galleryImages.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => handleSelectImage(i)}
                      className={`w-full aspect-square rounded-lg overflow-hidden p-1 bg-white transition-colors ${
                        selectedImage === i
                          ? "border-2 border-[#00873a]"
                          : "border border-[#bdcaba] hover:border-[#006b2c]"
                      }`}
                    >
                      <img src={getImageUrl(img)} alt="" className="w-full h-full object-contain" />
                    </button>
                  ))}
                </div>
              )}

              {/* Imagen principal */}
              {/* Antes: aspect-[4/5] del template — vuelto a aspect-square porque 4/5 resultaba demasiado alto */}
              <div
                className="flex-1 relative bg-[#eff4ff] rounded-xl border border-[#bdcaba] overflow-hidden group aspect-square"
                style={{ cursor: zoom ? "zoom-out" : "zoom-in" }}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 100;
                  const y = ((e.clientY - rect.top) / rect.height) * 100;
                  setZoomPos({ x, y });
                  setZoom(true);
                }}
                onMouseLeave={() => setZoom(false)}
              >
                {/* Fondo blanco — el bg-[#eff4ff] del contenedor padre cubre el espacio vacío.
                    Antes había una rama variantImageUrl que sobreescribía la galería; ahora la
                    variante solo cambia el índice (selectedImage), así el cliente sigue viendo
                    todo el carrusel y las flechas funcionan normal. */}
                {galleryImages[selectedImage] ? (
                  <img
                    key={`${activeVariant?.id || "noVariant"}-${selectedImage}`}
                    src={getImageUrl(galleryImages[selectedImage])}
                    alt={product.name}
                    className={`absolute inset-0 w-full h-full object-contain p-8 ${slideDir === "next" ? "carousel-slide-next" : "carousel-slide-prev"}`}
                    style={{
                      transform: zoom ? "scale(2.5)" : "scale(1)",
                      transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
                      transition: zoom ? "transform 0.08s ease-out" : "transform 0.25s ease-out",
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    {/* Antes: emoji 📦 — reemplazado por Material Symbol */}
                    {/* <div className="w-full h-full flex items-center justify-center text-7xl text-slate-300">📦</div> */}
                    <span className="material-symbols-outlined text-[80px] text-[#bdcaba]">inventory_2</span>
                  </div>
                )}

                {/* Flechas — solo si hay más de 1 imagen */}
                {totalImages > 1 && (
                  <>
                    <button
                      onClick={() => { goPrev(); clearInterval(autoplayRef.current); autoplayRef.current = setInterval(goNext, 5000); }}
                      // Sobre la flecha NO se hace zoom: apagamos el zoom al entrar y cortamos la
                      // propagación del mousemove para que el contenedor no lo vuelva a activar.
                      onMouseEnter={() => setZoom(false)}
                      onMouseMove={(e) => e.stopPropagation()}
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                    >
                      {/* Antes: carácter ‹ — reemplazado por Material Symbol */}
                      {/* ‹ */}
                      <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                    </button>
                    <button
                      onClick={() => { goNext(); clearInterval(autoplayRef.current); autoplayRef.current = setInterval(goNext, 5000); }}
                      onMouseEnter={() => setZoom(false)}
                      onMouseMove={(e) => e.stopPropagation()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                    >
                      {/* Antes: carácter › — reemplazado por Material Symbol */}
                      {/* › */}
                      <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                    </button>
                    {/* Indicador de posición */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {galleryImages.map((_, i) => (
                        <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === selectedImage ? "bg-white" : "bg-white/40"}`} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Thumbnails horizontales — solo en mobile (en desktop se muestran verticales a la izq.) */}
            {/* Antes: siempre visibles con overflow-x-auto — ahora solo en mobile (lg:hidden) */}
            {totalImages > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2 mt-3 lg:hidden">
                {galleryImages.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectImage(i)}
                    className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 p-1 bg-white transition-colors ${
                      selectedImage === i
                        ? "border-2 border-[#00873a]"
                        : "border border-[#bdcaba] hover:border-[#006b2c]"
                    }`}
                  >
                    <img src={getImageUrl(img)} alt="" className="w-full h-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Info del producto — col-span-6 ── */}
          {/* Antes: col-span-5 — ampliado a 6 para compensar la galería reducida */}
          <div className="lg:col-span-6 flex flex-col gap-5">

            {/* Categoría + título */}
            <div>
              {/* Antes: text-blue-600 — actualizado a text-[#006b2c] */}
              {product.categories && product.categories.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {product.categories.map((cat) => (
                    <Link
                      key={cat.id}
                      to={`/catalogo?category=${cat.slug}`}
                      className="text-xs font-semibold uppercase tracking-widest text-[#006b2c] hover:underline"
                    >
                      {cat.name}
                    </Link>
                  ))}
                </div>
              )}
              {/* Antes: text-3xl font-extrabold text-slate-900 */}
              <h1 className="text-3xl font-bold text-[#0b1c30] leading-tight">{product.name}</h1>
            </div>

            {/* Bloque de precio.
                Si hay una variante activa, usa los precios de la variante (con fallback al del producto si la variante no tiene).
                Si hay un tier seleccionado (descuento por cantidad), el precio principal muestra el precio del tier. */}
            {(() => {
              const isMayoristaUI = customer?.type === "MAYORISTA";
              // Fallback por GRUPO (no por campo): si la variante define su precio base, la oferta
              // sale SOLO de la variante (vacía = sin oferta). Antes el fallback era campo por campo
              // y una variante con precio propio ($14.999) heredaba la oferta del producto padre
              // ($1.000) → mostraba una oferta absurda que no correspondía.
              // Antes:
              // const pick = (varField, productField) => {
              //   if (activeVariant && activeVariant[varField] != null) return activeVariant[varField];
              //   return product[productField];
              // };
              // const basePrice     = isMayoristaUI ? pick("wholesalePrice", "wholesalePrice") : pick("price", "price");
              // const baseSalePrice = isMayoristaUI ? pick("wholesaleSalePrice", "wholesaleSalePrice") : pick("salePrice", "salePrice");
              const pickGroup = (baseField, saleField) =>
                activeVariant && activeVariant[baseField] != null
                  ? { base: activeVariant[baseField], sale: activeVariant[saleField] }
                  : { base: product[baseField], sale: product[saleField] };
              const priceGroup = isMayoristaUI
                ? pickGroup("wholesalePrice", "wholesaleSalePrice")
                : pickGroup("price", "salePrice");
              const basePrice     = priceGroup.base;
              const baseSalePrice = priceGroup.sale;
              // El precio "actual" considera la oferta (sale) si es menor
              const baseUnitPrice = baseSalePrice != null && basePrice != null && baseSalePrice < basePrice
                ? baseSalePrice
                : basePrice;
              const displayPrice = selectedTier ? selectedTier.price : baseUnitPrice;
              const hasTierDiscount = selectedTier && baseUnitPrice != null && selectedTier.price < baseUnitPrice;

              // ── Mayorista ──
              if (isMayoristaUI && basePrice != null) {
                const hasWholesaleSale = baseSalePrice != null && baseSalePrice < basePrice;
                return (
                  <div>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-4xl font-bold text-[#0b1c30]">{formatPrice(displayPrice)}</span>
                      {(hasWholesaleSale && !hasTierDiscount) && (
                        <span className="text-lg text-[#ba1a1a] line-through">{formatPrice(basePrice)}</span>
                      )}
                      {hasTierDiscount && (
                        <span className="text-lg text-[#ba1a1a] line-through">{formatPrice(baseUnitPrice)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {hasWholesaleSale && !hasTierDiscount && (
                        <span className="px-3 py-1 bg-red-500 text-white text-xs font-bold rounded-full">
                          {Math.round((1 - baseSalePrice / basePrice) * 100)}% OFF
                        </span>
                      )}
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                        hasWholesaleSale || hasTierDiscount
                          ? "bg-red-100 text-red-600"
                          : "bg-[#dce9ff] text-[#00174b]"
                      }`}>
                        {hasTierDiscount ? "Precio mayorista c/descuento" : hasWholesaleSale ? "Oferta mayorista" : "Precio mayorista"}
                      </span>
                    </div>
                  </div>
                );
              }

              // ── Minorista ──
              const originalPrice = basePrice;
              const showStrike = originalPrice != null && displayPrice < originalPrice;
              return (
                <div>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-4xl font-bold text-[#0b1c30]">{formatPrice(displayPrice)}</span>
                    {showStrike && (
                      <span className="text-lg text-[#ba1a1a] line-through">{formatPrice(originalPrice)}</span>
                    )}
                  </div>
                  {showStrike && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {!hasTierDiscount && (
                        <span className="px-3 py-1 bg-red-500 text-white text-xs font-bold rounded-full">
                          {Math.round((1 - displayPrice / originalPrice) * 100)}% OFF
                        </span>
                      )}
                      <span className="px-3 py-1 bg-red-100 text-red-600 text-xs font-semibold rounded-full">
                        {hasTierDiscount ? "Precio por cantidad" : "Precio oferta"}
                      </span>
                    </div>
                  )}
                  {/* Precio sin impuesto — calculado como price / 1.21, solo visible para MINORISTA */}
                  {customer?.type !== "MAYORISTA" && basePrice != null && (
                    <p className="text-xs text-[#565e74] mt-1">
                      Precio sin impuestos {formatPrice(basePrice / 1.21)}
                    </p>
                  )}
                </div>
              );
            })()}

            <hr className="border-[#bdcaba]/40" />

            {/* Tabla de descuentos por cantidad — clickeable para seleccionar */}
            {/* Mayoristas ven wholesalePriceTiers; minoristas ven priceTiers */}
            {(() => {
              const isMayorista = customer?.type === "MAYORISTA";
              const activeTiers = isMayorista
                ? (product.wholesalePriceTiers && product.wholesalePriceTiers.length > 0 ? product.wholesalePriceTiers : null)
                : (product.priceTiers && product.priceTiers.length > 0 ? product.priceTiers : null);
              // El % OFF se calcula contra el precio efectivo (variante > producto) para que sea consistente.
              // Fallback por GRUPO (igual que el bloque de precio de arriba): si la variante define su
              // precio base, la oferta solo puede venir de la variante — no se hereda la del padre.
              // Antes (campo por campo):
              // const pickField = (varField, productField) =>
              //   activeVariant && activeVariant[varField] != null ? activeVariant[varField] : product[productField];
              // const baseUnit = isMayorista ? pickField("wholesalePrice", "wholesalePrice") : pickField("price", "price");
              // const saleUnit = isMayorista ? pickField("wholesaleSalePrice", "wholesaleSalePrice") : pickField("salePrice", "salePrice");
              const pickTierGroup = (baseField, saleField) =>
                activeVariant && activeVariant[baseField] != null
                  ? { base: activeVariant[baseField], sale: activeVariant[saleField] }
                  : { base: product[baseField], sale: product[saleField] };
              const tierGroup = isMayorista
                ? pickTierGroup("wholesalePrice", "wholesaleSalePrice")
                : pickTierGroup("price", "salePrice");
              const baseUnit = tierGroup.base;
              const saleUnit = tierGroup.sale;
              const basePrice = saleUnit != null && baseUnit != null && saleUnit < baseUnit ? saleUnit : baseUnit;
              if (!activeTiers) return null;
              return (
                <div className="border border-[#bdcaba]/50 rounded-xl overflow-hidden">
                  {/* Antes: border-slate-200 bg-slate-50 — actualizado a tokens del sistema */}
                  <div className="bg-[#eff4ff] px-4 py-2 border-b border-[#bdcaba]/40">
                    <span className="text-sm font-semibold text-[#0b1c30]">Descuentos por cantidad</span>
                    {selectedTier && (
                      <button
                        onClick={() => changeQuantity(1)}
                        className="ml-3 text-xs text-[#565e74] hover:text-[#0b1c30] underline"
                      >
                        quitar selección
                      </button>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {activeTiers.map((tier, i) => {
                        const discountPct = basePrice > tier.price
                          ? Math.round(((basePrice - tier.price) / basePrice) * 100)
                          : null;
                        const isSelected = parseInt(selectedTier?.minQty) === parseInt(tier.minQty);
                        // Deshabilitar si el stock disponible no alcanza el mínimo del tier.
                        // Mayoristas tienen stock ilimitado, así que para ellos nunca se deshabilita.
                        const sinStockSuficiente = !isMayorista
                          && !product.stockUnlimited
                          && availableStock < parseInt(tier.minQty);
                        return (
                          <tr
                            key={i}
                            onClick={() => {
                              if (sinStockSuficiente) return; // ignorar click si no hay stock
                              changeQuantity(tier.minQty);
                            }}
                            title={sinStockSuficiente ? `Stock disponible: ${availableStock} unidades` : undefined}
                            className={`transition-colors ${
                              sinStockSuficiente
                                ? "opacity-40 cursor-not-allowed"
                                : isSelected
                                  /* Antes: bg-blue-50 border-l-4 border-blue-500 — actualizado a verde */
                                  ? "cursor-pointer bg-[#eff4ff] border-l-4 border-[#006b2c]"
                                  : `cursor-pointer ${i % 2 === 0 ? "bg-white hover:bg-[#f8f9ff]" : "bg-[#f8f9ff] hover:bg-[#eff4ff]"}`
                            }`}
                          >
                            <td className={`px-4 py-3 font-medium ${isSelected ? "text-[#006b2c]" : "text-[#565e74]"}`}>
                              +{tier.minQty} unidades
                              {sinStockSuficiente && (
                                <span className="ml-2 text-xs text-[#565e74]">(sin stock suficiente)</span>
                              )}
                            </td>
                            <td className={`px-4 py-3 font-semibold ${isSelected ? "text-[#006b2c]" : "text-[#0b1c30]"}`}>
                              {formatPrice(tier.price)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isSelected && (
                                /* Antes: text-blue-500 — actualizado a verde */
                                <span className="mr-2 text-[#006b2c] text-xs font-semibold">✓ seleccionado</span>
                              )}
                              {discountPct > 0 && !sinStockSuficiente && (
                                /* Antes: bg-green-100 text-green-700 — actualizado a tokens del sistema */
                                <span className="bg-[#dce9ff] text-[#00174b] text-xs font-bold px-2 py-1 rounded-full">
                                  {discountPct}% OFF
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* Selectores de variante — visibles si hay variantes filtradas por visibility para este cliente.
                Antes había un hard-code !isMayorista que bloqueaba mayoristas; ahora se basa en si el backend
                devolvió variantes visibles (filtradas por visibility + tipo de cliente). */}
            {hasVariants && (product.variants?.length || 0) > 0 && (
              <div className="space-y-4">
                {product.attributes.map((attr) => (
                  <div key={attr.id}>
                    <p className="text-sm font-semibold text-[#0b1c30] mb-2">
                      {attr.name}
                      {selectedAttrs[attr.name] && (
                        /* Antes: text-blue-600 — actualizado a verde */
                        <span className="ml-2 text-[#006b2c] font-normal">{selectedAttrs[attr.name]}</span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {attr.values
                        // Filtramos primero los valores que tienen AL MENOS una variante visible para este cliente.
                        // product.variants ya viene filtrado por visibility desde el backend. Si para una opción
                        // (ej: "1Mt") no hay ninguna variante visible, no renderizamos el botón en absoluto.
                        .filter((v) => (product.variants || []).some((pv) => {
                          const combo = Array.isArray(pv.combination)
                            ? pv.combination
                            : (typeof pv.combination === "string" ? JSON.parse(pv.combination) : null);
                          return combo?.some((c) => c.name === attr.name && c.value === v.value);
                        }))
                        .map((v) => {
                        // Verificar si esta opción tiene stock (combinación disponible)
                        const isSelected = selectedAttrs[attr.name] === v.value;
                        // Una opción está agotada si todas las variantes que la incluyen están sin stock
                        const relevantVariants = (product.variants || []).filter((pv) => {
                          const combo = Array.isArray(pv.combination)
                            ? pv.combination
                            : (typeof pv.combination === "string" ? JSON.parse(pv.combination) : null);
                          return combo?.some((c) => c.name === attr.name && c.value === v.value);
                        });
                        const soldOut = relevantVariants.length > 0 &&
                          relevantVariants.every((pv) => !pv.stockUnlimited && pv.stock === 0);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => !soldOut && setSelectedAttrs((prev) => ({ ...prev, [attr.name]: v.value }))}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                              isSelected
                                /* Antes: border-blue-600 bg-blue-50 text-blue-700 — actualizado a verde */
                                ? "border-2 border-[#00873a] bg-[#dce9ff] text-[#0b1c30] font-semibold"
                                : soldOut
                                  ? "border border-[#bdcaba] bg-[#f8f9ff] text-[#bdcaba] cursor-not-allowed line-through"
                                  : "border border-[#bdcaba] bg-white text-[#565e74] hover:border-[#006b2c]"
                            }`}
                          >
                            {v.value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!allAttrsSelected && (
                  <p className="text-xs text-amber-600 font-medium">⚠ Seleccioná todas las opciones para agregar al carrito</p>
                )}
              </div>
            )}

            {/* Stock */}
            <div className="flex items-center gap-2">
              {/* Para variantes: el backend garantiza stock si aparece; para sin variantes: chequear product.stock */}
              {(product.stockUnlimited || hasVariants || product.stock > 0) ? (
                <>
                  {/* Antes: span puntito bg-green-500 — reemplazado por Material Symbol check_circle filled */}
                  {/* <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> */}
                  <span
                    className="material-symbols-outlined text-[#006b2c]"
                    style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}
                  >check_circle</span>
                  <span className="text-sm text-[#006b2c] font-medium">En stock</span>
                </>
              ) : (
                <>
                  {/* Antes: span puntito bg-red-500 — reemplazado por Material Symbol cancel filled */}
                  {/* <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> */}
                  <span
                    className="material-symbols-outlined text-[#ba1a1a]"
                    style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}
                  >cancel</span>
                  <span className="text-sm text-[#ba1a1a] font-medium">Sin stock</span>
                </>
              )}
            </div>

            {/* Cantidad */}
            {!outOfStock && (
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm font-medium text-[#0b1c30]">Cantidad:</span>
                {/* Antes: botones bg-slate-100 con texto − + — actualizado a bg-[#eff4ff] con Material Symbols */}
                <div className="flex items-center bg-[#eff4ff] rounded-lg border border-[#bdcaba] p-1">
                  <button
                    onClick={() => changeQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                    className="w-10 h-10 flex items-center justify-center text-[#0b1c30] hover:bg-[#dce9ff]/60 rounded-md transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-[20px]">remove</span>
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={product.stockUnlimited ? undefined : availableStock}
                    value={quantity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (isNaN(val) || val < 1) return changeQuantity(1);
                      if (!product.stockUnlimited && !isMayorista && val > availableStock) return changeQuantity(availableStock);
                      changeQuantity(val);
                    }}
                    className="w-12 text-center font-semibold text-[#0b1c30] border-none bg-transparent focus:outline-none focus:ring-0"
                  />
                  <button
                    onClick={() => changeQuantity(isMayorista ? quantity + 1 : Math.min(availableStock, quantity + 1))}
                    className="w-10 h-10 flex items-center justify-center text-[#0b1c30] hover:bg-[#dce9ff]/60 rounded-md transition-all"
                  >
                    <span className="material-symbols-outlined text-[20px]">add</span>
                  </button>
                </div>
                {selectedTier && (
                  /* Antes: text-blue-600 — actualizado a verde */
                  <span className="text-xs text-[#006b2c] font-medium">
                    mín. {selectedTier.minQty} u. · {formatPrice(selectedTier.price)} c/u
                  </span>
                )}
              </div>
            )}

            {/* Botones de acción */}
            {/* Antes: btn-primary genérico con emoji 🛒 — actualizado a bg-[#00873a] + Material Symbol */}
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={handleAddToCart}
                disabled={outOfStock}
                className="w-full bg-[#00873a] text-white py-4 px-8 rounded-lg font-bold text-base flex items-center justify-center gap-2 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined">shopping_cart</span>
                {!customer
                  ? "Iniciar sesión para comprar"
                  : outOfStock
                    ? "Sin stock disponible"
                    : "Agregar al carrito"}
              </button>
              {/* Botón "Comprar ahora" — comentado por pedido del usuario */}
              {/* {customer && !outOfStock && (
                <button
                  onClick={async () => {
                    if (!customer) { navigate("/login"); return; }
                    await handleAddToCart();
                    navigate("/checkout");
                  }}
                  className="w-full border-2 border-[#0b1c30] text-[#0b1c30] hover:bg-[#0b1c30] hover:text-white py-4 px-8 rounded-lg font-bold text-base transition-all active:scale-95"
                >
                  Comprar ahora
                </button>
              )} */}
            </div>

            {/* Botón ver video — solo si el producto tiene youtubeUrl */}
            {product.youtubeUrl && getYoutubeEmbedUrl(product.youtubeUrl) && (
              <button
                onClick={() => setVideoOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-red-500 text-red-600 font-semibold hover:bg-red-50 transition-colors"
              >
                ▶ Ver video del producto
              </button>
            )}

            {/* Caja de info de envío — según template */}
            {/*
              Antes: emojis ✅📦🔒 en bg-slate-50 — reemplazado por Material Symbols en bg-[#eff4ff]
              <div className="mt-6 p-4 bg-slate-50 rounded-xl text-sm text-slate-600 space-y-2">
                <p>✅ Pago seguro con MercadoPago</p>
                <p>📦 Envíos a todo Argentina</p>
                <p>🔒 Compra protegida</p>
              </div>
            */}
            <div className="bg-[#eff4ff] p-4 rounded-xl border border-[#bdcaba]/50 space-y-3">
              <div className="flex gap-3 items-start">
                <span className="material-symbols-outlined text-[#006b2c]">local_shipping</span>
                <div>
                  <p className="text-sm font-semibold text-[#0b1c30]">Envíos a todo Argentina</p>
                  <p className="text-xs text-[#565e74]">Enviamos por Correo Argentino y otras empresas</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="material-symbols-outlined text-[#006b2c]">verified_user</span>
                <div>
                  <p className="text-sm font-semibold text-[#0b1c30]">Pago 100% seguro</p>
                  <p className="text-xs text-[#565e74]">Protegido con MercadoPago y encriptación SSL</p>
                </div>
              </div>
            </div>

            {/*
              Descripción comentada — fue movida al tab "Descripción" debajo del hero según template.
              En el diseño anterior estaba inline aquí en el panel derecho.
              {product.description && (
                <div
                  className="text-slate-600 leading-relaxed mb-6 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: product.description }}
                />
              )}
            */}
          </div>
        </section>

        {/* Sección tabs — solo "Descripción" (Especificaciones y Opiniones excluidos por diseño) */}
        {product.description && (
          <section className="mb-16">
            <div className="border-b border-[#bdcaba] flex gap-8 mb-6 overflow-x-auto">
              <button className="pb-4 border-b-2 border-[#006b2c] text-[#006b2c] font-bold text-sm whitespace-nowrap">
                Descripción
              </button>
              {/*
                Tabs comentados por solicitud del usuario — estaban tachados en el screenshot de referencia.
                <button className="pb-4 border-b-2 border-transparent text-[#565e74] hover:text-[#006b2c] font-medium text-sm whitespace-nowrap">Especificaciones</button>
                <button className="pb-4 border-b-2 border-transparent text-[#565e74] hover:text-[#006b2c] font-medium text-sm whitespace-nowrap">Opiniones</button>
              */}
            </div>
            {/*
              Descripción movida desde el panel derecho del hero a este tab.
              dangerouslySetInnerHTML: contenido HTML del editor TipTap — generado por admin autenticado, sin riesgo XSS externo.
              "Detalles Técnicos" box del template comentado por solicitud del usuario (también tachado en el screenshot).
            */}
            <div
              className="text-[#565e74] leading-relaxed prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: product.description }}
            />
          </section>
        )}

        {/* Productos relacionados */}
        {relatedProducts.length > 0 && (
          <section className="mb-16">
            <div className="flex justify-between items-end mb-8 flex-wrap gap-4">
              <div>
                {/* Antes: text-xl font-bold text-slate-800 — actualizado a tokens del sistema */}
                <h2 className="text-2xl font-bold text-[#0b1c30]">También te puede interesar</h2>
                <p className="text-[#565e74] text-sm mt-1">Complementa tu compra con estos productos</p>
              </div>
              <Link to="/catalogo" className="text-[#006b2c] font-bold hover:underline flex items-center gap-1 text-sm">
                Ver todo <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {relatedProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        )}

      </main>

      {/* Modal de video de YouTube — sin cambios de lógica */}
      {videoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setVideoOpen(false)}
        >
          <div
            className="relative w-full max-w-3xl bg-black rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setVideoOpen(false)}
              className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors text-lg font-bold"
            >
              ✕
            </button>
            <div className="aspect-video">
              <iframe
                src={getYoutubeEmbedUrl(product.youtubeUrl)}
                title={`Video de ${product.name}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          </div>
        </div>
      )}
      <Footer />
    </div>
  );
}
