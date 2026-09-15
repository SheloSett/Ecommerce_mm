import { useRef, useState } from "react";

// ─── Recuadro punteado para subir archivos ────────────────────────────────────
// El clásico "arrastrá acá o hacé clic para elegir". Mantiene el <input type="file"> oculto
// adentro, así el botón nativo del navegador desaparece y todo el recuadro es clickeable.
//
// Props:
//   accept    → mismo formato que el input (ej. "image/*")
//   multiple  → permite varios
//   onFiles   → (File[]) => void — se llama con los archivos elegidos o soltados
//   inputRef  → ref opcional al <input>, por si el padre quiere resetearlo
//   tone      → "blue" (fotos) | "violet" (videos)
//   title / hint → textos del recuadro
//   icon      → nombre de Material Symbol
export default function FileDropZone({ accept, multiple = true, onFiles, inputRef, tone = "blue", title, hint, icon = "upload" }) {
  const localRef = useRef(null);
  const ref = inputRef || localRef;
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const tones = {
    blue:   { idle: "border-blue-200 bg-blue-50/40 hover:bg-blue-50 text-blue-700", over: "border-blue-500 bg-blue-100 text-blue-800", icon: "text-blue-500" },
    violet: { idle: "border-violet-200 bg-violet-50/40 hover:bg-violet-50 text-violet-700", over: "border-violet-500 bg-violet-100 text-violet-800", icon: "text-violet-500" },
  };
  const t = tones[tone] || tones.blue;

  const pick = (files) => {
    const list = Array.from(files || []);
    if (list.length > 0) onFiles(list);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current += 1; setOver(true); }}
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(e) => { if (!hasFiles(e)) return; e.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current = 0; setOver(false); pick(e.dataTransfer.files); }}
      className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center cursor-pointer select-none transition-colors ${over ? t.over : t.idle}`}
    >
      <span className={`material-symbols-outlined ${t.icon}`} style={{ fontSize: 30 }} aria-hidden="true">{over ? "download" : icon}</span>
      <p className="text-sm font-semibold">{over ? "Soltá acá" : title}</p>
      {hint && !over && <p className="text-xs opacity-70">{hint}</p>}
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => { pick(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}
