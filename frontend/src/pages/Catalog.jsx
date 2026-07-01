import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import ProductCard from "../components/ProductCard";
import SiteMeta from "../components/SiteMeta";
import { productsApi, categoriesApi } from "../services/api";
import { useCustomerAuth } from "../context/CustomerAuthContext";

// ─── Sección colapsable del sidebar ──────────────────────────────────────────
function FilterSection({ title, defaultOpen = true, children, activeCount = 0 }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#bdcaba]/40 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-3 px-0 text-left group"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-[#0b1c30] group-hover:text-[#006b2c] transition-colors flex items-center gap-2">
          {title}
          {activeCount > 0 && (
            <span className="bg-[#00873a] text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">
              {activeCount}
            </span>
          )}
        </span>
        <span
          className={`material-symbols-outlined text-[18px] text-[#565e74] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
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
      className={`w-full flex items-center gap-2.5 py-1.5 px-0 text-left group transition-colors ${
        indent ? "pl-4" : ""
      }`}
    >
      <span
        className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          checked
            ? "bg-[#006b2c] border-[#006b2c]"
            : "border-[#bdcaba] group-hover:border-[#006b2c]/60"
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span
        className={`text-sm flex-1 leading-tight ${
          checked ? "text-[#006b2c] font-semibold" : "text-[#565e74] group-hover:text-[#0b1c30]"
        }`}
      >
        {label}
      </span>
      {count !== undefined && (
        <span
          className={`text-xs font-medium flex-shrink-0 px-2 py-0.5 rounded-full ${
            checked
              ? "bg-[#006b2c]/10 text-[#006b2c]"
              : "bg-[#dce9ff] text-[#565e74]"
          }`}
        >
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
      className="w-full flex items-center gap-2.5 py-1.5 px-0 text-left group transition-colors"
    >
      <span
        className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          checked
            ? "bg-[#006b2c] border-[#006b2c]"
            : "border-[#bdcaba] group-hover:border-[#006b2c]/60"
        }`}
      >
        {checked && (
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span
        className={`text-sm leading-tight ${
          checked ? "text-[#006b2c] font-semibold" : "text-[#565e74] group-hover:text-[#0b1c30]"
        }`}
      >
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
  // Array de slugs seleccionados (soporta multi-select). Ej. ?category=accesorios|cables
  const selectedCategorySlugs = currentCategory ? currentCategory.split("|").filter(Boolean) : [];
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

  // COMENTADO: el ordenamiento se movió al backend (getProducts lee sortOrder/sortPrice) para que
  // funcione con la paginación. Esta versión ordenaba solo la página actual (20 de N), por eso los
  // filtros A→Z / Z→A "no funcionaban" sobre todo el catálogo.
  // const sortProducts = (list) => {
  //   const sorted = [...list];
  //   if (currentSortPrice === "asc")  return sorted.sort((a, b) => a.price - b.price);
  //   if (currentSortPrice === "desc") return sorted.sort((a, b) => b.price - a.price);
  //   if (currentSortOrder === "oldest") return sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  //   if (currentSortOrder === "az")     return sorted.sort((a, b) => a.name.localeCompare(b.name, "es"));
  //   if (currentSortOrder === "za")     return sorted.sort((a, b) => b.name.localeCompare(a.name, "es"));
  //   return sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  // };

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params = { page: currentPage, limit: 20, visibleFor };
    if (currentCategory) params.category = currentCategory;
    if (currentSearch)   params.search   = currentSearch;
    if (currentOnSale)   params.onSale   = "true";
    if (currentLowStock) params.lowStock = "true";
    if (attrsParam)      params.attrs    = attrsParam;
    // Orden: ahora lo resuelve el backend (para que funcione con la paginación, no solo la página actual)
    if (currentSortOrder) params.sortOrder = currentSortOrder;
    if (currentSortPrice) params.sortPrice = currentSortPrice;

    productsApi
      .getAll(params)
      .then((res) => {
        setProducts(res.data.products);
        setPagination(res.data.pagination);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentCategory, currentSearch, currentPage, currentOnSale, currentLowStock, visibleFor, attrsParam, currentSortOrder, currentSortPrice]);

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
  // Pasamos visibleFor para que el conteo de cada categoría refleje solo lo que este cliente ve
  // realmente (excluye solo-mayorista/minorista y sin stock), igual que la grilla. Depende de
  // visibleFor para refrescar al iniciar/cerrar sesión o cambiar el tipo de cliente.
  useEffect(() => { categoriesApi.getAll({ visibleFor }).then((res) => setCategories(res.data)); }, [visibleFor]);

  const setFilter = (key, value) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) { newParams.set(key, value); } else { newParams.delete(key); }
    // Al cambiar un FILTRO se vuelve a la página 1. Pero si lo que se está cambiando ES la
    // página (paginación), NO hay que borrarla — si no, nunca se puede pasar de la página 1.
    if (key !== "page") newParams.delete("page");
    setSearchParams(newParams);
  };

  // Toggle de slug en el array de categorías — agrega o quita según ya esté.
  const toggleCategory = (slug) => {
    const next = selectedCategorySlugs.includes(slug)
      ? selectedCategorySlugs.filter((s) => s !== slug)
      : [...selectedCategorySlugs, slug];
    setFilter("category", next.join("|"));
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
    selectedCategorySlugs.includes(cat.slug) ||
    (cat.children && cat.children.some((s) => selectedCategorySlugs.includes(s.slug)));

  const hasAnyFilter = currentCategory || currentSearch || currentOnSale || currentLowStock || totalAttrFilters > 0;

  // ─── Sidebar content (shared between desktop and mobile) ───────────────────
  // IMPORTANTE: se llama como función {renderSidebar()} en lugar de <RenderSidebar />
  // para evitar que React trate cada render como un componente nuevo y resetee el estado
  // de las secciones colapsables (FilterSection) en cada actualización de filtros.
  const renderSidebar = () => (
    <div className="space-y-0">
      {/* Limpiar todos los filtros */}
      {hasAnyFilter && (
        <div className="pb-3 mb-1 border-b border-[#bdcaba]/40">
          <button
            onClick={clearAllFilters}
            className="text-xs text-[#006b2c] hover:text-[#004d1c] hover:underline font-semibold flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
            Limpiar todos los filtros
          </button>
        </div>
      )}

      {/* Filtros especiales — Ofertas y Stock */}
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
        <div className="space-y-0.5">
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
                checked={selectedCategorySlugs.includes(cat.slug)}
                onClick={() => toggleCategory(cat.slug)}
              />
              {cat.children && cat.children.length > 0 && isParentActive(cat) && (
                <div className="mt-0.5 space-y-0.5 ml-2 pl-2 border-l-2 border-[#dce9ff]">
                  {cat.children.map((sub) => (
                    <CategoryItem
                      key={sub.id}
                      label={sub.name}
                      count={sub._count?.products || 0}
                      checked={selectedCategorySlugs.includes(sub.slug)}
                      indent
                      onClick={() => toggleCategory(sub.slug)}
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
            <div className="py-2 border-b border-[#bdcaba]/40">
              <button
                onClick={clearAllAttrs}
                className="text-xs text-red-500 hover:text-red-700 hover:underline flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
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
                <div className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
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
    <div className="storefront min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta title={metaTitle} description="Explorá todo el catálogo de accesorios electrónicos en IGWT Store." />
      <Navbar />

      <main className="flex-1 max-w-[1280px] mx-auto px-6 py-8 w-full">
        <div className="flex flex-col md:flex-row gap-6">

          {/* ─── Sidebar desktop ─────────────────────────────────────────── */}
          <aside className="hidden md:block w-64 flex-shrink-0">
            <div className="bg-white rounded-xl border border-[#bdcaba]/30 p-5 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] sticky top-24">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#bdcaba]/40">
                <span className="material-symbols-outlined text-[#006b2c] text-[20px]">filter_list</span>
                <h2 className="font-bold text-[#0b1c30] text-sm tracking-wide uppercase">Filtros</h2>
              </div>
              {renderSidebar()}
            </div>
          </aside>

          {/* ─── Mobile: botón abrir drawer ──────────────────────────────── */}
          <div className="md:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#bdcaba]/50 rounded-xl shadow-sm text-sm font-semibold text-[#0b1c30] hover:border-[#006b2c] transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">filter_list</span>
              Filtros
              {hasAnyFilter && (
                <span className="bg-[#00873a] text-white text-xs rounded-full px-1.5 py-0.5 font-bold">
                  {selectedCategorySlugs.length + (currentOnSale ? 1 : 0) + (currentLowStock ? 1 : 0) + totalAttrFilters}
                </span>
              )}
            </button>
          </div>

          {/* ─── Mobile drawer ────────────────────────────────────────────── */}
          {sidebarOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => setSidebarOpen(false)}
              />
              <div className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-2xl overflow-y-auto">
                <div className="flex items-center justify-between p-4 border-b border-[#bdcaba]/30 bg-[#0F172A]">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[#7ffc97] text-[20px]">filter_list</span>
                    <h2 className="font-bold text-white">Filtros</h2>
                  </div>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="text-white/60 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
                <div className="p-4">
                  {renderSidebar()}
                </div>
              </div>
            </div>
          )}

          {/* ─── Área de productos ────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">

            {/* Encabezado con título, contador, chips y controles */}
            <div className="flex flex-col gap-3 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-[#0b1c30] tracking-tight">
                    {currentSearch
                      ? `Resultados para "${currentSearch}"`
                      : currentOnSale
                      ? "Productos en oferta"
                      : currentLowStock
                      ? "Pocas unidades"
                      : selectedCategorySlugs.length === 1
                      ? findCategoryName(selectedCategorySlugs[0])
                      : selectedCategorySlugs.length > 1
                      ? `${selectedCategorySlugs.length} categorías seleccionadas`
                      : "Catálogo completo"}
                  </h1>
                  {pagination && (
                    <p className="text-sm text-[#565e74] mt-0.5">
                      {pagination.total} producto{pagination.total !== 1 ? "s" : ""}
                      {totalAttrFilters > 0 && (
                        <span className="ml-2 text-[#006b2c] font-medium">
                          · {totalAttrFilters} filtro{totalAttrFilters !== 1 ? "s" : ""} de características
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {/* Ordenamiento + toggle de vista */}
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  {currentSearch && (
                    <button
                      onClick={() => setFilter("search", "")}
                      className="text-sm text-red-500 hover:underline flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                      Limpiar búsqueda
                    </button>
                  )}
                  <select
                    value={currentSortOrder}
                    onChange={(e) => setFilter("sortOrder", e.target.value)}
                    className="text-sm border border-[#bdcaba]/50 rounded-lg px-3 py-1.5 bg-white text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006b2c]/30"
                  >
                    <option value="newest">Más nuevo a más viejo</option>
                    <option value="oldest">Más viejo a más nuevo</option>
                    <option value="az">Nombre: A → Z</option>
                    <option value="za">Nombre: Z → A</option>
                  </select>
                  <select
                    value={currentSortPrice}
                    onChange={(e) => setFilter("sortPrice", e.target.value)}
                    className="text-sm border border-[#bdcaba]/50 rounded-lg px-3 py-1.5 bg-white text-[#0b1c30] focus:outline-none focus:ring-2 focus:ring-[#006b2c]/30"
                  >
                    <option value="">Precio: sin orden</option>
                    <option value="asc">Precio: menor a mayor</option>
                    <option value="desc">Precio: mayor a menor</option>
                  </select>

                  {/* Toggle grilla / lista */}
                  <div className="flex items-center border border-[#bdcaba]/50 rounded-lg overflow-hidden bg-white">
                    <button
                      onClick={() => handleSetView("grid")}
                      title="Vista grilla"
                      className={`p-1.5 transition-colors ${
                        viewMode === "grid"
                          ? "bg-[#0b1c30] text-white"
                          : "text-[#565e74] hover:text-[#0b1c30]"
                      }`}
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
                      className={`p-1.5 transition-colors ${
                        viewMode === "list"
                          ? "bg-[#0b1c30] text-white"
                          : "text-[#565e74] hover:text-[#0b1c30]"
                      }`}
                    >
                      {/* Ícono lista */}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Chips de atributos activos */}
              {totalAttrFilters > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(selectedAttrs).map(([attrName, values]) =>
                    values.map((val) => (
                      <button
                        key={`${attrName}:${val}`}
                        onClick={() => toggleAttrValue(attrName, val)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#eff4ff] text-[#0b1c30] border border-[#bdcaba]/50 rounded-full text-xs font-medium hover:bg-[#dce9ff] transition-colors"
                      >
                        <span className="text-[#006b2c] font-semibold">{attrName}:</span> {val}
                        <span className="material-symbols-outlined text-[12px] text-[#565e74] ml-0.5">close</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* ─── Contenido: loading / vacío / productos ─── */}
            {loading ? (
              <div className={
                viewMode === "list"
                  ? "space-y-3"
                  : "grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
              }>
                {[...Array(viewMode === "list" ? 6 : 12)].map((_, i) => (
                  viewMode === "list" ? (
                    <div key={i} className="bg-white rounded-xl border border-[#bdcaba]/30 animate-pulse flex gap-5 p-4">
                      <div className="w-40 h-40 bg-[#dce9ff] rounded-xl flex-shrink-0" />
                      <div className="flex-1 flex flex-col justify-between py-1">
                        <div className="space-y-2">
                          <div className="h-3 bg-[#dce9ff] rounded w-1/5" />
                          <div className="h-5 bg-[#dce9ff] rounded w-2/3" />
                          <div className="h-3 bg-[#dce9ff] rounded w-full" />
                          <div className="h-3 bg-[#dce9ff] rounded w-4/5" />
                        </div>
                        <div className="flex justify-between items-end">
                          <div className="h-7 bg-[#dce9ff] rounded w-1/4" />
                          <div className="h-9 bg-[#dce9ff] rounded w-24" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="bg-white rounded-xl border border-[#bdcaba]/30 animate-pulse overflow-hidden">
                      <div className="aspect-square bg-[#dce9ff]" />
                      <div className="p-4 space-y-2">
                        <div className="h-4 bg-[#dce9ff] rounded w-3/4" />
                        <div className="h-4 bg-[#dce9ff] rounded w-1/2" />
                      </div>
                    </div>
                  )
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-[#565e74]">
                <span className="material-symbols-outlined text-[80px] text-[#bdcaba] mb-4">search_off</span>
                <p className="text-lg font-semibold text-[#0b1c30] mb-2">No se encontraron productos</p>
                {totalAttrFilters > 0 && (
                  <button
                    onClick={clearAllAttrs}
                    className="mt-2 text-[#006b2c] hover:underline text-sm font-medium"
                  >
                    Quitar filtros de características
                  </button>
                )}
                <button
                  onClick={() => setSearchParams({})}
                  className="mt-2 text-[#006b2c] hover:underline text-sm font-medium"
                >
                  Ver todos los productos
                </button>
              </div>
            ) : (
              <>
                <div className={
                  viewMode === "list"
                    ? "space-y-3"
                    : "grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
                }>
                  {/* Antes: sortProducts(products) — ordenaba en el cliente y solo afectaba la página
                      actual (20 de N). Ahora el orden lo resuelve el backend según sortOrder/sortPrice. */}
                  {products.map((p) => (
                    <ProductCard key={p.id} product={p} viewMode={viewMode} />
                  ))}
                </div>

                {/* Paginación */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-12">
                    {/* Anterior */}
                    <button
                      onClick={() => setFilter("page", String(Math.max(1, currentPage - 1)))}
                      disabled={currentPage === 1}
                      className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#bdcaba]/50 hover:bg-[#eff4ff] transition-colors text-[#565e74] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined">chevron_left</span>
                    </button>

                    {[...Array(pagination.totalPages)].map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setFilter("page", String(i + 1))}
                        className={`w-10 h-10 flex items-center justify-center rounded-lg text-sm font-semibold transition-colors ${
                          currentPage === i + 1
                            ? "bg-[#0b1c30] text-white"
                            : "border border-[#bdcaba]/50 bg-white text-[#565e74] hover:border-[#006b2c] hover:text-[#006b2c]"
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}

                    {/* Siguiente */}
                    <button
                      onClick={() => setFilter("page", String(Math.min(pagination.totalPages, currentPage + 1)))}
                      disabled={currentPage === pagination.totalPages}
                      className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#bdcaba]/50 hover:bg-[#eff4ff] transition-colors text-[#565e74] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined">chevron_right</span>
                    </button>
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
