# Stock central, Mercado Libre y ARCA: lo que falta y las dudas

Actualizado el 11/11/2026. Plan aprobado: [plan.md](plan.md) (copia del plan de esa sesión).
El avance real es el `git log` de cada rama. Las tres ramas están en GitHub desde el 11/11/2026, **sin
desplegar**: el dueño dijo "todavía no" y quiere seguir desde otra computadora, con una guía para probar
y vincular (https://claude.ai/artifact/QR2smbHsBBskC6EPjKfeKC, privada). Estas notas se borran cuando
las tres etapas estén en producción.

## Dónde está cada cosa

| Rama | Carpeta (worktree) | Estado |
|---|---|---|
| `stock-central` (Etapa 0) | `Ecommerce_mm\.claude\worktrees\stock-central` | Terminada, revisada (código y seguridad), probada en el navegador. Esperando el OK para desplegar. |
| `mercadolibre-stock` (Etapa 1) | `Ecommerce_mm\.claude\worktrees\mercadolibre-stock` | Programada y revisada; arreglados los 8 hallazgos. Sale de stock-central. Falta probar contra Mercado Libre de verdad. |
| `facturacion-arca` (Etapa 2) | `Ecommerce_mm\.claude\worktrees\facturacion-arca` | Pasos 2.1 (documento del checkout) y 2.2 (cuentas puras) hechos. Sale de stock-central. |

En otra computadora: `git fetch` y un worktree por rama (`git worktree add .claude/worktrees/<rama> <rama>`),
con `npm ci` en `backend` y `frontend`.

Pruebas: `npm test` desde `backend` y desde `frontend`, también con Node 22 (es la versión del build de
Docker: un test puede pasar con Node 24 y frenar el deploy). Además se probó a mano, fuera de `npm test`:
50 ventas simultáneas y transacciones cruzadas contra un Postgres de verdad, el motor de Mercado Libre
completo contra un Postgres de verdad con un Mercado Libre simulado (`backend/test/helpers/fakeMl.js`), y
las pantallas en Edge. Esos scripts quedaron en la computadora donde se hicieron.

## Lo que falta

### Etapa 0 (stock central)
- [ ] OK del dueño para mergear a main y desplegar. Antes del rebuild: `migracion-stock-movimientos.sql` (ver DEPLOY.md). Black Friday es el 27/11: si sale, que sea con varios días de margen.
- [ ] Después del deploy: mirar el historial de stock de un producto con ventas reales y que el panel no avise "falta la tabla".
- [ ] En `auditoria-igwt-pendientes.md`, marcar M14 como hecho cuando se despliegue.
- [ ] Queda como estaba (anotado en AVANCES 198): cambiar el VALOR de un atributo (Rojo → Bordó) recrea la variante con stock 0. Arreglo posible: acción "renombrar valor" en el editor de variantes.

### Etapa 1 (Mercado Libre)
Trámites del dueño (te guío cuando lo pida):
- [ ] Crear la aplicación NUEVA de la tienda en developers.mercadolibre.com.ar (no la del publicador). Dirección de vuelta: `https://igwtstore.com.ar/admin/mercadolibre/conectar`. Avisos: `https://igwtstore.com.ar/api/ml/webhook/<ML_WEBHOOK_TOKEN>`, tópico `items` (y `stock_locations` si lo ofrece). Permisos: lectura, escritura, acceso sin conexión. PKCE activado.
- [ ] Una publicación de prueba barata y pausada.
Servidor:
- [ ] Variables en `backend/.env` del VPS: `SECRETS_KEY` (guardarla también fuera del VPS), `ML_SYNC_ENABLED=1`, `ML_APP_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_WEBHOOK_TOKEN`, `ML_EXPECTED_USER_ID` (el de IGWTSTORE: 419831750, sale de `igwt-publicador-ml/equipo/gateway.py`).
- [ ] Deploy (necesita la Etapa 0 en producción) + `migracion-mercadolibre.sql` antes del rebuild.
Puesta en marcha (DEPLOY.md, "Mercado Libre: stock compartido"):
- [ ] Conectar → Traer publicaciones → Vincular (no cambia nada) → modo **Observar** varios días → **Activo** con la publicación de prueba → un producto real de poco movimiento → el resto.
Código que quedó para después:
- [ ] Variaciones del modelo viejo: hoy se observan pero no se activan ni se escriben (un PUT con `variations` borra las que no van en la lista). Habilitar mandando TODOS los ids y probándolo con una publicación de prueba con variaciones. Ver primero si quedan publicaciones así.
- [ ] Avisar en el editor de variantes antes de regenerar las de un producto vinculado (hoy el motor lo detecta después: vínculo ROTO, nunca manda 0).
- [ ] Etiqueta "ML" en Productos para los vinculados.
- [ ] Si en Observar se ve que los vendidos suben tarde (al pagarse), llevar la cuenta de las "bajas sin venta" para no descontar dos veces cuando hay una escritura en el medio (o el libro de órdenes del plan, `ml_orders`).
- [ ] Ajustar `settleMs` (20 s), `staleMs` (2 min) y `maxWaitMs` (5 min) con lo que muestre la bitácora (`services/ml/mlRules.js`, DEFAULTS).

### Etapa 2 (ARCA)
- [ ] 2.3 Acceso a ARCA (WSAA con node-forge, transporte con ECDHE, configuración) en homologación. `secretBox` ya está en la rama.
- [ ] 2.4 Emisión y reconciliación · 2.5 PDF con QR y mail · 2.6 bloqueo del pedido facturado (`orders.arcaLockedAt` ya está en la migración) · 2.7 nota de crédito · 2.8 producción.
- [ ] Trámites del dueño: WSASS (homologación) con la clave fiscal de UNA PERSONA; punto de venta NUEVO para web services; certificado de producción; datos (CUIT y razón social exactos, nombre de fantasía, domicilio, IIBB, inicio de actividades, CUIT de quien prueba).
- [ ] El arreglo del documento en el checkout (rama facturacion-arca, commit "el documento del cliente ya no se pierde") podría salir antes, solo, con `migracion-arca.sql` (hoy solo agrega 3 columnas a orders).

### Etiquetas de la moto
- [ ] Falta el nombre o la página de la mensajería, y si tiene API o carga masiva (Excel). Imprimen en térmica 10x15. Ver el final del plan.

## Dudas

Mercado Libre (comprobar en Observar o con la publicación de prueba antes de Activo):
- ¿`sold_quantity` es exacto con el token del vendedor y se mueve junto con el stock? ¿Cuándo sube: al crear la orden o al pagarse? (Todo el cierre de cuentas después de escribir depende de esto.)
- ¿La respuesta del PUT trae el número nuevo? (Si no, cada escritura queda "sin confirmar" hasta la lectura siguiente: anda, pero más lento.)
- ¿Cuánto tarda Mercado Libre en mostrar el número escrito? ¿Puede dar una lectura vieja más de 2 minutos?
- ¿Mercado Libre deja crear una segunda aplicación para la misma cuenta? ¿Tiene PKCE?
- ¿Llegan los avisos pasando por Cloudflare? Si no, usar `igwtstore.82-25-74-242.sslip.io`.
- ¿Qué hace el stock de Mercado Libre cuando se cancela una venta (antes y después del despacho)?
- ¿Con stock 0 se pausa sola y con más de 0 se reactiva sola?
- ¿Las dos aplicaciones (tienda y publicador) comparten el límite de pedidos? (La documentación dice que el límite es por aplicación.)
- ¿Quedan publicaciones con variaciones del modelo viejo?

ARCA (para el contador):
- Envío: ¿IVA 21 %, prorrateado o no gravado? (El código asume 21 % contenido, configurable.)
- Ítems cargados a mano sin producto: ¿21 %? (Asumido.)
- ¿Habilitados para factura A común? ¿Clientes con factura de crédito MiPyME? ¿Son agentes de percepción? (Asumido que no.)
- Tope para facturar a consumidor final sin documento (el código usa $10.000.000, de fuentes secundarias).
- Un mayorista que pagó sin pedir factura y después la pide: ¿mismo total con el IVA adentro?
- Sin verificar en el manual: si ARCA redondea base × alícuota antes de comparar con el IVA; la forma real de las respuestas FEParamGet; el código 602 en FECompConsultar.

Del dueño:
- ¿Cuándo sale la Etapa 0? (Dijo "todavía no" el 11/11.)
- ¿Sale antes, solo, el arreglo del documento del checkout?
