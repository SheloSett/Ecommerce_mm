import { useEditor, EditorContent, Extension, Mark } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { useEffect } from "react";

// Extensión de color adaptativo: guarda data-rte-color="negro" en el HTML.
// El CSS (index.css) define el color real según el tema — sin inline styles con variables.
// Esto garantiza que el color cambia automáticamente al cambiar de modo claro/oscuro.
const AdaptiveColor = Mark.create({
  name: "adaptiveColor",
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-rte-color"),
        // Genera data-rte-color Y style con var() — doble garantía:
        // el inline style con var() se adapta automáticamente al cambiar el tema.
        renderHTML: (attrs) =>
          attrs.color
            ? {
                "data-rte-color": attrs.color,
                style: `color: var(--rte-${attrs.color})`,
              }
            : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-rte-color]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
  addCommands() {
    return {
      setAdaptiveColor: (color) => ({ commands }) =>
        commands.setMark(this.name, { color }),
      unsetAdaptiveColor: () => ({ commands }) =>
        commands.unsetMark(this.name),
    };
  },
});

// Extensión custom de font-size (no existe en npm para esta versión de TipTap)
// Agrega el atributo fontSize a TextStyle y los comandos setFontSize/unsetFontSize
const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize || null,
            renderHTML: (attrs) => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) =>
        chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) =>
        chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

const FONT_SIZES = [
  { label: "Pequeño", value: "12px" },
  { label: "Normal",  value: null },
  { label: "Grande",  value: "20px" },
  { label: "Muy grande", value: "26px" },
  { label: "Título",  value: "32px" },
];

// Colores adaptativos: el editor guarda "var(--rte-negro)" etc. como inline style.
// La variable CSS cambia de valor según el tema (claro/oscuro) sin tocar el HTML.
// "swatch" es el color del círculo que ve el usuario al elegir (siempre versión clara).
const COLORS = [
  { label: "Negro",    var: "var(--rte-negro)",    swatch: "#1e293b" },
  { label: "Rojo",     var: "var(--rte-rojo)",     swatch: "#dc2626" },
  { label: "Naranja",  var: "var(--rte-naranja)",  swatch: "#ea580c" },
  { label: "Amarillo", var: "var(--rte-amarillo)", swatch: "#ca8a04" },
  { label: "Verde",    var: "var(--rte-verde)",    swatch: "#16a34a" },
  { label: "Azul",     var: "var(--rte-azul)",     swatch: "#2563eb" },
  { label: "Violeta",  var: "var(--rte-violeta)",  swatch: "#7c3aed" },
  { label: "Rosa",     var: "var(--rte-rosa)",     swatch: "#db2777" },
  { label: "Blanco",   var: "var(--rte-blanco)",   swatch: "#ffffff" },
];

function ToolbarButton({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`px-2 py-1 rounded text-sm transition-colors ${
        active
          ? "bg-blue-100 text-blue-700 font-bold"
          : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({ value, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      AdaptiveColor,
      FontSize,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value || "",
    onUpdate({ editor }) {
      // Emitir HTML al padre; si el editor está vacío devolver string vacío
      const html = editor.isEmpty ? "" : editor.getHTML();
      onChange(html);
    },
  });

  // Sincronizar cuando value cambia externamente (ej: al abrir edición de otro producto)
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value || "", false);
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-400">
      {/* ── Barra de herramientas ── */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-slate-50 border-b border-slate-200">

        {/* Negritas */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Negrita"
        >
          <strong>N</strong>
        </ToolbarButton>

        {/* Cursiva */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Cursiva"
        >
          <em>I</em>
        </ToolbarButton>

        {/* Subrayado */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Subrayado"
        >
          <span style={{ textDecoration: "underline" }}>S</span>
        </ToolbarButton>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        {/* Alineación */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          active={editor.isActive({ textAlign: "left" })}
          title="Izquierda"
        >≡</ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          active={editor.isActive({ textAlign: "center" })}
          title="Centro"
        >≡</ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          active={editor.isActive({ textAlign: "right" })}
          title="Derecha"
        >≡</ToolbarButton>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        {/* Lista con viñetas */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Lista"
        >• —</ToolbarButton>

        {/* Lista numerada */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Lista numerada"
        >1.</ToolbarButton>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        {/* Tamaño de texto */}
        <select
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const val = e.target.value;
            if (!val) {
              editor.chain().focus().unsetFontSize().run();
            } else {
              editor.chain().focus().setFontSize(val).run();
            }
          }}
          defaultValue=""
          className="text-xs border border-slate-200 rounded px-1 py-1 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
          title="Tamaño de texto"
        >
          {FONT_SIZES.map((s) => (
            <option key={s.label} value={s.value ?? ""}>
              {s.label}
            </option>
          ))}
        </select>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        {/* Colores adaptativos: guarda data-rte-color="negro" en el HTML,
            el CSS define el color real según el tema */}
        <span className="text-xs text-slate-400 mr-1">Color:</span>
        {COLORS.map((c) => (
          <button
            key={c.var}
            type="button"
            title={c.label}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().setAdaptiveColor(c.label.toLowerCase()).run();
            }}
            className="w-5 h-5 rounded-full border border-slate-300 hover:scale-110 transition-transform flex-shrink-0"
            style={{ backgroundColor: c.swatch }}
          />
        ))}

        {/* Quitar color */}
        <button
          type="button"
          title="Quitar color"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetAdaptiveColor().run(); }}
          className="text-xs text-slate-400 hover:text-slate-600 px-1"
        >✕</button>

        <div className="w-px h-5 bg-slate-200 mx-1" />

        {/* Limpiar formato */}
        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          title="Limpiar formato"
        >
          ✕ fmt
        </ToolbarButton>
      </div>

      {/* ── Área de edición ── */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none px-3 py-2 min-h-[100px] text-sm focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[80px] [&_.ProseMirror]:text-inherit [&_strong]:font-bold [&_b]:font-bold"
      />
    </div>
  );
}
