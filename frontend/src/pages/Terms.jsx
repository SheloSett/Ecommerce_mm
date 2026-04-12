import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import SiteMeta from "../components/SiteMeta";

export default function Terms() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteMeta
        title="Términos y Condiciones | IGWT Store"
        description="Leé los términos y condiciones de uso de IGWT Store antes de realizar tu compra."
      />
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Términos y Condiciones</h1>
        <p className="text-sm text-slate-400 mb-8">Última actualización: abril de 2026</p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700">

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">1. Aceptación</h2>
            <p>
              Al acceder y utilizar el sitio web <strong>igwtstore.com.ar</strong>, aceptás estos
              Términos y Condiciones en su totalidad. Si no estás de acuerdo, te pedimos que no
              utilices el sitio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">2. Productos y precios</h2>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Los precios están expresados en pesos argentinos (ARS) e incluyen IVA.</li>
              <li>Nos reservamos el derecho de modificar precios sin previo aviso.</li>
              <li>Las imágenes de los productos son ilustrativas y pueden diferir levemente del producto real.</li>
              <li>El stock es limitado. La disponibilidad se confirma al procesar el pedido.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">3. Proceso de compra</h2>
            <p>
              Al realizar un pedido, recibirás una confirmación por email. Esto no garantiza la
              disponibilidad del producto hasta que confirmemos el stock y el pago. Nos reservamos
              el derecho de cancelar pedidos ante errores de precio o falta de stock, en cuyo caso
              realizaremos el reembolso correspondiente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">4. Métodos de pago</h2>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>MercadoPago:</strong> tarjeta de crédito, débito o dinero en cuenta.</li>
              <li><strong>Transferencia bancaria:</strong> los datos se envían por email tras confirmar el pedido.</li>
              <li><strong>Efectivo:</strong> coordinamos entrega y cobro directamente con el cliente.</li>
            </ul>
            <p className="mt-2">
              Para clientes mayoristas, los precios y condiciones se acuerdan mediante cotización.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">5. Envíos y entregas</h2>
            <p>
              Los plazos y costos de envío se informan al confirmar el pedido. No nos hacemos
              responsables por demoras causadas por terceros (correos, transportistas). El riesgo
              de pérdida o daño pasa al comprador una vez entregado el producto al servicio de envío.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">6. Devoluciones y garantías</h2>
            <p>
              Conforme a la Ley 24.240 de Defensa del Consumidor, tenés derecho a arrepentirte
              de la compra dentro de los <strong>10 días hábiles</strong> desde la recepción del
              producto, siempre que se encuentre en su estado original y sin uso.
            </p>
            <p className="mt-2">
              Los productos con defectos de fábrica tienen garantía legal. Para iniciar un reclamo,
              contactanos a{" "}
              <a href="mailto:info@igwtstore.com.ar" className="text-blue-600 hover:underline">
                info@igwtstore.com.ar
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">7. Cuenta de usuario</h2>
            <p>
              Sos responsable de mantener la confidencialidad de tu contraseña y de todas las
              actividades realizadas desde tu cuenta. Notificanos de inmediato ante cualquier uso
              no autorizado.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">8. Propiedad intelectual</h2>
            <p>
              Todo el contenido del sitio (imágenes, textos, logo, diseño) es propiedad de
              IGWT Store o de sus proveedores y está protegido por las leyes de propiedad
              intelectual. Queda prohibida su reproducción sin autorización expresa.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">9. Jurisdicción</h2>
            <p>
              Estos términos se rigen por las leyes de la República Argentina. Ante cualquier
              controversia, las partes se someten a la jurisdicción de los tribunales ordinarios
              de la Ciudad Autónoma de Buenos Aires.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">10. Contacto</h2>
            <p>
              Para consultas sobre estos términos, escribinos a{" "}
              <a href="mailto:info@igwtstore.com.ar" className="text-blue-600 hover:underline">
                info@igwtstore.com.ar
              </a>.
            </p>
          </section>

        </div>
      </main>
      <Footer />
    </div>
  );
}
