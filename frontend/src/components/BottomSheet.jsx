import { useEffect, useRef } from "react";
import useScrollLock from "../utils/useScrollLock";

// ─── Hoja que sube desde abajo (solo celular) ─────────────────────────────────
// La usan las pestañas Categorías y Cuenta de la barra inferior. Se cierra tocando afuera, con la
// ✕, con Escape o ARRASTRÁNDOLA hacia abajo (desde la rayita/título, o desde la lista cuando ya
// está arriba de todo), como las hojas de las apps. Bloquea el scroll de la página y el "tirar para
// recargar" mientras está abierta. Respeta la franja del gesto de inicio del iPhone. Los colores son
// los mismos del menú lateral, así el tema oscuro de la tienda los ajusta solo.
//
// Antes la rayita de arriba invitaba a arrastrar pero la hoja no se movía: el gesto le llegaba a la
// página y, con la página arriba de todo, el navegador la recargaba.

const CLOSE_DISTANCE = 90; // px arrastrados que alcanzan para cerrar
const CLOSE_VELOCITY = 0.5; // px/ms: un deslizamiento rápido cierra aunque sea corto

export default function BottomSheet({ open, onClose, title, children }) {
  const panelRef = useRef(null);
  const overlayRef = useRef(null);
  const listRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useScrollLock(open);

  // Escape cierra
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Al abrir o cerrar se limpian los estilos que deja el arrastre (la clase manda de nuevo)
  useEffect(() => {
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (panel) { panel.style.transform = ""; panel.style.transition = ""; }
    if (overlay) overlay.style.opacity = "";
  }, [open]);

  // Arrastrar para cerrar. Listeners nativos NO pasivos: hace falta preventDefault en touchmove para
  // que el navegador no mueva la página (ni la recargue) mientras se arrastra la hoja.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const s = { startY: 0, t0: 0, dy: 0, fromList: false, mode: null };

    const onStart = (e) => {
      s.startY = e.touches[0].clientY;
      s.t0 = Date.now();
      s.dy = 0;
      s.mode = null;
      s.fromList = !!listRef.current && listRef.current.contains(e.target);
    };
    const onMove = (e) => {
      const dy = e.touches[0].clientY - s.startY;
      if (s.mode === null) {
        // Desde la rayita/título siempre es arrastre. Desde la lista, solo si ya está arriba de
        // todo y el dedo baja; si no, es el scroll normal de la lista.
        if (!s.fromList) s.mode = "drag";
        else if (listRef.current.scrollTop <= 0 && dy > 0) s.mode = "drag";
        else if (dy !== 0) s.mode = "scroll";
      }
      if (s.mode !== "drag") return;
      e.preventDefault();
      s.dy = Math.max(0, dy);
      panel.style.transition = "none";
      panel.style.transform = `translateY(${s.dy}px)`;
      if (overlayRef.current) {
        const h = panel.offsetHeight || 1;
        overlayRef.current.style.opacity = String(Math.max(0.15, 1 - s.dy / h));
      }
    };
    const onEnd = () => {
      if (s.mode === "drag") {
        const velocity = s.dy / Math.max(1, Date.now() - s.t0);
        const close = s.dy > CLOSE_DISTANCE || (s.dy > 30 && velocity > CLOSE_VELOCITY);
        panel.style.transition = "";
        if (close) {
          // Termina de bajar desde donde quedó el dedo; el efecto de [open] limpia el estilo después
          panel.style.transform = "translateY(100%)";
          onCloseRef.current();
        } else {
          panel.style.transform = ""; // vuelve a su lugar con la transición de la clase
          if (overlayRef.current) overlayRef.current.style.opacity = "";
        }
      }
      s.mode = null;
      s.dy = 0;
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [open]);

  return (
    <>
      <div
        ref={overlayRef}
        className={`md:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm touch-none transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
        className={`md:hidden fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] flex-col rounded-t-2xl bg-[#f8f9ff] shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Zona de agarre: rayita + título. touch-none = el navegador no usa estos gestos */}
        <div className="touch-none select-none">
          <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
            <span className="h-1.5 w-10 rounded-full bg-slate-300" />
          </div>
          <div className="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 className="text-base font-bold text-slate-800">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 rounded-lg p-1 text-slate-500 hover:bg-slate-100"
              aria-label="Cerrar"
              tabIndex={open ? 0 : -1}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain pb-3">{children}</div>
      </div>
    </>
  );
}
