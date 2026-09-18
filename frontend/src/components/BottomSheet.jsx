import { useEffect } from "react";

// ─── Hoja que sube desde abajo (solo celular) ─────────────────────────────────
// La usan las pestañas Categorías y Cuenta de la barra inferior. Se cierra tocando afuera, con la
// ✕ o con Escape, y bloquea el scroll de la página mientras está abierta. Respeta la franja del
// gesto de inicio del iPhone. Los colores son los mismos del menú lateral, así el tema oscuro de
// la tienda los ajusta solo (overrides de index.css sobre .storefront).
export default function BottomSheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      <div
        className={`md:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
        className={`md:hidden fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] flex-col rounded-t-2xl bg-[#f8f9ff] shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex justify-center pt-2.5" aria-hidden="true">
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
        <div className="flex-1 overflow-y-auto overscroll-contain pb-3">{children}</div>
      </div>
    </>
  );
}
