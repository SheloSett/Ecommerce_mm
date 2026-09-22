import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import BottomSheet from "./BottomSheet";
import { CategoryChip } from "./CategoryCard";
import { useCustomerAuth } from "../context/CustomerAuthContext";
import { useCart } from "../context/CartContext";
import { useWishlist } from "../context/WishlistContext";
import { useSiteConfig } from "../context/SiteConfigContext";
import { useNotifications } from "../context/NotificationContext";
import { categoriesApi } from "../services/api";
import { categoryIconName } from "../utils/categoryIcon";

// ─── Barra de navegación inferior (solo celular) ──────────────────────────────
// Pedido del cliente: seis pestañas fijas abajo, al alcance del pulgar.
//   Inicio · Menú (el menú lateral de siempre) · Buscar (la barra de búsqueda de arriba) ·
//   Categorías (hoja con la lista) · Carrito (el CartDrawer) · Cuenta (hoja con las opciones)
// Menú, Buscar y Carrito los maneja el Navbar (ya tenía esos paneles); Categorías y Cuenta son
// hojas propias de este componente.
//
// Mientras está visible le pone la clase has-bnav al <html>: index.css la usa para dejar un margen
// abajo en la página y subir los botones flotantes (WhatsApp, volver arriba), así nada queda tapado.

// Rutas donde la barra no va: ahí abajo está el botón de pagar y no tiene que competir con nada.
const HIDE_ON = ["/checkout", "/pago/", "/pagar-cotizacion/"];

// Campos que abren el teclado: mientras uno tiene el foco la barra se esconde (si no, en el celular
// queda flotando encima del teclado).
function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  return !["checkbox", "radio", "button", "submit", "reset", "file", "range", "color", "image"].includes(el.type);
}

function flatten(list, out = []) {
  for (const c of list || []) {
    out.push(c);
    flatten(c.children, out);
  }
  return out;
}

const ROW = "flex items-center gap-3 w-full px-5 py-3 text-[15px] text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors";

