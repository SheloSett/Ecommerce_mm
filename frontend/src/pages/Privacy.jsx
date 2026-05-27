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
          // Antes: list-disc text heredado — actualizado a tokens del sistema de diseño
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

export default function Privacy() {
  // privacyContent: viejo enfoque RTE — comentado porque fue reemplazado por secciones estructuradas
  // const { privacyContent } = useSiteConfig();
  // if (privacyContent) { return <RTE render>; }

  const { privacySections } = useSiteConfig();

  // Secciones hardcodeadas como fallback cuando el admin no configuró contenido propio
  const sections = privacySections || [
    {
      title: "1. Responsable del tratamiento",
      content: `IGWT Store, con dominio igwtstore.com.ar, es responsable del tratamiento de los datos personales recopilados a través de este sitio web, en cumplimiento de la Ley N° 25.326 de Protección de Datos Personales de la República Argentina y su decreto reglamentario.`,
    },
    {
      title: "2. Datos que recopilamos",
      content: `Al registrarte o realizar una compra, podemos recopilar los siguientes datos:\n- Nombre completo\n- Dirección de correo electrónico\n- Número de teléfono\n- CUIT / CUIL\n- Empresa u organización (opcional)\n- Historial de pedidos y cotizaciones`,
    },
    {
      title: "3. Finalidad del tratamiento",
      content: `Utilizamos tus datos para:\n- Procesar tus pedidos y cotizaciones\n- Enviarte confirmaciones y novedades sobre tu compra\n- Gestionar tu cuenta de cliente\n- Mejorar nuestros productos y servicios\n- Cumplir con obligaciones legales y fiscales`,
    },
    {
      title: "4. Compartición de datos",
      content: `No vendemos ni cedemos tus datos personales a terceros. Solo los compartimos con proveedores de servicios necesarios para operar el sitio (como MercadoPago para el procesamiento de pagos), quienes están obligados a tratar tus datos con la misma confidencialidad.`,
    },
    {
      title: "5. Seguridad",
      content: `Implementamos medidas técnicas y organizativas para proteger tus datos contra acceso no autorizado, pérdida o alteración. Las contraseñas se almacenan cifradas y nunca en texto plano.`,
    },
    {
      title: "6. Tus derechos",
      content: `En virtud de la Ley 25.326, tenés derecho a acceder, rectificar, actualizar y suprimir tus datos personales en cualquier momento. Para ejercer estos derechos, contactanos a: info@igwtstore.com.ar\n\nLa DIRECCIÓN NACIONAL DE PROTECCIÓN DE DATOS PERSONALES, órgano de control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales.`,
    },
    {
      title: "7. Cookies",
      content: `Este sitio utiliza el almacenamiento local del navegador (localStorage) para recordar tu preferencia de tema (claro/oscuro) y mantener tu sesión activa. No utilizamos cookies de rastreo de terceros ni publicidad.`,
    },
    {
      title: "8. Cambios en esta política",
      content: `Podemos actualizar esta política en cualquier momento. Te notificaremos por email si los cambios son significativos. El uso continuado del sitio implica aceptación de la política vigente.`,
    },
  ];

  return (
    // Antes: min-h-screen flex flex-col sin color de fondo — actualizado a token bg-[#f8f9ff]
    // <div className="min-h-screen flex flex-col">
    <div className="ds-page min-h-screen flex flex-col bg-[#f8f9ff]">
      <SiteMeta
        title="Política de Privacidad | IGWT Store"
        description="Conocé cómo IGWT Store recopila, usa y protege tus datos personales."
      />
      <Navbar />

      {/* ── Banda de encabezado — antes no existía, era un h1 directo en el main ── */}
      <div className="bg-[#0b1c30]">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <nav className="flex items-center gap-2 text-xs text-white/40 mb-4">
            <Link to="/" className="hover:text-white/70 transition-colors">Inicio</Link>
            <span>/</span>
            <span className="text-white/70">Política de Privacidad</span>
          </nav>
          <div className="flex items-center gap-3 mb-3">
            <span
              className="material-symbols-outlined text-[#62df7d] text-[28px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >shield</span>
            <span className="text-[#62df7d] text-xs font-semibold uppercase tracking-widest">Legal</span>
          </div>
          {/* Antes: <h1 className="text-3xl font-extrabold text-slate-900 mb-2"> */}
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2" style={{ fontFamily: "Outfit" }}>
            Política de Privacidad
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
            <p className="text-sm font-semibold text-[#0b1c30] mb-1">¿Tenés preguntas sobre tu privacidad?</p>
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
