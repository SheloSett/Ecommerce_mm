import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useWishlist } from "../context/WishlistContext";
import { getImageUrl, productsApi } from "../services/api";
import FitText from "./FitText";
import toast from "react-hot-toast";

// Convierte HTML del editor rico a texto plano para la card.
// Usar el DOM en vez de regex para decodificar también entidades (&amp; → &, &nbsp; → espacio, etc.)
function stripHtml(html) {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
}

export default function ProductCard({ product, viewMode = "grid" }) {
  const { addItem, items } = useCart();
  const { customer } = useCustomerAuth();
  const { toggle, isInWishlist } = useWishlist();
  const navigate = useNavigate();
  const [variantModal, setVariantModal] = useState(false);
  const [fullProduct, setFullProduct] = useState(null);   // datos completos con attributes + variants
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [selectedAttrs, setSelectedAttrs] = useState({});  // { [attrName]: value }
  const [addingVariant, setAddingVariant] = useState(false);
  const [variantQty, setVariantQty] = useState(1);
  // imgIdx: índice de la foto visible en la card — permite pasar el carrusel sin entrar al producto
  const [imgIdx, setImgIdx] = useState(0);

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  // Cantidad actual de este producto en el carrito
  const cartQty = items.find((i) => i.id === product.id)?.quantity || 0;

  const isMayorista = customer?.type === "MAYORISTA";
  // hasActiveVariants: ahora se basa solo en _count.variants — el backend YA filtra el conteo
  // según la visibilidad de la variante y el tipo de cliente (visibleFor query param).
  // Antes había un hard-code !isMayorista que bloqueaba mayoristas; ahora la decisión es del admin
  // al setear la visibility de cada variante (MINORISTA / MAYORISTA / AMBOS).
  const hasActiveVariants = (product._count?.variants ?? 0) > 0;
  // hasVariants: si el producto tiene variantes visibles para este cliente
  const hasVariants = (product._count?.variants ?? 0) > 0;

  // Sin stock: si el producto tiene variantes, el backend garantiza que aparece solo si hay stock.
  // Para MAYORISTA con variantes: product.stock es 0 (suma vacía), pero hay stock por variante — no mostrar "Sin stock".
  // Para productos sin variantes: si stockUnlimited es true nunca está sin stock; si no, chequear.
  const outOfStock = hasVariants
    ? false
    : !product.stockUnlimited && (product.stock === 0 || cartQty >= product.stock);

  // Al abrir el modal: cargar datos completos del producto (attributes + variants)
  useEffect(() => {
    if (!variantModal) {
      setFullProduct(null);
      setSelectedAttrs({});
      setVariantQty(1);
      return;
    }
    setLoadingProduct(true);
    // Pasamos visibleFor para que el backend filtre las variantes según el tipo de cliente
    const visibleFor = customer?.type === "MAYORISTA" ? "MAYORISTA" : "MINORISTA";
    productsApi.getById(product.id, { visibleFor })
      .then((res) => setFullProduct(res.data))
      .catch(console.error)
      .finally(() => setLoadingProduct(false));
  }, [variantModal, product.id, customer?.type]);

  // Variante activa: la que coincide exactamente con selectedAttrs
  const allAttrsSelected = fullProduct?.attributes?.length > 0 &&
    fullProduct.attributes.every((a) => selectedAttrs[a.name]);

  const activeVariant = (() => {
    if (!fullProduct || !allAttrsSelected) return null;
    return (fullProduct.variants || []).find((v) => {
      const combo = Array.isArray(v.combination)
        ? v.combination
        : (typeof v.combination === "string" ? JSON.parse(v.combination) : null);
      if (!combo) return false;
      return combo.every((c) => selectedAttrs[c.name] === c.value);
    }) || null;
  })();

  // modalHasAttrs: el modal muestra selectores de variantes; si no, es solo de cantidad
  const modalHasAttrs = fullProduct?.attributes?.length > 0;
  // Tope de cantidad para productos SIN variantes (lo que queda de stock menos lo ya carriteado)
  const noVariantMax = product.stockUnlimited ? null : Math.max(0, (product.stock || 0) - cartQty);
  // Botón "Agregar" del modal deshabilitado: cargando, agregando, o (con variantes) opciones incompletas/sin stock
  const modalAddDisabled = addingVariant || loadingProduct || (modalHasAttrs
    ? (!allAttrsSelected || (activeVariant && !activeVariant.stockUnlimited && activeVariant.stock === 0))
    : !fullProduct);

  // Precio unitario efectivo del producto (según tipo de cliente, con oferta si aplica)
  const productEffectivePrice = (() => {
    if (isMayorista && product.wholesalePrice) {
      return (product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice)
        ? product.wholesaleSalePrice
        : product.wholesalePrice;
    }
    return (product.salePrice && product.salePrice < product.price) ? product.salePrice : product.price;
  })();

  // Precio unitario dentro del modal: el de la variante elegida (si define precio propio) o el del producto
  const modalUnitPrice = (() => {
    if (modalHasAttrs) {
      if (!allAttrsSelected || !activeVariant) return null; // hasta no elegir todo, el precio varía
      if (isMayorista) {
        if (activeVariant.wholesalePrice != null) {
          return (activeVariant.wholesaleSalePrice != null && activeVariant.wholesaleSalePrice < activeVariant.wholesalePrice)
            ? activeVariant.wholesaleSalePrice
            : activeVariant.wholesalePrice;
        }
      } else {
        if (activeVariant.price != null) {
          return (activeVariant.salePrice != null && activeVariant.salePrice < activeVariant.price)
            ? activeVariant.salePrice
            : activeVariant.price;
        }
      }
      return productEffectivePrice; // variante sin precio propio → hereda el del producto
    }
    return productEffectivePrice;
  })();

  // Bloque de precio del modal: precio unitario + subtotal en chico (precio × cantidad)
  const ModalPriceInfo = () => {
    if (modalUnitPrice == null) return null;
    return (
      <div className="flex items-end justify-between gap-3 pt-1 border-t border-slate-100 mt-1">
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mt-2">Precio</p>
          <p className="text-lg font-bold text-slate-900">{formatPrice(modalUnitPrice)}</p>
        </div>
        <p className="text-xs text-slate-500 pb-1">
          Subtotal: <span className="font-semibold text-slate-700">{formatPrice(modalUnitPrice * variantQty)}</span>
        </p>
      </div>
    );
  };

  // Cuerpo del modal para productos SIN variantes: solo selector de cantidad (+ aviso de tiers)
  const QtyOnlyBody = () => (
    <>
      {(() => {
        const tiers = isMayorista ? fullProduct?.wholesalePriceTiers : fullProduct?.priceTiers;
        const hasTiers = Array.isArray(tiers) && tiers.length > 0;
        if (!hasTiers) return null;
        return (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
            <p className="text-xs text-blue-700 font-medium leading-snug">
              💰 Este producto tiene mejores precios llevando cantidad
            </p>
            <Link
              to={`/producto/${product.slug || product.id}`}
              onClick={() => setVariantModal(false)}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap underline underline-offset-2 transition-colors flex-shrink-0"
            >
              Ver publicación →
            </Link>
          </div>
        );
      })()}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Cantidad</span>
          <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); setVariantQty((q) => Math.max(1, q - 1)); }}
              className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 font-bold text-base transition-colors"
            >−</button>
            <span className="px-4 py-1.5 text-sm font-semibold text-slate-800 min-w-[2.5rem] text-center">{variantQty}</span>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); setVariantQty((q) => (noVariantMax != null && q >= noVariantMax) ? q : q + 1); }}
              className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 font-bold text-base transition-colors"
            >+</button>
          </div>
        </div>
        <span className="text-xs text-slate-400 whitespace-nowrap">
          {product.stockUnlimited ? "Stock disponible" : `Stock: ${noVariantMax}`}
        </span>
      </div>
      {/* Precio unitario + subtotal según la cantidad elegida */}
      <ModalPriceInfo />
    </>
  );

  const handleAddVariantToCart = async (e) => {
    e.preventDefault();
    // Producto SIN variantes: el modal es solo de cantidad — agrega directo con la qty elegida
    const hasAttrs = fullProduct?.attributes?.length > 0;
    if (!hasAttrs) {
      setAddingVariant(true);
      try {
        await addItem(fullProduct || product, variantQty);
        toast.success(`"${product.name}" ×${variantQty} agregado al carrito`);
        setVariantModal(false); // sin opciones que seguir eligiendo — se cierra
      } catch (err) {
        toast.error(err.response?.data?.error || "No se pudo agregar al carrito");
      } finally {
        setAddingVariant(false);
        setVariantQty(1);
      }
      return;
    }
    if (!allAttrsSelected) {
      toast.error("Seleccioná todas las opciones");
      return;
    }
    if (activeVariant && !activeVariant.stockUnlimited && activeVariant.stock === 0) {
      toast.error("Esta variante no tiene stock");
      return;
    }
    setAddingVariant(true);
    const variantLabel = activeVariant
      ? activeVariant.combination.map((c) => `${c.name}: ${c.value}`).join(" / ")
      : null;
    // Precio de la variante según tipo de cliente. Si la variante no tiene precio definido,
    // caemos a null para que CartContext use el del producto padre.
    const variantPrice = (() => {
      if (!activeVariant) return null;
      if (isMayorista) {
        if (activeVariant.wholesaleSalePrice != null && activeVariant.wholesalePrice != null
            && activeVariant.wholesaleSalePrice < activeVariant.wholesalePrice) return activeVariant.wholesaleSalePrice;
        if (activeVariant.wholesalePrice != null) return activeVariant.wholesalePrice;
      } else {
        if (activeVariant.salePrice != null && activeVariant.price != null
            && activeVariant.salePrice < activeVariant.price) return activeVariant.salePrice;
        if (activeVariant.price != null) return activeVariant.price;
      }
      return null;
    })();
    await addItem(fullProduct, variantQty, variantPrice, activeVariant?.id || null, variantLabel);
    toast.success(`"${product.name}"${variantLabel ? ` (${variantLabel})` : ""} ×${variantQty} agregado al carrito`);
    setAddingVariant(false);
    // No cerramos el modal: el cliente puede seguir eligiendo otra variante
    setSelectedAttrs({});
    setVariantQty(1);
  };

  const handleAddToCart = (e) => {
    e.preventDefault(); // Evitar que navegue al detalle al hacer click en el botón
    if (outOfStock) return;
    // Si no hay usuario logueado, redirigir al login sin mostrar notificación
    if (!customer) {
      navigate("/login");
      return;
    }
    // Antes: solo los productos con variantes abrían el modal; sin variantes se agregaba directo:
    // if (hasActiveVariants) {
    //   setVariantModal(true);
    //   return;
    // }
    // addItem(product);
    // toast.success(`"${product.name}" agregado al carrito`);
    // Ahora TODOS los productos abren el modal: con variantes pide opciones + cantidad,
    // sin variantes pide solo la cantidad deseada (pedido del cliente).
    setVariantModal(true);
  };

  // Antes: const img = product.images?.[0];
  // Ahora la card muestra la foto del índice actual del mini-carrusel (flechas en la imagen).
  const imgs = product.images || [];
  const img = imgs[imgIdx] ?? imgs[0];

  // Flechas del mini-carrusel de la card (preventDefault: la card es un <Link>)
  const prevImg = (e) => {
    e.preventDefault(); e.stopPropagation();
    setImgIdx((i) => (i - 1 + imgs.length) % imgs.length);
  };
  const nextImg = (e) => {
    e.preventDefault(); e.stopPropagation();
    setImgIdx((i) => (i + 1) % imgs.length);
  };

  // Controles superpuestos del carrusel: flechas + puntitos (solo si hay más de una foto)
  const CarouselControls = () => imgs.length > 1 ? (
    <>
      <button
        type="button"
        onClick={prevImg}
        aria-label="Foto anterior"
        className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-white/85 shadow hover:bg-white transition-colors text-slate-600"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <button
        type="button"
        onClick={nextImg}
        aria-label="Foto siguiente"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-white/85 shadow hover:bg-white transition-colors text-slate-600"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-10 flex gap-1">
        {imgs.map((_, i) => (
          <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === imgIdx ? "bg-[#00873a]" : "bg-slate-300"}`} />
        ))}
      </div>
    </>
  ) : null;

  // ── Vista lista ────────────────────────────────────────────────────────────
  if (viewMode === "list") {
    return (
      <>
      {variantModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { e.preventDefault(); setVariantModal(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 p-4 border-b border-slate-100">
              {img ? <img src={getImageUrl(img)} alt={product.name} className="w-16 h-16 object-cover rounded-xl flex-shrink-0 border border-slate-100" />
                : <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-2xl flex-shrink-0">📦</div>}
              <div className="flex-1 min-w-0">
                <Link to={`/producto/${product.slug || product.id}`} onClick={() => setVariantModal(false)} className="font-bold text-slate-900 text-sm leading-tight line-clamp-2 hover:text-blue-600 transition-colors">{product.name}</Link>
                <p className="text-xs text-slate-400 mt-0.5">{hasActiveVariants ? "Elegí las opciones para agregar al carrito" : "Elegí la cantidad para agregar al carrito"}</p>
              </div>
              <button onClick={(e) => { e.preventDefault(); setVariantModal(false); }} className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors p-1">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              {loadingProduct ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
              ) : fullProduct?.attributes?.length > 0 ? (
                <>
                  {(() => {
                    const tiers = isMayorista ? fullProduct?.wholesalePriceTiers : fullProduct?.priceTiers;
                    const hasTiers = Array.isArray(tiers) && tiers.length > 0;
                    if (!hasTiers) return null;
                    return (
                      <div className="bg-[#eff4ff] border border-[#bdcaba]/50 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
                        <p className="text-xs text-[#0b1c30] font-medium leading-snug">
                          💰 Este producto tiene mejores precios llevando cantidad
                        </p>
                        <Link
                          to={`/producto/${product.slug || product.id}`}
                          onClick={() => setVariantModal(false)}
                          className="text-xs font-semibold text-[#006b2c] hover:text-[#004d1c] whitespace-nowrap underline underline-offset-2 transition-colors flex-shrink-0"
                        >
                          Ver publicación →
                        </Link>
                      </div>
                    );
                  })()}
                  {fullProduct.attributes.map((attr) => (
                    <div key={attr.id}>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                        {attr.name}
                        {selectedAttrs[attr.name] && (
                          <span className="ml-2 text-blue-600 normal-case font-semibold">{selectedAttrs[attr.name]}</span>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {attr.values
                          // Solo mostrar valores que tengan al menos una variante visible para este cliente
                          // (fullProduct.variants ya viene filtrado por visibility desde el backend)
                          .filter((v) => (fullProduct.variants || []).some((pv) => {
                            const combo = Array.isArray(pv.combination)
                              ? pv.combination
                              : (typeof pv.combination === "string" ? JSON.parse(pv.combination) : null);
                            return combo?.some((c) => c.name === attr.name && c.value === v.value);
                          }))
                          .map((v) => {
                          const isSelected = selectedAttrs[attr.name] === v.value;
                          const relevantVariants = (fullProduct.variants || []).filter((pv) => {
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
                              onClick={(e) => {
                                e.preventDefault();
                                if (!soldOut) setSelectedAttrs((prev) => ({ ...prev, [attr.name]: v.value }));
                              }}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                                isSelected
                                  ? "border-[#006b2c] bg-[#006b2c]/5 text-[#006b2c]"
                                  : soldOut
                                    ? "border-[#bdcaba]/30 bg-[#f8f9ff] text-[#bdcaba] cursor-not-allowed line-through"
                                    : "border-[#bdcaba]/50 hover:border-[#006b2c]/60 text-[#565e74]"
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
                    <p className="text-xs text-amber-600 font-medium">⚠ Seleccioná todas las opciones para continuar</p>
                  )}
                  {allAttrsSelected && activeVariant && !activeVariant.stockUnlimited && activeVariant.stock === 0 && (
                    <p className="text-xs text-red-500 font-medium">✕ Esta combinación no tiene stock</p>
                  )}
                  <div className="flex items-center gap-3 pt-1">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Cantidad</span>
                    <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setVariantQty((q) => Math.max(1, q - 1)); }}
                        className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 font-bold text-base transition-colors"
                      >−</button>
                      <span className="px-4 py-1.5 text-sm font-semibold text-slate-800 min-w-[2.5rem] text-center">{variantQty}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setVariantQty((q) => q + 1); }}
                        className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 font-bold text-base transition-colors"
                      >+</button>
                    </div>
                  </div>
                  {/* Precio de la variante elegida + subtotal según cantidad */}
                  <ModalPriceInfo />
                </>
              ) : fullProduct ? (
                /* Producto SIN variantes: el modal pide solo la cantidad deseada */
                <QtyOnlyBody />
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">No se pudieron cargar las opciones</p>
              )}
            </div>
            {/* Footer: botones Salir / Agregar al carrito */}
            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={(e) => { e.preventDefault(); setVariantModal(false); }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Salir
              </button>
              <button
                onClick={handleAddVariantToCart}
                disabled={modalAddDisabled}
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#00873a] text-white text-sm font-bold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {addingVariant ? (
                  <><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Agregando...</>
                ) : (
                  "🛒 Agregar al carrito"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl border border-[#bdcaba]/30 p-4 flex flex-row gap-5 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] hover:shadow-[0px_8px_30px_rgba(15,23,42,0.08)] hover:-translate-y-0.5 transition-all duration-300">
        {/* Imagen grande */}
        <Link
          to={`/producto/${product.slug || product.id}`}
          className="relative flex-shrink-0 w-40 h-40 rounded-2xl overflow-hidden border border-slate-100"
          style={{ backgroundColor: "#ffffff" }}
        >
          {img ? (
            <img src={getImageUrl(img)} alt={product.name} className="w-full h-full object-contain p-2" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-5xl text-slate-200">📦</div>
          )}
          {/* Mini-carrusel: flechas + puntitos para pasar las fotos sin entrar al producto */}
          <CarouselControls />
          {/* Badge % OFF — se muestra para minoristas (salePrice) o mayoristas (wholesaleSalePrice) */}
          {(() => {
            const isMay = customer?.type === "MAYORISTA";
            const hasSale = isMay
              ? product.wholesaleSalePrice && product.wholesalePrice && product.wholesaleSalePrice < product.wholesalePrice
              : product.salePrice && product.salePrice < product.price;
            if (!hasSale) return null;
            const pct = isMay
              ? Math.round((1 - product.wholesaleSalePrice / product.wholesalePrice) * 100)
              : Math.round((1 - product.salePrice / product.price) * 100);
            return (
              <span className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
                {pct}% OFF
              </span>
            );
          })()}
          {/* Botón favorito */}
          <button
            onClick={(e) => { e.preventDefault(); toggle(product); }}
            title={isInWishlist(product.id) ? "Quitar de favoritos" : "Guardar en favoritos"}
            className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow hover:bg-white transition-colors"
          >
            {isInWishlist(product.id)
              ? <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              : <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>}
          </button>
        </Link>

        {/* Info — ocupa todo el espacio restante */}
        <div className="flex-1 flex flex-col justify-between min-w-0 py-1">
          {/* Arriba: nombre + categoría + descripción */}
          <div>
            {product.categories?.[0] && (
              <p className="text-xs font-medium text-[#006b2c] uppercase tracking-wide mb-1">{product.categories[0].name}</p>
            )}
            <Link to={`/producto/${product.slug || product.id}`}>
              <h3 className="font-bold text-[#0b1c30] text-base leading-snug line-clamp-2 hover:text-[#006b2c] transition-colors">{product.name}</h3>
            </Link>
            {product.description && (
              <p className="text-sm text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">{stripHtml(product.description)}</p>
            )}
          </div>

          {/* Abajo: precio + botón. min-w-0 en el contenedor de precio para que no fuerce overflow en mobile */}
          <div className="flex items-end justify-between gap-2 sm:gap-4 mt-3">
            <div className="min-w-0 flex-1">
              {customer?.type === "MAYORISTA" && product.wholesalePrice ? (
                product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice ? (
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs sm:text-sm text-slate-400 line-through">{formatPrice(product.wholesalePrice)}</span>
                    <span className="font-bold text-green-700 text-base sm:text-xl">{formatPrice(product.wholesaleSalePrice)}</span>
                    <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-md">
                      {Math.round((1 - product.wholesaleSalePrice / product.wholesalePrice) * 100)}% OFF
                    </span>
                    <span className="text-xs text-green-600 font-medium w-full">mayorista</span>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-bold text-green-700 text-base sm:text-xl">{formatPrice(product.wholesalePrice)}</span>
                    <span className="text-xs text-green-600 font-medium">mayorista</span>
                  </div>
                )
              ) : product.salePrice && product.salePrice < product.price ? (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-xs sm:text-sm text-slate-400 line-through">{formatPrice(product.price)}</span>
                  <span className="font-bold text-red-600 text-base sm:text-xl">{formatPrice(product.salePrice)}</span>
                  <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-md">
                    {Math.round((1 - product.salePrice / product.price) * 100)}% OFF
                  </span>
                </div>
              ) : (
                <span className="font-bold text-slate-900 text-base sm:text-xl">{formatPrice(product.price)}</span>
              )}
              {!outOfStock && product.stock != null && product.stock > 0 && !product.stockUnlimited && product.stock <= 5 && (
                <p className="text-xs text-amber-500 font-medium mt-0.5">⚠ Últimas {product.stock} unidades</p>
              )}
            </div>

            {/* Botón agregar — más compacto en mobile para no romper el layout */}
            <div className="flex-shrink-0">
              {outOfStock ? (
                <span className="text-xs sm:text-sm text-[#565e74] font-medium">Sin stock</span>
              ) : customer ? (
                <button
                  onClick={handleAddToCart}
                  className="px-3 sm:px-5 py-2 bg-[#00873a] text-white text-xs sm:text-sm font-semibold rounded-[10px] hover:brightness-110 transition-all whitespace-nowrap"
                >
                  + Agregar
                </button>
              ) : (
                <button
                  onClick={handleAddToCart}
                  className="px-3 sm:px-4 py-2 border border-[#bdcaba] text-[#0b1c30] text-xs sm:text-sm font-semibold rounded-[10px] hover:bg-[#dce9ff]/30 transition-colors whitespace-nowrap"
                >
                  Iniciar sesión
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
    {/* Modal: selección de variantes directo desde la card */}
    {variantModal && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={(e) => { e.preventDefault(); setVariantModal(false); }}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header con imagen y nombre */}
          <div className="flex items-center gap-3 p-4 border-b border-slate-100">
            {product.images?.[0] ? (
              <img
                src={getImageUrl(product.images[0])}
                alt={product.name}
                className="w-16 h-16 object-cover rounded-xl flex-shrink-0 border border-slate-100"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-2xl flex-shrink-0">📦</div>
            )}
            <div className="flex-1 min-w-0">
              <Link
                to={`/producto/${product.slug || product.id}`}
                onClick={() => setVariantModal(false)}
                className="font-bold text-[#0b1c30] text-sm leading-tight line-clamp-2 hover:text-[#006b2c] transition-colors"
              >
                {product.name}
              </Link>
              <p className="text-xs text-slate-400 mt-0.5">{hasActiveVariants ? "Elegí las opciones para agregar al carrito" : "Elegí la cantidad para agregar al carrito"}</p>
            </div>
            <button
              onClick={(e) => { e.preventDefault(); setVariantModal(false); }}
              className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors p-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Cuerpo: selectores de atributos */}
          <div className="p-4 space-y-4">
            {loadingProduct ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : fullProduct?.attributes?.length > 0 ? (
              <>
                {/* Aviso de descuentos por cantidad — arriba de las variantes */}
                {(() => {
                  const tiers = isMayorista ? fullProduct?.wholesalePriceTiers : fullProduct?.priceTiers;
                  const hasTiers = Array.isArray(tiers) && tiers.length > 0;
                  if (!hasTiers) return null;
                  return (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
                      <p className="text-xs text-blue-700 font-medium leading-snug">
                        💰 Este producto tiene mejores precios llevando cantidad
                      </p>
                      <Link
                        to={`/producto/${product.slug || product.id}`}
                        onClick={() => setVariantModal(false)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap underline underline-offset-2 transition-colors flex-shrink-0"
                      >
                        Ver publicación →
                      </Link>
                    </div>
                  );
                })()}

                {fullProduct.attributes.map((attr) => (
                  <div key={attr.id}>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                      {attr.name}
                      {selectedAttrs[attr.name] && (
                        <span className="ml-2 text-blue-600 normal-case font-semibold">{selectedAttrs[attr.name]}</span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {attr.values.map((v) => {
                        const isSelected = selectedAttrs[attr.name] === v.value;
                        const relevantVariants = (fullProduct.variants || []).filter((pv) => {
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
                            onClick={(e) => {
                              e.preventDefault();
                              if (!soldOut) setSelectedAttrs((prev) => ({ ...prev, [attr.name]: v.value }));
                            }}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                              isSelected
                                ? "border-blue-600 bg-blue-50 text-blue-700"
                                : soldOut
                                  ? "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed line-through"
                                  : "border-slate-200 hover:border-blue-400 text-slate-700"
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
                  <p className="text-xs text-amber-600 font-medium">⚠ Seleccioná todas las opciones para continuar</p>
                )}
                {allAttrsSelected && activeVariant && !activeVariant.stockUnlimited && activeVariant.stock === 0 && (
                  <p className="text-xs text-red-500 font-medium">✕ Esta combinación no tiene stock</p>
                )}
                {/* Selector de cantidad */}
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Cantidad</span>
                  <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setVariantQty((q) => Math.max(1, q - 1)); }}
                      className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 font-bold text-base transition-colors"
                    >−</button>
                    <span className="px-4 py-1.5 text-sm font-semibold text-slate-800 min-w-[2.5rem] text-center">{variantQty}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); setVariantQty((q) => q + 1); }}
                      className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 font-bold text-base transition-colors"
                    >+</button>
                  </div>
                </div>
                {/* Precio de la variante elegida + subtotal según cantidad */}
                <ModalPriceInfo />
              </>
            ) : fullProduct ? (
              /* Producto SIN variantes: el modal pide solo la cantidad deseada */
              <QtyOnlyBody />
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">No se pudieron cargar las opciones</p>
            )}
          </div>

          {/* Footer: botones */}
          <div className="flex gap-2 px-4 pb-4">
            <button
              onClick={(e) => { e.preventDefault(); setVariantModal(false); }}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Salir
            </button>
            <button
              onClick={handleAddVariantToCart}
              disabled={modalAddDisabled}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#00873a] text-white text-sm font-bold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {addingVariant ? (
                <><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Agregando...</>
              ) : (
                "🛒 Agregar al carrito"
              )}
            </button>
          </div>
        </div>
      </div>
    )}
    <Link
      to={`/producto/${product.slug || product.id}`}
      className="bg-white rounded-xl border border-[#bdcaba]/30 overflow-hidden shadow-[0px_4px_20px_rgba(15,23,42,0.05)] hover:shadow-[0px_8px_30px_rgba(15,23,42,0.1)] hover:-translate-y-1 transition-all duration-300 group flex flex-col"
    >
      {/* Imagen */}
      <div className="relative aspect-square overflow-hidden bg-[#eff4ff]">
        {img ? (
          <>
            {/* Sin fondo borroso — bg-white del contenedor cubre el espacio vacío */}
            <img
              src={getImageUrl(img)}
              alt={product.name}
              // group-hover:scale-105 removido — la animación pasa al card (hover:-translate-y-1) por pedido del usuario
              className="relative w-full h-full object-contain"
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-slate-300">
            📦
          </div>
        )}

        {/* Mini-carrusel: flechas + puntitos para pasar las fotos sin entrar al producto */}
        <CarouselControls />

        {/* Botón favorito */}
        <button
          onClick={(e) => { e.preventDefault(); toggle(product); }}
          title={isInWishlist(product.id) ? "Quitar de favoritos" : "Guardar en favoritos"}
          className="absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white shadow-md hover:bg-red-50 hover:scale-110 transition-all duration-150"
        >
          {isInWishlist(product.id) ? (
            <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
            </svg>
          )}
        </button>

        {/* Badge destacado */}
        {product.featured && (
          <span className="absolute top-2 left-2 bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded-full">
            Destacado
          </span>
        )}

        {/* Badge más vendido — icono fuego con tooltip "Más vendidos" */}
        {product.hotSeller && (
          <span
            className="absolute top-10 right-2 text-xl cursor-default group/fire"
            title="Más vendidos"
          >
            🔥
            <span className="absolute -bottom-7 right-0 bg-slate-800 text-white text-[10px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover/fire:opacity-100 transition-opacity pointer-events-none">
              Más vendidos
            </span>
          </span>
        )}

        {/* Badge sin stock */}
        {outOfStock && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="bg-white text-slate-800 text-sm font-bold px-3 py-1 rounded-full">
              {product.stock === 0 ? "Sin stock" : "Máximo en carrito"}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-slate-800 text-sm leading-tight mb-2 flex-1 line-clamp-2">
          {product.name}
        </h3>
        {/* "Últimas unidades" va ANTES del bloque precio+botón para que el botón siempre quede al fondo */}
        {!hasVariants && !product.stockUnlimited && product.stock > 0 && product.stock <= 5 && (
          <p className="text-xs text-orange-500 font-medium mb-2">
            ⚠️ Últimas {product.stock} unidades
          </p>
        )}
        {/* Bloque precio + botón APILADO verticalmente.
            Antes estaba en flex-row (precio izq / botón der) y en cards angostas (iPad Pro
            con 4 columnas) el precio se truncaba o se montaba sobre el botón.
            Ahora: precio ocupa todo el ancho con FitText (autoshrink) y el botón va abajo full width. */}
        <div className="flex flex-col gap-2">
          {/* Precio: ocupa todo el ancho del card y se achica si no entra */}
          <div className="flex flex-col min-w-0">
            {customer?.type === "MAYORISTA" && product.wholesalePrice ? (
              product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice ? (
                <>
                  <span className="text-xs text-slate-400 line-through">{formatPrice(product.wholesalePrice)}</span>
                  <FitText max={18} min={12} className="font-bold text-green-700">{formatPrice(product.wholesaleSalePrice)}</FitText>
                  <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-md self-center">
                    {Math.round((1 - product.wholesaleSalePrice / product.wholesalePrice) * 100)}% OFF
                  </span>
                  <span className="text-xs text-green-600 font-semibold">mayorista</span>
                </>
              ) : (
                <>
                  <FitText max={18} min={12} className="font-bold text-green-700">{formatPrice(product.wholesalePrice)}</FitText>
                  <span className="text-xs text-green-600 font-semibold">mayorista</span>
                </>
              )
            ) : product.salePrice && product.salePrice < product.price ? (
              <>
                <span className="text-xs text-slate-400 line-through">{formatPrice(product.price)}</span>
                <FitText max={18} min={12} className="font-bold text-red-600">{formatPrice(product.salePrice)}</FitText>
                <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-md self-center">
                  {Math.round((1 - product.salePrice / product.price) * 100)}% OFF
                </span>
              </>
            ) : (
              <FitText max={18} min={12} className="font-bold text-slate-900">{formatPrice(product.price)}</FitText>
            )}
          </div>
          {/* Botón ocupa todo el ancho, así nunca compite por espacio con el precio */}
          {customer ? (
            <button
              onClick={handleAddToCart}
              disabled={outOfStock}
              className="w-full py-2 bg-[#00873a] text-white text-xs sm:text-sm font-semibold rounded-[10px] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">add_shopping_cart</span>
              Agregar
            </button>
          ) : (
            <button
              onClick={handleAddToCart}
              className="w-full py-2 border border-[#bdcaba] text-[#0b1c30] text-xs sm:text-sm font-semibold rounded-[10px] hover:bg-[#dce9ff]/30 transition-colors"
            >
              Iniciar sesión
            </button>
          )}
        </div>
      </div>
    </Link>
    </>
  );
}