export default function MobileBottomNav({ menuOpen, onMenu, searchOpen, onSearch, cartOpen, onCart, onCloseOverlays }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { customer, customerLogout } = useCustomerAuth();
  const { totalItems } = useCart();
  const { wishlist } = useWishlist();
  const { theme, setTheme } = useSiteConfig();
  const { unreadCount, quotesCount } = useNotifications();

  const [sheet, setSheet] = useState(null); // "categories" | "account" | null
  const [cats, setCats] = useState([]);
  const [catsLoaded, setCatsLoaded] = useState(false);
  const [openCat, setOpenCat] = useState(null);
  const [typing, setTyping] = useState(false);

  const hidden = HIDE_ON.some((p) => location.pathname.startsWith(p));
  const isDark = theme === "oscuro";
  const isMayorista = customer?.type === "MAYORISTA";
  const closeSheet = useCallback(() => setSheet(null), []);

  // Al navegar se cierran las hojas
  useEffect(() => { setSheet(null); }, [location.pathname, location.search]);

  // Margen inferior de la página + botones flotantes más arriba (ver index.css → has-bnav)
  useEffect(() => {
    if (hidden) return;
    const el = document.documentElement;
    el.classList.add("has-bnav");
    return () => el.classList.remove("has-bnav");
  }, [hidden]);

  // Esconder la barra mientras el TECLADO está arriba (si no, en algunos celulares queda flotando
  // encima del teclado).
  //
  // Antes se miraba solo el foco: con un campo enfocado la barra se escondía. Pero en el iPhone se
  // puede bajar el teclado sin que el campo pierda el foco, y la barra quedaba escondida hasta tocar
  // otra cosa. Ahora, con un campo enfocado, se mira además el alto visible (visualViewport): cuando
  // sube el teclado se achica unos 300 px. "base" es el alto visible sin teclado; se actualiza cada vez
  // que no hay campo enfocado (así se adapta al girar el teléfono o cuando se esconde la barra del
  // navegador, que mueve el alto solo unos 50-80 px, por debajo del umbral).
  useEffect(() => {
    const vv = window.visualViewport;
    let base = vv ? vv.height : 0;
    let baseW = vv ? vv.width : 0;
    const update = () => {
      if (vv) {
        // Giró el teléfono: el alto de referencia se toma de nuevo
        if (Math.abs(vv.width - baseW) > 1) { baseW = vv.width; base = vv.height; }
        // Si se ve más alto que la referencia, ahí no hay teclado: esa pasa a ser la referencia
        if (vv.height > base) base = vv.height;
      }
      if (!isTextField(document.activeElement)) {
        if (vv) base = vv.height;
        setTyping(false);
        return;
      }
      if (!vv) { setTyping(true); return; } // navegador sin visualViewport: criterio anterior
      const keyboardUp = vv.scale < 1.05 && base - vv.height > 120;
      setTyping(keyboardUp);
    };
    const onFocusChange = () => setTimeout(update, 0);
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    vv?.addEventListener("resize", update);
    return () => {
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
      vv?.removeEventListener("resize", update);
    };
  }, []);

  // Categorías: se piden la primera vez que se abre la hoja
  useEffect(() => {
    if (sheet !== "categories" || catsLoaded) return;
    const visibleFor = isMayorista ? "MAYORISTA" : "MINORISTA";
    categoriesApi.getAll({ visibleFor })
      .then((res) => setCats(Array.isArray(res.data) ? res.data : []))
      .catch(() => setCats([]))
      .finally(() => setCatsLoaded(true));
  }, [sheet, catsLoaded, isMayorista]);

  if (hidden) return null;

  const toggleSheet = (name) => {
    onCloseOverlays();
    setSheet((s) => (s === name ? null : name));
  };
  const goHome = () => {
    setSheet(null);
    onCloseOverlays();
    if (location.pathname === "/") window.scrollTo({ top: 0, behavior: "smooth" });
    else navigate("/");
  };
  const handleLogout = () => {
    customerLogout();
    setSheet(null);
    toast.success("Sesión cerrada");
  };

  // Pestaña activa: la hoja o panel abierto manda; si no, la página actual
  const p = location.pathname;
  const hasSearchParam = !!new URLSearchParams(location.search).get("search");
  const active =
    sheet ? sheet
    : menuOpen ? "menu"
    : searchOpen ? "search"
    : cartOpen ? "cart"
    : p === "/" ? "home"
    : p.startsWith("/catalogo") ? (hasSearchParam ? "search" : "categories")
    : p === "/carrito" ? "cart"
    : ["/perfil", "/pedidos", "/cotizaciones", "/favoritos", "/login", "/registro"].some((x) => p.startsWith(x)) ? "account"
    : null;

  const tabs = [
    { key: "home", label: "Inicio", icon: "home", onClick: goHome },
    { key: "menu", label: "Menú", icon: "menu", onClick: () => { setSheet(null); onMenu(); } },
    { key: "search", label: "Buscar", icon: "search", onClick: () => { setSheet(null); onSearch(); } },
    { key: "categories", label: "Categorías", icon: "grid_view", onClick: () => toggleSheet("categories") },
    { key: "cart", label: "Carrito", icon: "shopping_cart", badge: customer ? totalItems : 0, badgeClass: "bg-[#00873a]", onClick: () => { setSheet(null); onCart(); } },
    { key: "account", label: "Cuenta", icon: "person", badge: customer ? unreadCount : 0, badgeClass: "bg-red-500", onClick: () => toggleSheet("account") },
  ];

  const styled = flatten(cats).filter((c) => c.cardStyle && c.cardStyle !== "normal");

  return (
    <>
      <nav
        aria-label="Navegación principal"
        className={`md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0F172A] shadow-[0_-6px_20px_rgba(0,0,0,0.25)] transition-transform duration-200 ${
          typing ? "translate-y-full" : "translate-y-0"
        }`}
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <ul className="grid h-[60px] grid-cols-6">
          {tabs.map((t) => {
            const on = active === t.key;
            return (
              <li key={t.key} className="min-w-0">
                <button
                  type="button"
                  onClick={t.onClick}
                  aria-label={t.label}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex h-full w-full flex-col items-center justify-center gap-1 transition-colors ${
                    on ? "text-[#7ffc97]" : "text-white/70 active:text-white"
                  }`}
                >
                  {on && <span className="absolute top-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-[#7ffc97]" aria-hidden="true" />}
                  <span className="relative leading-none">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 24, fontVariationSettings: on ? "'FILL' 1" : "'FILL' 0" }}
                      aria-hidden="true"
                    >
                      {t.icon}
                    </span>
                    {t.badge > 0 && (
                      <span className={`absolute -top-1.5 -right-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white ${t.badgeClass}`}>
                        {t.badge > 99 ? "99+" : t.badge}
                      </span>
                    )}
                  </span>
                  <span className="max-w-full truncate px-0.5 text-[10.5px] font-medium leading-none">{t.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Hoja: Categorías ── */}
      <BottomSheet open={sheet === "categories"} onClose={closeSheet} title="Categorías">
        <div className="px-4 pb-2">
          <Link
            to="/catalogo"
            onClick={closeSheet}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#00873a] py-3 font-semibold text-white active:brightness-110"
          >
            <span className="material-symbols-outlined" aria-hidden="true">storefront</span>
            Ver todo el catálogo
          </Link>
        </div>
        {!catsLoaded ? (
          <p className="px-5 py-4 text-sm text-slate-400">Cargando...</p>
        ) : cats.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">No hay categorías para mostrar.</p>
        ) : (
          <>
            {styled.length > 0 && (
              <div className="px-5 pt-2 pb-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Destacadas</p>
                <div className="flex flex-wrap gap-2">
                  {styled.map((c) => (
                    <Link key={c.id} to={`/catalogo?category=${c.slug}`} onClick={closeSheet}>
                      <CategoryChip cat={c} />
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <p className="px-5 pt-1 pb-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Todas</p>
            {cats.map((c) => (
              <div key={c.id}>
                <div className="flex items-center">
                  <Link to={`/catalogo?category=${c.slug}`} onClick={closeSheet} className={`${ROW} flex-1`}>
                    <span className="material-symbols-outlined text-slate-500" aria-hidden="true">{categoryIconName(c)}</span>
                    <span className="flex-1 leading-tight">{c.name}</span>
                  </Link>
                  {c.children?.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOpenCat((o) => (o === c.id ? null : c.id))}
                      aria-label={`${openCat === c.id ? "Ocultar" : "Ver"} subcategorías de ${c.name}`}
                      aria-expanded={openCat === c.id}
                      className="px-4 py-3 text-slate-400"
                    >
                      <span className={`material-symbols-outlined transition-transform duration-200 ${openCat === c.id ? "rotate-180" : ""}`}>expand_more</span>
                    </button>
                  )}
                </div>
                {openCat === c.id && (
                  <div className="pb-1">
                    {c.children.map((ch) => (
                      <Link
                        key={ch.id}
                        to={`/catalogo?category=${ch.slug}`}
                        onClick={closeSheet}
                        className="block py-2.5 pl-14 pr-5 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-200"
                      >
                        {ch.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </BottomSheet>

      {/* ── Hoja: Cuenta ── */}
      <BottomSheet open={sheet === "account"} onClose={closeSheet} title={customer ? "Mi cuenta" : "Cuenta"}>
        {customer ? (
          <>
            <div className="flex items-center gap-3 px-5 pb-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-200">
                <span className="material-symbols-outlined text-slate-500" aria-hidden="true">person</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{customer.name}</p>
                <p className="truncate text-xs text-slate-400">{customer.email}</p>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${isMayorista ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                  {isMayorista ? "Mayorista" : "Minorista"}
                </span>
              </div>
            </div>
            <Link to="/pedidos" onClick={closeSheet} className={ROW}>
              <span className="material-symbols-outlined text-slate-500" aria-hidden="true">receipt_long</span>
              <span className="flex-1">Mis pedidos</span>
              {isMayorista && unreadCount > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            {/* Antes: solo mayoristas — ver el mismo cambio en Navbar.jsx */}
            {(isMayorista || quotesCount > 0) && (
              <Link to="/cotizaciones" onClick={closeSheet} className={ROW}>
                <span className="material-symbols-outlined text-slate-500" aria-hidden="true">request_quote</span>
                Mis cotizaciones
              </Link>
            )}
            <Link to="/favoritos" onClick={closeSheet} className={ROW}>
              <span className="material-symbols-outlined text-red-400" aria-hidden="true">favorite</span>
              <span className="flex-1">Mis favoritos</span>
              {wishlist.length > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-100 px-1 text-xs font-bold text-red-600">
                  {wishlist.length}
                </span>
              )}
            </Link>
            <Link to="/perfil" onClick={closeSheet} className={ROW}>
              <span className="material-symbols-outlined text-slate-500" aria-hidden="true">manage_accounts</span>
              Mi perfil
            </Link>
          </>
        ) : (
          <div className="space-y-2 px-5 pb-2">
            <p className="text-sm text-slate-500">Iniciá sesión para comprar, ver tus pedidos y, si sos mayorista, tus precios.</p>
            <Link to="/login" onClick={closeSheet} className="block w-full rounded-xl bg-[#00873a] py-3 text-center font-semibold text-white active:brightness-110">
              Iniciar sesión
            </Link>
            <Link to="/registro" onClick={closeSheet} className="block w-full rounded-xl border border-slate-200 py-3 text-center font-semibold text-slate-700 active:bg-slate-100">
              Crear cuenta
            </Link>
          </div>
        )}

        <div className="my-2 border-t border-slate-200" />

        {/* Switch modo claro / oscuro (el mismo del menú lateral) */}
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          onClick={() => setTheme(isDark ? "clasico" : "oscuro")}
          className={`${ROW} justify-between`}
        >
          <span className="flex items-center gap-3">
            <span className="material-symbols-outlined text-slate-500" aria-hidden="true">{isDark ? "dark_mode" : "light_mode"}</span>
            <span>{isDark ? "Modo oscuro" : "Modo claro"}</span>
          </span>
          <span className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-300 ${isDark ? "bg-[#00873a]" : "bg-slate-300"}`}>
            <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${isDark ? "translate-x-5" : "translate-x-0"}`} />
          </span>
        </button>

        {customer && (
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-5 py-3 text-[15px] text-red-600 hover:bg-red-50 active:bg-red-100 transition-colors"
          >
            <span className="material-symbols-outlined" aria-hidden="true">logout</span>
            Cerrar sesión
          </button>
        )}
      </BottomSheet>
    </>
  );
}
