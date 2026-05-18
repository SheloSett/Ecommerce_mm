import { useLayoutEffect, useRef, useState } from "react";

/**
 * Renderiza texto que se achica automáticamente para caber en su contenedor,
 * en vez de truncarse con "...". Útil para mostrar montos que pueden crecer
 * mucho en pantallas medianas (iPad, tablets) donde las cards quedan angostas.
 *
 * Props:
 *  - max: tamaño máximo de fuente en px (default 30)
 *  - min: tamaño mínimo de fuente en px (default 12)
 *  - className: clases adicionales (no incluir text-XX para no pisar el size dinámico)
 */
export default function FitText({ children, max = 30, min = 12, className = "" }) {
  const containerRef = useRef(null);
  const textRef      = useRef(null);
  const [fontSize, setFontSize] = useState(max);

  useLayoutEffect(() => {
    const fit = () => {
      const container = containerRef.current;
      const text      = textRef.current;
      if (!container || !text) return;

      // Empezamos en el tamaño máximo y vamos bajando hasta que entre.
      let size = max;
      text.style.fontSize = size + "px";
      // scrollWidth = ancho real del texto; clientWidth = ancho disponible del contenedor.
      // Si el texto desborda, achicamos de a 1px hasta que entre o lleguemos al mínimo.
      while (text.scrollWidth > container.clientWidth && size > min) {
        size -= 1;
        text.style.fontSize = size + "px";
      }
      setFontSize(size);
    };

    fit();
    // Re-medimos si cambia el tamaño del contenedor (rotación, resize, sidebar abierto/cerrado, etc.)
    const ro = new ResizeObserver(fit);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [children, max, min]);

  return (
    <span ref={containerRef} className={`block overflow-hidden ${className}`}>
      <span
        ref={textRef}
        className="inline-block whitespace-nowrap"
        style={{ fontSize: `${fontSize}px`, lineHeight: 1 }}
      >
        {children}
      </span>
    </span>
  );
}
