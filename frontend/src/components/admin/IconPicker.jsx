import { useMemo, useState } from "react";

// ─── Selector de ícono (Material Symbols) ─────────────────────────────────────
// La tienda ya carga la fuente "Material Symbols Outlined" de Google (index.html), así que cualquier
// nombre de esa librería funciona sin agregar nada. Acá hay una lista curada con palabras clave en
// español para buscar rápido, y un campo libre para escribir cualquier otro nombre de
// https://fonts.google.com/icons (se ve la vista previa al instante).
//
// Props: value (nombre del ícono o ""), onChange(nombre), fallback (ícono que se usa si queda vacío)

export const ICON_CHOICES = [
  // Cables / energía
  ["cable", "cable adaptador hub conversor"], ["usb", "usb pendrive"], ["power", "cable enchufe energía"],
  ["electrical_services", "enchufe electricidad ficha"], ["settings_input_hdmi", "hdmi video"], ["settings_input_component", "rca componente"],
  ["bolt", "rayo energía rápido"], ["battery_charging_full", "batería cargando powerbank"], ["battery_full", "batería pila"],
  ["charging_station", "cargador estación"], ["outlet", "tomacorriente enchufe"], ["power_settings_new", "encendido power"],
  // Audio
  ["headphones", "auriculares audífonos"], ["headset", "auricular con micrófono headset gamer"], ["speaker", "parlante bafle"],
  ["speaker_group", "parlantes equipo"], ["mic", "micrófono"], ["radio", "radio"], ["music_note", "música"], ["volume_up", "volumen sonido"],
  ["earbuds", "auriculares inalámbricos earbuds"], ["hearing", "oído audio"],
  // Dispositivos
  ["smartphone", "celular teléfono"], ["phone_iphone", "iphone funda"], ["phone_android", "android"], ["tablet", "tablet ipad"],
  ["laptop", "notebook laptop"], ["computer", "computadora pc"], ["desktop_windows", "pc escritorio"], ["monitor", "monitor pantalla"],
  ["tv", "televisor tv"], ["cast", "tv box cast chromecast"], ["smart_display", "pantalla inteligente"], ["watch", "reloj smartwatch"],
  ["keyboard", "teclado"], ["mouse", "mouse ratón periférico"], ["devices", "dispositivos accesorios"], ["devices_other", "otros dispositivos varios"],
  ["memory", "memoria chip ram"], ["sd_card", "memoria sd tarjeta"], ["save", "almacenamiento disco"], ["storage", "almacenamiento disco duro"],
  ["dns", "servidor red"], ["router", "router red"], ["wifi", "wifi internet"], ["bluetooth", "bluetooth"], ["nfc", "nfc"],
  ["print", "impresora"], ["scanner", "escáner"], ["photo_camera", "cámara foto"], ["videocam", "cámara video gopro"],
  ["camera", "cámara lente"], ["flash_on", "flash"], ["sim_card", "chip sim"], ["sensors", "sensor"],
  // Gaming
  ["sports_esports", "consola joystick gamer videojuegos"], ["stadia_controller", "control joystick gamepad"], ["toys", "juguetes drones"],
  ["flight", "drone vuelo"], ["vrpanorama", "realidad virtual vr"],
  // Iluminación / hogar
  ["lightbulb", "lámpara luz iluminación"], ["light", "luz lámpara colgante"], ["flashlight_on", "linterna"], ["emoji_objects", "idea luz led"],
  ["wb_incandescent", "foco lamparita"], ["highlight", "luz led tira"], ["home", "hogar casa"], ["kitchen", "cocina"],
  ["coffee", "café termo taza"], ["local_bar", "vaso bebida bar"], ["water_drop", "agua"], ["king_bed", "cama acolchado"],
  ["bed", "cama colchón"], ["chair", "silla"], ["weekend", "sillón living"], ["cleaning_services", "limpieza"],
  ["ac_unit", "aire frío hielo"], ["thermostat", "temperatura"], ["local_laundry_service", "lavarropas"], ["blender", "licuadora"],
  ["microwave", "microondas"], ["iron", "plancha"], ["yard", "jardín"], ["pool", "pileta"],
  // Herramientas / soportes
  ["build", "herramientas"], ["handyman", "herramientas reparación"], ["construction", "construcción"], ["hardware", "tornillo"],
  ["precision_manufacturing", "soporte brazo"], ["tripod", "trípode"], ["dock", "base dock soporte"], ["straighten", "regla medir"],
  ["lock", "candado seguridad"], ["key", "llave"], ["security", "seguridad"], ["videocam", "cámara seguridad"],
  // Movilidad
  ["directions_car", "auto"], ["two_wheeler", "moto"], ["pedal_bike", "bicicleta"], ["electric_scooter", "monopatín scooter"],
  ["local_shipping", "envío camión"], ["luggage", "valija viaje"], ["backpack", "mochila"],
  // Moda / personal
  ["checkroom", "ropa indumentaria"], ["watch", "reloj"], ["diamond", "joya premium"], ["face", "cuidado personal"],
  ["spa", "spa belleza"], ["fitness_center", "gimnasio pesas"], ["sports_soccer", "deportes fútbol"], ["pets", "mascotas"],
  ["child_care", "bebé niños"], ["school", "escolar"], ["menu_book", "libros"], ["palette", "arte"],
  // Ventas / etiquetas
  ["sell", "oferta etiqueta precio"], ["local_offer", "oferta descuento"], ["percent", "porcentaje descuento"], ["shopping_bag", "bolsa compras"],
  ["shopping_cart", "carrito"], ["redeem", "regalo"], ["card_giftcard", "gift card regalo"], ["star", "estrella destacado"],
  ["favorite", "favorito corazón"], ["local_fire_department", "fuego hot"], ["new_releases", "nuevo novedad"], ["verified", "verificado"],
  ["workspace_premium", "premium medalla"], ["trending_up", "tendencia"], ["inventory_2", "caja inventario"], ["category", "categoría"],
  ["apps", "varios grilla"], ["grid_view", "varios"], ["more_horiz", "otros"], ["auto_awesome", "brillo nuevo"],
];

