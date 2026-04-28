import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useWishlist } from "../context/WishlistContext";
import { getImageUrl, productsApi } from "../services/api";
import toast from "react-hot-toast";

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

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  // Cantidad actual de este producto en el carrito
  const cartQty = items.find((i) => i.id === product.id)?.quantity || 0;

  const isMayorista = customer?.type === "MAYORISTA";
  // hasActiveVariants: controla si se muestra el modal de selección de variante (solo MINORISTA)
  const hasActiveVariants = !isMayorista && (product._count?.variants ?? 0) > 0;
  // hasVariants: si el producto tiene variantes (cualquier tipo de cliente)
  const hasVariants = (product._count?.variants ?? 0) > 0;

  // Sin stock: si el producto tiene variantes, el backend garantiza que aparece solo si hay stock.
  // Para MAYORISTA con variantes: product.stock es 0 (suma vacía), pero hay stock por variante — no mostrar "Sin stock".
  // Para productos sin variantes: usar product.stock directamente.
  const outOfStock = hasVariants
    ? false
    : product.stock === 0 || (!product.stockUnlimited && cartQty >= product.stock);

  // Al abrir el modal: cargar datos completos del producto (attributes + variants)
  useEffect(() => {
    if (!variantModal) {
      setFullProduct(null);
      setSelectedAttrs({});
      setVariantQty(1);
      return;
    }
    setLoadingProduct(true);
    productsApi.getById(product.id)
      .then((res) => setFullProduct(res.data))
      .catch(console.error)
      .finally(() => setLoadingProduct(false));
  }, [variantModal, product.id]);

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

  const handleAddVariantToCart = async (e) => {
    e.preventDefault();
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
    await addItem(fullProduct, variantQty, null, activeVariant?.id || null, variantLabel);
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
    // Si tiene variantes activas, mostrar modal en lugar de agregar directo
    if (hasActiveVariants) {
      setVariantModal(true);
      return;
    }
    addItem(product);
    toast.success(`"${product.name}" agregado al carrito`);
  };

  const img = product.images?.[0];

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
                <Link to={`/producto/${product.id}`} onClick={() => setVariantModal(false)} className="font-bold text-slate-900 text-sm leading-tight line-clamp-2 hover:text-blue-600 transition-colors">{product.name}</Link>
                <p className="text-xs text-slate-400 mt-0.5">Elegí las opciones para agregar al carrito</p>
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
                      <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-3">
                        <p className="text-xs text-blue-700 font-medium leading-snug">
                          💰 Este producto tiene mejores precios llevando cantidad
                        </p>
                        <Link
                          to={`/producto/${product.id}`}
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
                </>
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
                disabled={!allAttrsSelected || addingVariant || (activeVariant && !activeVariant.stockUnlimited && activeVariant.stock === 0)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
      <div className="card flex flex-row gap-4 p-3 hover:shadow-md transition-shadow duration-200">
        {/* Imagen */}
        <Link to={`/producto/${product.id}`} className="relative flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-slate-100" style={{ backgroundColor: "#ffffff" }}>
          {img ? (
            <img src={getImageUrl(img)} alt={product.name} className="w-full h-full object-contain p-1" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl text-slate-300">📦</div>
          )}
          {/* Botón favorito */}
          <button
            onClick={(e) => { e.preventDefault(); toggle(product); }}
            title={isInWishlist(product.id) ? "Quitar de favoritos" : "Guardar en favoritos"}
            className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow hover:bg-white transition-colors"
          >
            {isInWishlist(product.id)
              ? <svg className="w-3.5 h-3.5 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              : <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>}
          </button>
        </Link>

        {/* Info */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            <Link to={`/producto/${product.id}`}>
              <h3 className="font-semibold text-slate-800 text-sm leading-snug line-clamp-2 hover:text-blue-600 transition-colors">{product.name}</h3>
            </Link>
            {product.categories?.[0] && (
              <p className="text-xs text-slate-400 mt-0.5">{product.categories[0].name}</p>
            )}
            <div className="mt-1.5">
              {customer?.type === "MAYORISTA" && product.wholesalePrice ? (
                product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice ? (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs text-slate-400 line-through">{formatPrice(product.wholesalePrice)}</span>
                    <span className="font-bold text-green-700 text-sm">{formatPrice(product.wholesaleSalePrice)}</span>
                    <span className="text-xs text-green-600">mayorista</span>
                  </div>
                ) : (
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-bold text-green-700 text-sm">{formatPrice(product.wholesalePrice)}</span>
                    <span className="text-xs text-green-600">mayorista</span>
                  </div>
                )
              ) : product.salePrice && product.salePrice < product.price ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-slate-400 line-through">{formatPrice(product.price)}</span>
                  <span className="font-bold text-red-600 text-sm">{formatPrice(product.salePrice)}</span>
                </div>
              ) : (
                <span className="font-bold text-slate-900 text-sm">{formatPrice(product.price)}</span>
              )}
            </div>
          </div>

          {/* Botón agregar */}
          <div className="flex-shrink-0">
            {outOfStock ? (
              <span className="text-xs text-slate-400 font-medium">Sin stock</span>
            ) : customer ? (
              <button onClick={handleAddToCart} className="btn-primary text-sm px-3 py-1.5 whitespace-nowrap">
                + Agregar
              </button>
            ) : (
              <button onClick={handleAddToCart} className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
                Iniciar sesión
              </button>
            )}
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
                to={`/producto/${product.id}`}
                onClick={() => setVariantModal(false)}
                className="font-bold text-slate-900 text-sm leading-tight line-clamp-2 hover:text-blue-600 transition-colors"
              >
                {product.name}
              </Link>
              <p className="text-xs text-slate-400 mt-0.5">Elegí las opciones para agregar al carrito</p>
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
                        to={`/producto/${product.id}`}
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
              </>
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
              disabled={!allAttrsSelected || addingVariant || (activeVariant && !activeVariant.stockUnlimited && activeVariant.stock === 0)}
              className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
      to={`/producto/${product.id}`}
      className="card group flex flex-col overflow-hidden hover:shadow-md transition-shadow duration-200"
    >
      {/* Imagen */}
      <div className="relative aspect-square overflow-hidden" style={{ backgroundColor: "#ffffff" }}>
        {img ? (
          <>
            {/* Sin fondo borroso — bg-white del contenedor cubre el espacio vacío */}
            <img
              src={getImageUrl(img)}
              alt={product.name}
              className="relative w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl text-slate-300">
            📦
          </div>
        )}

        {/* Botón favorito */}
        <button
          onClick={(e) => { e.preventDefault(); toggle(product); }}
          title={isInWishlist(product.id) ? "Quitar de favoritos" : "Guardar en favoritos"}
          className="absolute top-2 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow hover:bg-white transition-colors"
        >
          {isInWishlist(product.id) ? (
            <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
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
        {!hasVariants && product.stock > 0 && product.stock <= 5 && (
          <p className="text-xs text-orange-500 font-medium mb-2">
            ⚠️ Últimas {product.stock} unidades
          </p>
        )}
        <div className="flex items-end justify-between gap-2">
          {/* Mostrar precio según tipo de cliente:
              - MAYORISTA: precio mayorista si está disponible
              - MINORISTA: precio oferta si existe y es menor al precio normal */}
          <div className="flex flex-col">
            {customer?.type === "MAYORISTA" && product.wholesalePrice ? (
              // Cliente mayorista: mostrar precio oferta mayorista (si existe) o precio mayorista
              product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice ? (
                <>
                  <span className="text-xs text-slate-400 line-through">{formatPrice(product.wholesalePrice)}</span>
                  <span className="text-lg font-bold text-green-700">{formatPrice(product.wholesaleSalePrice)}</span>
                  <span className="text-xs text-green-600 font-semibold">Precio mayorista</span>
                </>
              ) : (
                <>
                  <span className="text-lg font-bold text-green-700">{formatPrice(product.wholesalePrice)}</span>
                  <span className="text-xs text-green-600 font-semibold">Precio mayorista</span>
                </>
              )
            ) : product.salePrice && product.salePrice < product.price ? (
              // Cliente minorista con precio de oferta
              <>
                <span className="text-xs text-slate-400 line-through">{formatPrice(product.price)}</span>
                <span className="text-lg font-bold text-red-600">{formatPrice(product.salePrice)}</span>
              </>
            ) : (
              <span className="text-lg font-bold text-slate-900">{formatPrice(product.price)}</span>
            )}
          </div>
          {/* Si no hay usuario logueado se muestra "Iniciar sesión" en lugar de "Agregar" */}
          {customer ? (
            <button
              onClick={handleAddToCart}
              disabled={outOfStock}
              className="btn-primary text-sm px-3 py-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Agregar
            </button>
          ) : (
            <button
              onClick={handleAddToCart}
              className="btn-secondary text-xs px-3 py-1.5"
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
