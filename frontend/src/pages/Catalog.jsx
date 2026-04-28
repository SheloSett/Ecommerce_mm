import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import SiteMeta from "../components/SiteMeta";
import { productsApi, categoriesApi } from "../services/api";
import { useCustomerAuth } from "../context/CustomerAuthContext";

// ─── Sección colapsable del sidebar (estilo BH Photo) ────────────────────────
function FilterSection({ title, defaultOpen = true, children, activeCount = 0 }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-200 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-3 px-0 text-left group"
      >
        <span className="font-semibold text-sm text-slate-800 group-hover:text-blue-600 transition-colors flex items-center gap-2">
          {title}
          {activeCount > 0 && (
            <span className="bg-secondary-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
              {activeCount}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

// ─── Ítem de categoría con checkbox ──────────────────────────────────────────
function CategoryItem({ label, count, checked, onClick, indent = false }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 py-1 px-0 text-left group transition-colors ${
        indent ? "pl-4" : ""
      }`}
    >
      <span
        className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          checked
            ? "bg-secondary-600 border-secondary-600"
            : "border-slate-300 group-hover:border-secondary-400"
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={`text-sm flex-1 leading-tight ${checked ? "text-secondary-700 font-semibold" : "text-slate-600 group-hover:text-slate-800"}`}>
        {label}
      </span>
      {count !== undefined && (
        <span className={`text-xs font-medium flex-shrink-0 ${checked ? "text-blue-500" : "text-slate-400"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Ítem de atributo con checkbox ───────────────────────────────────────────
function AttrItem({ value, checked, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2.5 py-1 px-0 text-left group transition-colors"
    >
      <span
        className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          checked
            ? "bg-secondary-600 border-secondary-600"
            : "border-slate-300 group-hover:border-secondary-400"
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className={`text-sm leading-tight ${checked ? "text-secondary-700 font-semibold" : "text-slate-600 group-hover:text-slate-800"}`}>
        {value}
      </span>
    </button>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Catalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [facets, setFacets] = useState([]); // [{ name, values[] }]
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("catalog-view") || "grid");
  const { customer } = useCustomerAuth();

  const handleSetView = (mode) => {
    setViewMode(mode);
    localStorage.setItem("catalog-view", mode);
  };

  const currentCategory  = searchParams.get("category") || "";
  const currentSearch    = searchParams.get("search") || "";
  const currentPage      = parseInt(searchParams.get("page") || "1");
  const currentOnSale    = searchParams.get("onSale") === "true";
  const currentLowStock  = searchParams.get("lowStock") === "true";
  const currentSortOrder = searchParams.get("sortOrder") || "newest";
  const currentSortPrice = searchParams.get("sortPrice") || "";

  // Parsear filtros de atributos desde URL: attr_Color=Negro|Rojo
  const selectedAttrs = {};
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith("attr_")) {
      selectedAttrs[key.slice(5)] = value.split("|");
    }
  }
  const totalAttrFilters = Object.values(selectedAttrs).reduce((s, v) => s + v.length, 0);

  const visibleFor = customer?.type || "MINORISTA";

  // Serializa selectedAttrs a JSON para el backend si hay alguno
  const attrsParam = Object.keys(selectedAttrs).length > 0
    ? JSON.stringify(selectedAttrs)
    : undefined;

  const sortProducts = (list) => {
    const sorted = [...list];
    if (currentSortPrice === "asc")  return sorted.sort((a, b) => a.price - b.price);
    if (currentSortPrice === "desc") return sorted.sort((a, b) => b.price - a.price);
    if (currentSortOrder === "oldest") return sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (currentSortOrder === "az")     return sorted.sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (currentSortOrder === "za")     return sorted.sort((a, b) => b.name.localeCompare(a.name, "es"));
    return sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  };

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params = { page: currentPage, limit: 20, visibleFor };
    if (currentCategory) params.category = currentCategory;
    if (currentSearch)   params.search   = currentSearch;
    if (currentOnSale)   params.onSale   = "true";
    if (currentLowStock) params.lowStock = "true";
    if (attrsParam)      params.attrs    = attrsParam;

    productsApi
      .getAll(params)
      .then((res) => {
        setProducts(res.data.products);
        setPagination(res.data.pagination);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentCategory, currentSearch, currentPage, currentOnSale, currentLowStock, visibleFor, attrsParam]);

  // Traer facetas (atributos disponibles) cada vez que cambian los filtros base (no los de attr)
  const fetchFacets = useCallback(() => {
    const params = { visibleFor };
    if (currentCategory) params.category = currentCategory;
    if (currentSearch)   params.search   = currentSearch;
    if (currentOnSale)   params.onSale   = "true";
    if (currentLowStock) params.lowStock = "true";

    productsApi
      .getFacets(params)
      .then((res) => setFacets(res.data.facets))
      .catch(() => setFacets([]));
  }, [currentCategory, currentSearch, currentOnSale, currentLowStock, visibleFor]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchFacets(); }, [fetchFacets]);
  useEffect(() => { categoriesApi.getAll().then((res) => setCategories(res.data)); }, []);

  const setFilter = (key, value) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) { newParams.set(key, value); } else { newParams.delete(key); }
    newParams.delete("page");
    setSearchParams(newParams);
  };

  const toggleAttrValue = (attrName, value) => {
    const current = selectedAttrs[attrName] || [];
    const newValues = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("page");
    const key = `attr_${attrName}`;
    if (newValues.length === 0) { newParams.delete(key); } else { newParams.set(key, newValues.join("|")); }
    setSearchParams(newParams);
  };

  const clearAllAttrs = () => {
    const newParams = new URLSearchParams(searchParams);
    for (const key of [...newParams.keys()]) {
      if (key.startsWith("attr_")) newParams.delete(key);
    }
    newParams.delete("page");
    setSearchParams(newParams);
  };

  const clearAllFilters = () => setSearchParams({});

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

  const parentTotal = (cat) => {
    const own = cat._count?.products || 0;
    const childrenTotal = cat.children?.reduce((acc, s) => acc + (s._count?.products || 0), 0) || 0;
    return own + childrenTotal;
  };

  const isParentActive = (cat) =>
    currentCategory === cat.slug ||
    (cat.children && cat.children.some((s) => s.slug === currentCategory));

  const hasAnyFilter = currentCategory || currentSearch || currentOnSale || currentLowStock || totalAttrFilters > 0;

  // ─── Sidebar content (shared between desktop and mobile) ───────────────────
  // IMPORTANTE: se llama como función {renderSidebar()} en lugar de {renderSidebar()}
  // para evitar que React trate cada render como un componente nuevo y resetee el estado
  // de las secciones colapsables (FilterSection) en cada actualización de filtros.
  const renderSidebar = () => (
    <div className="space-y-0">
      {/* Limpiar todos los filtros */}
      {hasAnyFilter && (
        <div className="pb-3 mb-1 border-b border-slate-200">
          <button
            onClick={clearAllFilters}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Limpiar todos los filtros
          </button>
        </div>
      )}

      {/* Filtros especiales */}
      <FilterSection title="Ofertas y Stock" defaultOpen={currentOnSale || currentLowStock}>
        <div className="space-y-1">
          <AttrItem
            value="🏷️ En descuento"
            checked={currentOnSale}
            onToggle={() => {
              const newParams = new URLSearchParams(searchParams);
              if (!currentOnSale) { newParams.set("onSale", "true"); } else { newParams.delete("onSale"); }
              newParams.delete("page");
              setSearchParams(newParams);
            }}
          />
          <AttrItem
            value="⚡ Pocas unidades"
            checked={currentLowStock}
            onToggle={() => {
              const newParams = new URLSearchParams(searchParams);
              if (!currentLowStock) { newParams.set("lowStock", "true"); } else { newParams.delete("lowStock"); }
              newParams.delete("page");
              setSearchParams(newParams);
            }}
          />
        </div>
      </FilterSection>

      {/* Categorías */}
      <FilterSection title="Categoría" defaultOpen={true}>
        <div className="space-y-1">
          <CategoryItem
            label="Todos los productos"
            checked={!currentCategory && !currentOnSale && !currentLowStock}
            onClick={() => {
              const newParams = new URLSearchParams();
              if (currentSearch) newParams.set("search", currentSearch);
              setSearchParams(newParams);
            }}
          />
          {categories.map((cat) => (
            <div key={cat.id}>
              <CategoryItem
                label={cat.name}
                count={parentTotal(cat)}
                checked={currentCategory === cat.slug}
                onClick={() => setFilter("category", currentCategory === cat.slug ? "" : cat.slug)}
              />
              {cat.children && cat.children.length > 0 && isParentActive(cat) && (
                <div className="mt-0.5 space-y-0.5 ml-2 pl-2 border-l-2 border-blue-100">
                  {cat.children.map((sub) => (
                    <CategoryItem
                      key={sub.id}
                      label={sub.name}
                      count={sub._count?.products || 0}
                      checked={currentCategory === sub.slug}
                      indent
                      onClick={() => setFilter("category", currentCategory === sub.slug ? "" : sub.slug)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </FilterSection>

      {/* Filtros dinámicos por atributo */}
      {facets.length > 0 && (
        <>
          {totalAttrFilters > 0 && (
            <div className="py-2 border-b border-slate-200">
              <button
                onClick={clearAllAttrs}
                className="text-xs text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Limpiar filtros de características
              </button>
            </div>
          )}
          {facets.map((facet) => {
            const activeValues = selectedAttrs[facet.name] || [];
            return (
              <FilterSection
                key={facet.name}
                title={facet.name}
                defaultOpen={activeValues.length > 0}
                activeCount={activeValues.length}
              >
                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {facet.values.map((val) => (
                    <AttrItem
                      key={val}
                      value={val}
                      checked={activeValues.includes(val)}
                      onToggle={() => toggleAttrValue(facet.name, val)}
                    />
                  ))}
                </div>
              </FilterSection>
            );
          })}
        </>
      )}
    </div>
  );

  const [search] = useSearchParams();
  const searchTerm    = search.get("search") || "";
  const categoryParam = search.get("category") || "";
  const metaTitle = searchTerm
    ? `"${searchTerm}" — Catálogo | IGWT Store`
    : categoryParam
      ? `${categoryParam} | IGWT Store`
      : "Catálogo | IGWT Store";

  return (
    <div className="min-h-screen flex flex-col">
      <SiteMeta title={metaTitle} description="Explorá todo el catálogo de accesorios electrónicos en IGWT Store." />
      <Navbar />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <div className="flex flex-col md:flex-row gap-8">

          {/* ─── Sidebar desktop ─────────────────────────────────────────── */}
          <aside className="hidden md:block w-56 flex-shrink-0">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sticky top-20">
              <h2 className="font-bold text-slate-900 text-base mb-3 pb-2 border-b border-slate-200">
                Filtros
              </h2>
              {renderSidebar()}
            </div>
          </aside>

          {/* ─── Mobile: botón abrir drawer ──────────────────────────────── */}
          <div className="md:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-semibold text-slate-700 hover:border-blue-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 12h10M11 20h2" />
              </svg>
              Filtros
              {(hasAnyFilter) && (
                <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5">
                  {(currentCategory ? 1 : 0) + (currentOnSale ? 1 : 0) + (currentLowStock ? 1 : 0) + totalAttrFilters}
                </span>
              )}
            </button>
          </div>

          {/* ─── Mobile drawer ────────────────────────────────────────────── */}
          {sidebarOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
              <div className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl overflow-y-auto">
                <div className="flex items-center justify-between p-4 border-b border-slate-200">
                  <h2 className="font-bold text-slate-900">Filtros</h2>
                  <button onClick={() => setSidebarOpen(false)} className="text-slate-400 hover:text-slate-700">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="p-4">
                  {renderSidebar()}
                </div>
              </div>
            </div>
          )}

          {/* ─── Grilla de productos ──────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  {currentSearch
                    ? `Resultados para "${currentSearch}"`
                    : currentOnSale
                    ? "🏷️ Productos en oferta"
                    : currentLowStock
                    ? "⚡ Pocas unidades"
                    : currentCategory
                    ? findCategoryName(currentCategory)
                    : "Catálogo completo"}
                </h1>
                {pagination && (
                  <p className="text-sm text-slate-500 mt-0.5">
                    {pagination.total} producto{pagination.total !== 1 ? "s" : ""}
                    {totalAttrFilters > 0 && (
                      <span className="ml-2 text-blue-600 font-medium">
                        · {totalAttrFilters} filtro{totalAttrFilters !== 1 ? "s" : ""} de características
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Chips de atributos activos */}
              {totalAttrFilters > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(selectedAttrs).map(([attrName, values]) =>
                    values.map((val) => (
                      <button
                        key={`${attrName}:${val}`}
                        onClick={() => toggleAttrValue(attrName, val)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-secondary-50 text-secondary-700 border border-secondary-200 rounded-full text-xs font-medium hover:bg-secondary-100 transition-colors"
                      >
                        <span className="text-blue-400 font-semibold">{attrName}:</span> {val}
                        <svg className="w-3 h-3 text-blue-400 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Ordenamiento + toggle de vista */}
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                {currentSearch && (
                  <button onClick={() => setFilter("search", "")} className="text-sm text-red-500 hover:underline">
                    Limpiar búsqueda ✕
                  </button>
                )}
                <select
                  value={currentSortOrder}
                  onChange={(e) => setFilter("sortOrder", e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="newest">Más nuevo a más viejo</option>
                  <option value="oldest">Más viejo a más nuevo</option>
                  <option value="az">Nombre: A → Z</option>
                  <option value="za">Nombre: Z → A</option>
                </select>
                <select
                  value={currentSortPrice}
                  onChange={(e) => setFilter("sortPrice", e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Precio: sin orden</option>
                  <option value="asc">Precio: menor a mayor</option>
                  <option value="desc">Precio: mayor a menor</option>
                </select>

                {/* Botones de vista grilla / lista */}
                <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
                  <button
                    onClick={() => handleSetView("grid")}
                    title="Vista grilla"
                    className={`p-1.5 transition-colors ${viewMode === "grid" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-600"}`}
                  >
                    {/* Ícono grilla */}
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                      <rect x="1" y="1" width="6" height="6" rx="1"/>
                      <rect x="9" y="1" width="6" height="6" rx="1"/>
                      <rect x="1" y="9" width="6" height="6" rx="1"/>
                      <rect x="9" y="9" width="6" height="6" rx="1"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => handleSetView("list")}
                    title="Vista lista"
                    className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-600"}`}
                  >
                    {/* Ícono lista */}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className={viewMode === "list" ? "space-y-3" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"}>
                {[...Array(viewMode === "list" ? 6 : 12)].map((_, i) => (
                  viewMode === "list" ? (
                    <div key={i} className="card animate-pulse flex gap-4 p-3">
                      <div className="w-24 h-24 bg-slate-200 rounded-xl flex-shrink-0" />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-4 bg-slate-200 rounded w-3/4" />
                        <div className="h-3 bg-slate-200 rounded w-1/3" />
                        <div className="h-4 bg-slate-200 rounded w-1/4" />
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="card animate-pulse">
                      <div className="aspect-square bg-slate-200" />
                      <div className="p-4 space-y-2">
                        <div className="h-4 bg-slate-200 rounded w-3/4" />
                        <div className="h-4 bg-slate-200 rounded w-1/2" />
                      </div>
                    </div>
                  )
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <p className="text-5xl mb-4">🔍</p>
                <p className="text-lg font-medium">No se encontraron productos</p>
                {totalAttrFilters > 0 && (
                  <button onClick={clearAllAttrs} className="mt-3 text-blue-600 hover:underline text-sm">
                    Quitar filtros de características
                  </button>
                )}
                <button onClick={() => setSearchParams({})} className="mt-2 block mx-auto text-blue-600 hover:underline text-sm">
                  Ver todos los productos
                </button>
              </div>
            ) : (
              <>
                <div className={viewMode === "list" ? "space-y-3" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"}>
                  {sortProducts(products).map((p) => (
                    <ProductCard key={p.id} product={p} viewMode={viewMode} />
                  ))}
                </div>

                {pagination && pagination.totalPages > 1 && (
                  <div className="flex justify-center gap-2 mt-10">
                    {[...Array(pagination.totalPages)].map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setFilter("page", String(i + 1))}
                        className={`w-10 h-10 rounded-lg font-semibold text-sm transition-colors ${
                          currentPage === i + 1
                            ? "bg-secondary-600 text-white"
                            : "bg-white border border-slate-200 text-slate-700 hover:border-secondary-400"
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