export default function IconPicker({ value, onChange, fallback = "category" }) {
  const [q, setQ] = useState("");
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const list = useMemo(() => {
    const t = norm(q).trim();
    const seen = new Set();
    return ICON_CHOICES.filter(([name, kw]) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return !t || norm(name).includes(t) || norm(kw).includes(t);
    });
  }, [q]);
  const current = (value || "").trim();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-[#0b1c30] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[#62df7d]" style={{ fontSize: 28 }}>{current || fallback}</span>
        </div>
        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={current}
            onChange={(e) => onChange(e.target.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder={`automático (${fallback})`}
            className="input font-mono text-sm"
          />
          <p className="text-[11px] text-slate-400 mt-1 leading-snug">
            Elegí uno de la lista o escribí el nombre de cualquier ícono de{" "}
            <a href="https://fonts.google.com/icons" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">fonts.google.com/icons</a>.
            Vacío = se elige solo según el nombre de la categoría.
          </p>
        </div>
        {current && (
          <button type="button" onClick={() => onChange("")} className="text-xs text-slate-500 hover:text-red-600 shrink-0">Quitar</button>
        )}
      </div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar: auricular, cable, consola, lámpara..."
        className="input text-sm"
      />
      <div className="grid grid-cols-6 sm:grid-cols-8 gap-1 max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-1.5 bg-slate-50">
        {list.map(([name, kw]) => (
          <button
            key={name}
            type="button"
            title={`${name} · ${kw}`}
            onClick={() => onChange(name)}
            className={`aspect-square rounded-lg flex items-center justify-center transition-colors ${current === name ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-blue-50 hover:text-blue-700 border border-slate-200"}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{name}</span>
          </button>
        ))}
        {list.length === 0 && <p className="col-span-full py-4 text-center text-xs text-slate-400">Nada con ese nombre acá. Probá escribiendo el nombre exacto arriba.</p>}
      </div>
    </div>
  );
}
