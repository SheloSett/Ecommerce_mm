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
  // Stock restante disponible para agregar (salvo stock ilimitado)
  const availableStock = product?.stockUnlimited ? Infinity : Math.max(0, (product?.stock || 0) - cartQty);
  const outOfStock = !product?.stockUnlimited && availableStock === 0;

  const handleAddToCart = async () => {
    if (!product || outOfStock) return;
    // Limitar cantidad seleccionada al stock disponible restante
    const safeQty = Math.min(quantity, availableStock);
    await addItem(product, safeQty);
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
          {product.category && (
            <>
              <span className="mx-2">/</span>
              <Link to={`/catalogo?category=${product.category.slug}`} className="hover:text-blue-600">
                {product.category.name}
              </Link>
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
            {product.category && (
              <Link
                to={`/catalogo?category=${product.category.slug}`}
                className="text-sm text-blue-600 font-semibold uppercase tracking-wide hover:underline"
              >
                {product.category.name}
              </Link>
            )}
            <h1 className="text-3xl font-extrabold text-slate-900 mt-2 mb-4">{product.name}</h1>

            {/* Precio según tipo de cliente:
                - MAYORISTA: oferta mayorista si existe, sino precio mayorista
                - MINORISTA: oferta minorista si existe y < price, sino precio normal */}
            {customer?.type === "MAYORISTA" && product.wholesalePrice ? (
              product.wholesaleSalePrice && product.wholesaleSalePrice < product.wholesalePrice ? (
                // Mayorista con oferta mayorista activa
                <div className="mb-6">
                  <p className="text-lg text-slate-400 line-through">{formatPrice(product.wholesalePrice)}</p>
                  <p className="text-4xl font-bold text-green-700">{formatPrice(product.wholesaleSalePrice)}</p>
                  <span className="inline-block mt-1 px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
                    Precio mayorista
                  </span>
                </div>
              ) : (
                // Mayorista sin oferta
                <div className="mb-6">
                  <p className="text-4xl font-bold text-green-700">{formatPrice(product.wholesalePrice)}</p>
                  <span className="inline-block mt-1 px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
                    Precio mayorista
                  </span>
                </div>
              )
            ) : product.salePrice && product.salePrice < product.price ? (
              // Minorista con oferta activa
              <div className="mb-6">
                <p className="text-lg text-slate-400 line-through">{formatPrice(product.price)}</p>
                <p className="text-4xl font-bold text-red-600">{formatPrice(product.salePrice)}</p>
                <span className="inline-block mt-1 px-3 py-1 bg-red-100 text-red-600 text-sm font-semibold rounded-full">
                  Precio oferta
                </span>
              </div>
            ) : (
              // Minorista sin oferta
              <p className="text-4xl font-bold text-blue-600 mb-6">{formatPrice(product.price)}</p>
            )}

            {product.description && (
              <p className="text-slate-600 leading-relaxed mb-6">{product.description}</p>
            )}

            {/* Stock */}
            <div className="flex items-center gap-2 mb-6">
              {product.stock > 0 ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                  <span className="text-sm text-green-700 font-medium">
                    En stock ({product.stock} disponibles)
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
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-colors"
                  >
                    −
                  </button>
                  <span className="w-10 text-center font-semibold text-lg">{quantity}</span>
                  <button
                    onClick={() => setQuantity((q) => Math.min(availableStock, q + 1))}
                    className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-lg transition-colors"
                  >
                    +
                  </button>
                </div>
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
