import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";

export default function Privacy() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteMeta
        title="Política de Privacidad | IGWT Store"
        description="Conocé cómo IGWT Store recopila, usa y protege tus datos personales."
      />
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Política de Privacidad</h1>
        <p className="text-sm text-slate-400 mb-8">Última actualización: abril de 2026</p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700">

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">1. Responsable del tratamiento</h2>
            <p>
              IGWT Store, con dominio <strong>igwtstore.com.ar</strong>, es responsable del tratamiento
              de los datos personales recopilados a través de este sitio web, en cumplimiento de la
              Ley N° 25.326 de Protección de Datos Personales de la República Argentina y su decreto
              reglamentario.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">2. Datos que recopilamos</h2>
            <p>Al registrarte o realizar una compra, podemos recopilar los siguientes datos:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Nombre completo</li>
              <li>Dirección de correo electrónico</li>
              <li>Número de teléfono</li>
              <li>CUIT / CUIL</li>
              <li>Empresa u organización (opcional)</li>
              <li>Historial de pedidos y cotizaciones</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">3. Finalidad del tratamiento</h2>
            <p>Utilizamos tus datos para:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Procesar tus pedidos y cotizaciones</li>
              <li>Enviarte confirmaciones y novedades sobre tu compra</li>
              <li>Gestionar tu cuenta de cliente</li>
              <li>Mejorar nuestros productos y servicios</li>
              <li>Cumplir con obligaciones legales y fiscales</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">4. Compartición de datos</h2>
            <p>
              No vendemos ni cedemos tus datos personales a terceros. Solo los compartimos con
              proveedores de servicios necesarios para operar el sitio (como MercadoPago para el
              procesamiento de pagos), quienes están obligados a tratar tus datos con la misma
              confidencialidad.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">5. Seguridad</h2>
            <p>
              Implementamos medidas técnicas y organizativas para proteger tus datos contra acceso
              no autorizado, pérdida o alteración. Las contraseñas se almacenan cifradas y nunca
              en texto plano.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">6. Tus derechos</h2>
            <p>
              En virtud de la Ley 25.326, tenés derecho a acceder, rectificar, actualizar y suprimir
              tus datos personales en cualquier momento. Para ejercer estos derechos, contactanos a:
            </p>
            <p className="mt-2">
              <a href="mailto:info@igwtstore.com.ar" className="text-blue-600 hover:underline">
                info@igwtstore.com.ar
              </a>
            </p>
            <p className="mt-2 text-sm text-slate-500">
              La DIRECCIÓN NACIONAL DE PROTECCIÓN DE DATOS PERSONALES, órgano de control de la
              Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que se
              interpongan con relación al incumplimiento de las normas sobre protección de datos personales.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">7. Cookies</h2>
            <p>
              Este sitio utiliza el almacenamiento local del navegador (localStorage) para recordar
              tu preferencia de tema (claro/oscuro) y mantener tu sesión activa. No utilizamos
              cookies de rastreo de terceros ni publicidad.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">8. Cambios en esta política</h2>
            <p>
              Podemos actualizar esta política en cualquier momento. Te notificaremos por email si
              los cambios son significativos. El uso continuado del sitio implica aceptación de
              la política vigente.
            </p>
          </section>

        </div>
      </main>
      <Footer />
    </div>
  );
}
