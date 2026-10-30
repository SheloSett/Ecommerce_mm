import { useEffect, useState } from "react";
import { getImageUrl } from "../services/api";

// Foto de producto al tamaño en que se muestra (ver getImageUrl en services/api.js) y con carga
// diferida: el navegador la baja recién cuando está por entrar en pantalla. Antes cada <img> pedía la
// versión de 1200×1200 y todas se bajaban al abrir la página, aunque estuvieran abajo de todo.
//
// Si la versión achicada no carga (por ejemplo, si la cuenta de Cloudinary no permite generar
// tamaños nuevos), vuelve sola a la original: en el peor caso queda como antes.
//
// size: lado en px que se le pide a Cloudinary (conviene ~2× lo que se ve, por las pantallas densas).
export default function ProductImage({ src, size, alt = "", loading = "lazy", ...rest }) {
  const sized = getImageUrl(src, size);
  const original = getImageUrl(src);
  const [current, setCurrent] = useState(sized);
  useEffect(() => { setCurrent(sized); }, [sized]);

  return (
    <img
      src={current}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => { if (current !== original) setCurrent(original); }}
      {...rest}
    />
  );
}
