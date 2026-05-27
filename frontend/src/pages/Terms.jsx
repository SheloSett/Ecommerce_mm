import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";
import { useSiteConfig } from "../context/SiteConfigContext";

// Renderiza el contenido de una sección: soporta "- ítem" como lista con viñetas
function renderContent(text) {
  const lines = (text || "").split("\n");
  const result = [];
  let listItems = [];
  lines.forEach((line, i) => {
    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
    } else {
      if (listItems.length > 0) {
        result.push(
          <ul key={`list-${i}`} className="list-disc pl-6 mt-2 space-y-1 text-[#565e74]">
            {listItems.map((item, j) => <li key={j}>{item}</li>)}
          </ul>
        );
        listItems = [];
      }
      if (line.trim()) result.push(<p key={`p-${i}`} className="mt-2 text-[#565e74] leading-relaxed">{line}</p>);
    }
  });
  if (listItems.length > 0) {
    result.push(
      <ul key="list-end" className="list-disc pl-6 mt-2 space-y-1 text-[#565e74]">
        {listItems.map((item, j) => <li key={j}>{item}</li>)}
      </ul>
    );
  }
  return result;
}

export default function Terms() {
  // termsContent: viejo enfoque RTE — comentado porque fue reemplazado por secciones estructuradas
  // const { termsContent } = useSiteConfig();
  // if (termsContent) { return <RTE render>; }

  const { termsSections } = useSiteConfig();

  // Secciones hardcodeadas como fallback cuando el admin no configuró contenido propio
  const sections = termsSections || [
    {
      title: "1. Aceptación",
      content: `Al acceder y utilizar el sitio web igwtstore.com.ar, aceptás estos Términos y Condiciones en su totalidad. Si no estás de acuerdo, te pedimos que no utilices el sitio.`,
    },
    {
      title: "2. Productos y precios",
      content: `- Los precios están expresados en pesos argentinos (ARS) e incluyen IVA.\n- Nos reservamos el derecho de modificar precios sin previo aviso.\n- Las imágenes de los productos son ilustrativas y pueden diferir levemente del producto real.\n- El stock es limitado. La disponibilidad se confirma al procesar el pedido.`,
    },
    {
      title: "3. Proceso de compra",
      content: `Al realizar un pedido, recibirás una confirmación por email. Esto no garantiza la disponibilidad del producto hasta que confirmemos el stock y el pago. Nos reservamos el derecho de cancelar pedidos ante errores de precio o falta de stock, en cuyo caso realizaremos el reembolso correspondiente.`,
    },
    {
      title: "4. Métodos de pago",
      content: `- MercadoPago: tarjeta de crédito, débito o dinero en cuenta.\n- Transferencia bancaria: los datos se envían por email tras confirmar el pedido.\n- Efectivo: coordinamos entrega y cobro directamente con el cliente.\n\nPara clientes mayoristas, los precios y condiciones se acuerdan mediante cotización.`,
    },
    {
      title: "5. Envíos y entregas",
      content: `Los plazos y costos de envío se informan al confirmar el pedido. No nos hacemos responsables por demoras causadas por terceros (correos, transportistas). El riesgo de pérdida o daño pasa al comprador una vez entregado el producto al servicio de envío.`,
    },
    {
      title: "6. Devoluciones y garantías",
      content: `Conforme a la Ley 24.240 de Defensa del Consumidor, tenés derecho a arrepentirte de la compra dentro de los 10 días hábiles desde la recepción del producto, siempre que se encuentre en su estado original y sin uso.\n\nLos productos con defectos de fábrica tienen garantía legal. Para iniciar un reclamo, contactanos a info@igwtstore.com.ar.`,
    },
    {
      title: "7. Cuenta de usuario",
      content: `Sos responsable de mantener la confidencialidad de tu contraseña y de todas las actividades realizadas desde tu cuenta. Notificanos de inmediato ante cualquier uso no autorizado.`,
    },
    {
      title: "8. Propiedad intelectual",
      content: `Todo el contenido del sitio (imágenes, textos, logo, diseño) es propiedad de IGWT Store o de sus proveedores y está protegido por las leyes de propiedad intelectual. Queda prohibida su reproducción sin autorización expresa.`,
    },
    {
      title: "9. Jurisdicción",
      content: `Estos términos se rigen por las leyes de la República Argentina. Ante cualquier controversia, las partes se someten a la jurisdicción de los tribunales ordinarios de la Ciudad Autónoma de Buenos Aires.`,
    },
    {
      title: "10. Contacto",
      content: `Para consultas sobre estos términos, escribinos a info@igwtstore.com.ar.`,
    },
  ];

  return (
    // Antes: min-h-screen flex flex-col sin color de fondo — actualizado a token bg-[#f8f9ff]
    // <div className="min-h-screen flex flex-col">
    <div className="ds-page min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta
        title="Términos y Condiciones | IGWT Store"
        description="Leé los términos y condiciones de uso de IGWT Store antes de realizar tu compra."
      />
      <Navbar />

      {/* ── Banda de encabezado ── */}
      <div className="bg-[#0b1c30]">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <nav className="flex items-center gap-2 text-xs text-white/40 mb-4">
            <Link to="/" className="hover:text-white/70 transition-colors">Inicio</Link>
            <span>/</span>
            <span className="text-white/70">Términos y Condiciones</span>
          </nav>
          <div className="flex items-center gap-3 mb-3">
            <span
              className="material-symbols-outlined text-[#62df7d] text-[28px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >gavel</span>
            <span className="text-[#62df7d] text-xs font-semibold uppercase tracking-widest">Legal</span>
          </div>
          {/* Antes: <h1 className="text-3xl font-extrabold text-slate-900 mb-2"> */}
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2" style={{ fontFamily: "Outfit" }}>
            Términos y Condiciones
          </h1>
          {/* Antes: <p className="text-sm text-slate-400 mb-8"> */}
          <p className="text-white/40 text-sm">Última actualización: abril de 2026</p>
        </div>
      </div>

      {/* ── Contenido ── */}
      <main className="flex-1 max-w-3xl mx-auto px-6 py-12 w-full">
        {/* Antes: <div className="prose prose-slate max-w-none space-y-8 text-slate-700"> */}
        <div className="space-y-4">
          {sections.map((s, i) => (
            <section
              key={i}
              className="bg-white rounded-xl border border-[#bdcaba]/30 shadow-[0px_4px_20px_rgba(15,23,42,0.05)] p-6"
            >
              {/* Antes: <h2 className="text-xl font-bold text-slate-800 mb-3"> */}
              <h2 className="text-base font-bold text-[#0b1c30] mb-3 flex items-center gap-2">
                <span className="w-1 h-5 rounded-full bg-[#00873a] flex-shrink-0" />
                {s.title}
              </h2>
              <div className="text-sm leading-relaxed">
                {renderContent(s.content)}
              </div>
            </section>
          ))}
        </div>

        {/* Contacto al pie */}
        <div className="mt-8 bg-[#eff4ff] rounded-xl border border-[#bdcaba]/30 p-5 flex items-start gap-3">
          <span className="material-symbols-outlined text-[#006b2c] text-[20px] mt-0.5">mail</span>
          <div>
            <p className="text-sm font-semibold text-[#0b1c30] mb-1">¿Tenés consultas sobre los términos?</p>
            <p className="text-sm text-[#565e74]">
              Escribinos a{" "}
              {/* Antes: className="text-blue-600 hover:underline" */}
              <a href="mailto:igwtstoresrl@gmail.com" className="text-[#006b2c] hover:underline font-medium">
                igwtstoresrl@gmail.com
              </a>
              . Te respondemos a la brevedad.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
