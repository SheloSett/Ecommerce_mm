import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { productsApi, getImageUrl } from "../services/api";
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
  const [videoOpen, setVideoOpen] = useState(false);
  const [slideDir, setSlideDir] = useState("next"); // "next" | "prev"
  const { addItem, items } = useCart();
  const { customer } = useCustomerAuth();
  const autoplayRef = useRef(null);

  const totalImages = product?.images?.length || 0;

  const resetTimer = useCallback((nextFn) => {
    clearInterval(autoplayRef.current);
    nextFn();
    if (totalImages > 1) {
      autoplayRef.current = setInterval(() => {
        setSlideDir("next");
        setSelectedImage((i) => (i + 1) % totalImages);
      }, 15000);
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

  // Autoplay: avanza cada 15 segundos si hay más de 1 imagen
  useEffect(() => {
    if (totalImages <= 1) return;
    autoplayRef.current = setInterval(() => {
      setSlideDir("next");
      setSelectedImage((i) => (i + 1) % totalImages);
    }, 15000);
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
    productsApi
      .getById(id)
      .then((res) => {
        setProduct(res.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const formatPrice = (price) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(price);

  // Cantidad ya en el carrito para este producto
  const cartQty = items.find((i) => i.id === product?.id)?.quantity || 0;
  // Los mayoristas no tienen límite de cantidad: pueden pedir más del stock disponible (cotización)
  // Los minoristas están limitados al stock real restante
  const isMayorista = customer?.type === "MAYORISTA";
  const availableStock = product?.stockUnlimited || isMayorista ? Infinity : Math.max(0, (product?.stock || 0) - cartQty);
  const outOfStock = !product?.stockUnlimited && !isMayorista && availableStock === 0;

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
    if (outOfStock) return;
    const safeQty = isMayorista ? quantity : Math.min(quantity, availableStock);
    // Solo aplicar precio del tier si la cantidad final sigue cumpliendo el mínimo requerido.
    // Si el stock cap redujo la cantidad por debajo del minQty del tier, no aplicar el precio.
    const tierPrice = (selectedTier && safeQty >= parseInt(selectedTier.minQty))
      ? selectedTier.price
      : null;
    await addItem(product, safeQty, tierPrice);
    toast.success(`${safeQty}x "${product.name}" agregado al carrito`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <p className="text-5xl mb-4">😕</p>
          <p className="text-xl font-medium">Producto no encontrado</p>
          <Link to="/catalogo" className="mt-4 text-blue-600 hover:underline">
            Volver al catálogo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
        {/* Breadcrumb */}
        <nav className="text-sm text-slate-500 mb-6">
          <Link to="/" className="hover:text-blue-600">Inicio</Link>
          <span className="mx-2">/</span>
          <Link to="/catalogo" className="hover:text-blue-600">Catálogo</Link>
          {/* Antes: product.category (single) — ahora product.categories (array M2M) */}
          {product.categories && product.categories.length > 0 && (
            <>
              <span className="mx-2">/</span>
              {product.categories.map((cat, i) => (
                <span key={cat.id}>
                  {i > 0 && <span className="mx-1">·</span>}
                  <Link to={`/catalogo?category=${cat.slug}`} className="hover:text-blue-600">
                    {cat.name}
                  </Link>
                </span>
              ))}
            </>
          )}
          <span className="mx-2">/</span>
          <span className="text-slate-800">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {/* Galería de imágenes */}
          <div>
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-slate-100 mb-4 group">
              {product.images?.[selectedImage] ? (
                <img
                  key={selectedImage}
                  src={getImageUrl(product.images[selectedImage])}
                  alt={product.name}
                  className={`w-full h-full object-cover ${slideDir === "next" ? "carousel-slide-next" : "carousel-slide-prev"}`}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-7xl text-slate-300">
                  📦
                </div>
              )}

              {/* Flechas — solo si hay más de 1 imagen */}
              {totalImages > 1 && (
                <>
                  <button
                    onClick={() => { goPrev(); clearInterval(autoplayRef.current); autoplayRef.current = setInterval(goNext, 15000); }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => { goNext(); clearInterval(autoplayRef.current); autoplayRef.current = setInterval(goNext, 15000); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                  >
                    ›
                  </button>
                  {/* Indicador de posición */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                    {product.images.map((_, i) => (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === selectedImage ? "bg-white" : "bg-white/40"}`} />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Miniaturas */}
            {totalImages > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {product.images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectImage(i)}
                    className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-colors ${
                      selectedImage === i ? "border-blue-500" : "border-slate-200"
                    }`}
                  >
                    <img src={getImageUrl(img)} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info del producto */}
          <div>
            {/* Antes: product.category (single) — ahora product.categories (array M2M) */}
            {product.categories && product.categories.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {product.categories.map((cat) => (
                  <Link
                    key={cat.id}
                    to={`/catalogo?category=${cat.slug}`}
                    className="text-sm text-blue-600 font-semibold uppercase tracking-wide hover:underline"
                  >
                    {cat.name}
                  </Link>
                ))}
              </div>
            )}
            <h1 className="text-3xl font-extrabold text-slate-900 mt-2 mb-4">{product.name}</h1>

            {/* Precio según tipo de cliente.
                Si hay un tier seleccionado, el precio principal muestra el precio del tier. */}
            {(() => {
              // Precio base sin tier
              const isMayorista = customer?.type === "MAYORISTA";
              const baseUnitPrice = isMayorista && product.wholesalePrice
                ? (product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice ? product.wholesaleSalePrice : product.wholesalePrice)
                : (product.salePrice && product.salePrice < product.price ? product.salePrice : product.price);

              // Si hay tier activo, ese es el precio por unidad
              const displayPrice = selectedTier ? selectedTier.price : baseUnitPrice;
              const hasTierDiscount = selectedTier && selectedTier.price < baseUnitPrice;

              if (isMayorista && product.wholesalePrice) {
                return (
                  <div className="mb-6">
                    {hasTierDiscount && (
                      <p className="text-lg text-slate-400 line-through">{formatPrice(baseUnitPrice)}</p>
                    )}
                    <p className="text-4xl font-bold text-green-700">{formatPrice(displayPrice)}</p>
                    <span className="inline-block mt-1 px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
                      {hasTierDiscount ? "Precio mayorista c/descuento" : "Precio mayorista"}
                    </span>
                  </div>
                );
              }

              // Minorista
              const originalPrice = product.price;
              const showStrike = displayPrice < originalPrice;
              return (
                <div className="mb-6">
                  {showStrike && (
                    <p className="text-lg text-slate-400 line-through">{formatPrice(originalPrice)}</p>
                  )}
                  <p className={`text-4xl font-bold mb-1 ${displayPrice < originalPrice ? "text-red-600" : "text-blue-600"}`}>
                    {formatPrice(displayPrice)}
                  </p>
                  {displayPrice < originalPrice && (
                    <span className="inline-block px-3 py-1 bg-red-100 text-red-600 text-sm font-semibold rounded-full">
                      {hasTierDiscount ? "Precio por cantidad" : "Precio oferta"}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Tabla de descuentos por cantidad — clickeable para seleccionar */}
            {/* Mayoristas ven wholesalePriceTiers; minoristas ven priceTiers */}
            {(() => {
              const isMayorista = customer?.type === "MAYORISTA";
              const activeTiers = isMayorista
                ? (product.wholesalePriceTiers && product.wholesalePriceTiers.length > 0 ? product.wholesalePriceTiers : null)
                : (product.priceTiers && product.priceTiers.length > 0 ? product.priceTiers : null);
              // El % OFF se calcula contra el precio base del tipo de cliente
              const basePrice = isMayorista && product.wholesalePrice
                ? (product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice ? product.wholesaleSalePrice : product.wholesalePrice)
                : (product.salePrice && product.salePrice < product.price ? product.salePrice : product.price);
              if (!activeTiers) return null;
              return (
                <div className="mb-6 border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <span className="text-sm font-semibold text-slate-700">Descuentos por cantidad</span>
                    {selectedTier && (
                      <button
                        onClick={() => changeQuantity(1)}
                        className="ml-3 text-xs text-slate-400 hover:text-slate-600 underline"
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
                                  ? "cursor-pointer bg-blue-50 border-l-4 border-blue-500"
                                  : `cursor-pointer ${i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50 hover:bg-slate-100"}`
                            }`}
                          >
                            <td className={`px-4 py-3 font-medium ${isSelected ? "text-blue-700" : "text-slate-700"}`}>
                              +{tier.minQty} unidades
                              {sinStockSuficiente && (
                                <span className="ml-2 text-xs text-slate-400">(sin stock suficiente)</span>
                              )}
                            </td>
                            <td className={`px-4 py-3 font-semibold ${isSelected ? "text-blue-700" : "text-slate-800"}`}>
                              {formatPrice(tier.price)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isSelected && (
                                <span className="mr-2 text-blue-500 text-xs font-semibold">✓ seleccionado</span>
                              )}
                              {discountPct > 0 && !sinStockSuficiente && (
                                <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded-full">
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

            {product.description && (
              <p className="text-slate-600 leading-relaxed mb-6">{product.description}</p>
            )}

            {/* Stock */}
            <div className="flex items-center gap-2 mb-6">
              {product.stock > 0 ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                  <span className="text-sm text-green-700 font-medium">
                    {/* Cantidad de stock oculta al cliente — solo se muestra disponibilidad */}
                    En stock
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                  <span className="text-sm text-red-600 font-medium">Sin stock</span>
                </>
              )}
            </div>

            {/* Cantidad */}
            {!outOfStock && (
              <div className="flex items-center gap-4 mb-6">
                <span className="text-sm font-medium text-slate-700">Cantidad:</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => changeQuantity(Math.max(1, quantity - 1))}
                    disabled={quantity <= 1}
                    className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    −
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
                    className="w-16 text-center font-semibold text-lg border border-slate-200 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => changeQuantity(isMayorista ? quantity + 1 : Math.min(availableStock, quantity + 1))}
                    className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-colors"
                  >
                    +
                  </button>
                </div>
                {selectedTier && (
                  <span className="text-xs text-blue-600 font-medium">
                    mín. {selectedTier.minQty} u. · {formatPrice(selectedTier.price)} c/u
                  </span>
                )}
              </div>
            )}

            <button
              onClick={handleAddToCart}
              disabled={outOfStock}
              className="btn-primary w-full text-base py-4 disabled:opacity-50"
            >
              {product.stock === 0
                ? "Sin stock disponible"
                : outOfStock
                  ? "Máximo agregado al carrito"
                  : "🛒 Agregar al carrito"}
            </button>

            {/* Botón ver video — solo si el producto tiene youtubeUrl */}
            {product.youtubeUrl && getYoutubeEmbedUrl(product.youtubeUrl) && (
              <button
                onClick={() => setVideoOpen(true)}
                className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-red-500 text-red-600 font-semibold hover:bg-red-50 transition-colors"
              >
                ▶ Ver video del producto
              </button>
            )}

            <div className="mt-6 p-4 bg-slate-50 rounded-xl text-sm text-slate-600 space-y-2">
              <p>✅ Pago seguro con MercadoPago</p>
              <p>📦 Envíos a todo Argentina</p>
              <p>🔒 Compra protegida</p>
            </div>
          </div>
        </div>
      </main>

      {/* Modal de video de YouTube */}
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
