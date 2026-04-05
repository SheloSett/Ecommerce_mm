import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import { productsApi, categoriesApi } from "../services/api";
import { useCustomerAuth } from "../context/CustomerAuthContext";

export default function Catalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const { customer } = useCustomerAuth();

  const currentCategory = searchParams.get("category") || "";
  const currentSearch = searchParams.get("search") || "";
  const currentPage = parseInt(searchParams.get("page") || "1");

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params = { page: currentPage, limit: 20 };
    if (currentCategory) params.category = currentCategory;
    if (currentSearch) params.search = currentSearch;
    // Filtrar por visibilidad según el tipo de cliente logueado
    params.visibleFor = customer?.type || "MINORISTA";

    productsApi
      .getAll(params)
      .then((res) => {
        setProducts(res.data.products);
        setPagination(res.data.pagination);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentCategory, currentSearch, currentPage, customer?.type]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    categoriesApi.getAll().then((res) => setCategories(res.data));
  }, []);

  const setFilter = (key, value) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    newParams.delete("page"); // Resetear página al cambiar filtros
    setSearchParams(newParams);
  };

  // Busca el nombre de una categoría por slug, tanto en padres como en hijos
  const findCategoryName = (slug) => {
    for (const cat of categories) {
      if (cat.slug === slug) return cat.name;
      if (cat.children) {
        const sub = cat.children.find((s) => s.slug === slug);
        if (sub) return sub.name;
      }
    }
    return "Catálogo";
  };

  // Calcula el total de productos de una categoría padre (propios + los de sus hijos)
  const parentTotal = (cat) => {
    const own = cat._count?.products || 0;
    const childrenTotal = cat.children?.reduce((acc, s) => acc + (s._count?.products || 0), 0) || 0;
    return own + childrenTotal;
  };

  // Una subcategoría está "activa" directamente, o su padre lo está si el filtro actual es el slug del padre
  const isParentActive = (cat) =>
    currentCategory === cat.slug ||
    (cat.children && cat.children.some((s) => s.slug === currentCategory));

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Sidebar de filtros */}
          <aside className="w-full md:w-56 flex-shrink-0">
            <div className="card p-4 sticky top-20">
              <h3 className="font-bold text-slate-800 mb-3">Categorías</h3>
              <ul className="space-y-1">
                <li>
                  <button
                    onClick={() => setFilter("category", "")}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      !currentCategory
                        ? "bg-blue-50 text-blue-700 font-semibold"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Todos los productos
                  </button>
                </li>
                {categories.map((cat) => (
                  <li key={cat.id}>
                    {/* Botón de la categoría padre */}
                    <button
                      onClick={() => setFilter("category", cat.slug)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        currentCategory === cat.slug
                          ? "bg-blue-50 text-blue-700 font-semibold"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {cat.name}
                      <span className="text-slate-400 ml-1">({parentTotal(cat)})</span>
                    </button>

                    {/* Subcategorías: se muestran si el padre está activo o si hay subcategorías */}
                    {cat.children && cat.children.length > 0 && isParentActive(cat) && (
                      <ul className="mt-0.5 space-y-0.5 pl-3 border-l-2 border-blue-100 ml-3">
                        {cat.children.map((sub) => (
                          <li key={sub.id}>
                            <button
                              onClick={() => setFilter("category", sub.slug)}
                              className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-colors ${
                                currentCategory === sub.slug
                                  ? "bg-blue-50 text-blue-700 font-semibold"
                                  : "text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              ↳ {sub.name}
                              <span className="text-slate-400 ml-1">({sub._count?.products || 0})</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Grilla de productos */}
          <div className="flex-1">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  {currentSearch
                    ? `Resultados para "${currentSearch}"`
                    : currentCategory
                    ? findCategoryName(currentCategory)
                    : "Catálogo completo"}
                </h1>
                {pagination && (
                  <p className="text-sm text-slate-500 mt-1">
                    {pagination.total} producto{pagination.total !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
              {currentSearch && (
                <button
                  onClick={() => setFilter("search", "")}
                  className="text-sm text-red-500 hover:underline"
                >
                  Limpiar búsqueda ✕
                </button>
              )}
            </div>

            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="card animate-pulse">
                    <div className="aspect-square bg-slate-200" />
                    <div className="p-4 space-y-2">
                      <div className="h-4 bg-slate-200 rounded w-3/4" />
                      <div className="h-4 bg-slate-200 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <p className="text-5xl mb-4">🔍</p>
                <p className="text-lg font-medium">No se encontraron productos</p>
                <button
                  onClick={() => setSearchParams({})}
                  className="mt-4 text-blue-600 hover:underline"
                >
                  Ver todos los productos
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                  {products.map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>

                {/* Paginación */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="flex justify-center gap-2 mt-10">
                    {[...Array(pagination.totalPages)].map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setFilter("page", String(i + 1))}
                        className={`w-10 h-10 rounded-lg font-semibold text-sm transition-colors ${
                          currentPage === i + 1
                            ? "bg-blue-600 text-white"
                            : "bg-white border border-slate-200 text-slate-700 hover:border-blue-400"
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
