import { useEffect } from "react";

// Bloquea el scroll de la página mientras un panel del celular está abierto (hojas de la barra
// inferior, menú lateral).
//
// Además de overflow:hidden en <body>, lo aplica en <html> (en iOS con body solo no alcanza) y
// desactiva el "tirar para recargar" del navegador con overscroll-behavior. Sin esto, deslizar
// hacia abajo sobre la hoja de Categorías con la página arriba de todo recargaba la página.
export default function useScrollLock(active) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscroll: html.style.overscrollBehaviorY,
      bodyOverscroll: body.style.overscrollBehaviorY,
    };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      html.style.overscrollBehaviorY = prev.htmlOverscroll;
      body.style.overscrollBehaviorY = prev.bodyOverscroll;
    };
  }, [active]);
}
