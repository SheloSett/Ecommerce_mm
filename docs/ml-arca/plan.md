# Stock compartido con Mercado Libre y facturación ARCA

## Resumen (con esto alcanza)

- Todo se hace en ramas aparte de `main`, una por etapa, y en una carpeta de trabajo separada para no mover de rama a las otras sesiones abiertas en este repo. Nada llega a `main` ni a producción sin que el dueño lo pruebe y lo apruebe.
- **Etapa 0:** el stock pasa por un solo lugar y queda con historial. Arregla además que el panel pise el stock al guardar un producto.
- **Etapa 1:** Mercado Libre y la página comparten stock; se puede cargar en cualquiera de los dos.
- **Etapa 2:** botón "Facturar" (A o B) y "Anular factura", directo contra ARCA.
- **Seguridad:** claves y tokens cifrados y fuera del repo, la clave que firma las facturas nunca sale del servidor, y una revisión de seguridad antes de mergear cada rama.
- Se empieza por la Etapa 0, que no necesita nada de afuera. Las etapas 1 y 2 necesitan los trámites de "Lo que tienen que hacer ustedes".

## Contexto

Hoy el stock se carga dos veces: en la página y en Mercado Libre. Cada venta en un lado obliga a descontar a mano en el otro. Las facturas se hacen entrando a ARCA aparte. La idea es que la página sea el centro: que el stock se comparta solo con Mercado Libre y que desde el panel se pueda facturar un pedido con un botón, cuando ellos quieran.

Lo que encontré en el código y condiciona el plan:

- El stock se modifica desde unos 20 lugares distintos, casi todos leyendo el número y escribiéndolo de nuevo, sin historial. Si dos cosas pasan a la vez, una pisa a la otra. Con Mercado Libre descontando en paralelo eso pasaría seguido, así que primero hay que ordenar el stock en un solo lugar (era el pendiente M14 de la auditoría).
- Los formularios del panel mandan siempre el stock que tenían al abrirse: guardar una descripción puede deshacer una venta que entró mientras tanto.
- No hay nada de Mercado Libre ni de ARCA en el código.
- El checkout pide el documento del cliente pero no lo manda al servidor: hoy se pierde.
- El repo es público y `GET /api/settings` también: ningún token, clave o certificado puede ir al repo ni a `site_config`. No existe todavía un utilitario de cifrado.
- El proyecto `igwt-publicador-ml` ya está conectado a la misma cuenta de Mercado Libre y también le cambia el stock.

## Decisiones tomadas con el dueño

| Tema | Decisión |
|---|---|
| Mercado Libre | Una sola cuenta (IGWTSTORE). No usan Full. |
| Acceso a Mercado Libre | Aplicación nueva solo para la tienda, separada de la del publicador. |
| Dónde se carga el stock | En cualquiera de los dos lados. |
| Vínculo producto y publicación | A mano desde el panel (el SKU no es único), con sugerencias. |
| Promociones de la web | No tocan Mercado Libre: se comparte el stock, no el precio. |
| ARCA | Un solo CUIT responsable inscripto: facturas A y B (la C es de monotributistas, no aplica). |
| Qué se factura | Cualquier pedido en pesos, haya entrado por la web o lo hayan cargado a mano en el panel. Nunca automático: lo decide quien aprieta el botón. |
| Moneda | Solo pesos. Un pedido con productos en dólares no se factura desde el panel. |
| Notas de crédito | Sí, desde el panel, para anular una factura. |
| Cuándo sale | Apenas esté bien probado, por etapas. Sin fecha fija. |

## Orden de trabajo y ramas

Tres etapas. Cada una va en su rama, se prueba, se mergea a `main` y se despliega por separado.

| Etapa | Rama | Qué entrega | Depende de |
|---|---|---|---|
| 0 | `stock-central` | Todo cambio de stock pasa por un solo módulo, sin pisadas y con historial | Nada |
| 1 | `mercadolibre-stock` | Cuenta conectada, productos vinculados, stock compartido | Pasos 0.0 a 0.3 en producción |
| 2 | `facturacion-arca` | Botón Facturar (A o B), PDF con QR, nota de crédito | Nada: puede avanzar en paralelo |

Los trámites (aplicación de Mercado Libre, certificado y punto de venta de ARCA, consultas al contador) conviene arrancarlos ya: son lo que más demora y no dependen del código. Están en "Lo que tienen que hacer ustedes".

Reglas que valen para las tres etapas:

- Cambios de base: `backend/prisma/schema.prisma` + un `backend/scripts/migracion-<tema>.sql` aditivo e idempotente, que se corre a mano **antes** del deploy con `docker exec -i igwtstore_db psql ... --single-transaction -v ON_ERROR_STOP=1` (ver el inicio de `DEPLOY.md`). Después, `prisma migrate diff` tiene que dar vacío.
- Tests con `node:test` y base simulada, como `backend/test/payments.test.js`. Corren dentro del build de Docker con Node 22: se prueban también con Node 22 antes de subir, con el reloj inyectado y sin tiempos fijos.
- Nada secreto en el repo ni en `site_config`. Tokens y claves van en tablas propias, cifrados con un utilitario nuevo `backend/src/utils/secretBox.js` (AES-256-GCM, cada dato atado a su casillero, clave `SECRETS_KEY` solo en `backend/.env` del VPS). Las credenciales de las aplicaciones van en `backend/.env`.
- Llamadas externas con timeout, funciones que no lanzan y devuelven `{ ok | error }`, y avisos con `reportError` (`backend/src/services/errorAlerts.service.js`), igual que `backend/src/services/meta.service.js`.
- Rutas nuevas con `authMiddleware, adminMiddleware` y el control de permiso en la misma línea (lo exige `backend/test/adminPermissions.test.js`).
- Al cerrar cada paso desplegable: entrada en `AVANCES.md` y, si hay migración o variables nuevas, en `DEPLOY.md`.
- Cada rama se trabaja en un worktree de git aparte (con su `npm ci`), no en la carpeta principal: hay otras sesiones abiertas en este repo y cambiar de rama ahí las movería a todas. Los commits quedan locales; subir a GitHub y desplegar se hace cuando el dueño lo pide.

## Seguridad

Punto de partida: la auditoría de octubre no dejó pendientes de seguridad; lo único abierto era el orden del stock, que es la Etapa 0. Lo nuevo abre tres puertas que hay que cuidar: un aviso público de Mercado Libre, los tokens de una cuenta con ventas reales y una clave que firma facturas.

- **Secretos:** las credenciales de las aplicaciones y `SECRETS_KEY` viven solo en `backend/.env` del VPS. Tokens de Mercado Libre, clave privada y ticket de ARCA van cifrados en tablas propias, ningún endpoint los devuelve (con un test que lo comprueba) y nada de esto toca `site_config`, que es pública.
- **Clave de ARCA:** se genera en el servidor y no sale nunca, ni por mail ni por un formulario. Lo que se sube y se baja de ARCA (pedido y certificado) es público.
- **Aviso público de Mercado Libre:** la dirección lleva una clave comparada en tiempo constante; sin ella responde 404 sin tocar la base. Límite propio de pedidos y de tamaño, lista cerrada de tópicos, usuario verificado, y nunca se confía en el contenido: el dato se vuelve a pedir a la API.
- **Llamadas salientes:** solo a direcciones fijas (la API de Mercado Libre y los servidores de ARCA). Lo que llega en un aviso se valida contra un patrón y nunca se usa como dirección.
- **Conectar la cuenta y la configuración fiscal:** solo superadministrador. La conexión usa un `state` de un solo uso atado a la sesión y PKCE si la aplicación lo admite, y verifica que la cuenta conectada sea IGWTSTORE (`ML_EXPECTED_USER_ID`).
- **Texto que viene de clientes:** todo lo que entra a un sobre XML de ARCA o a un PDF se escapa. El lector de respuestas rechaza `DOCTYPE` y tiene tope de tamaño. La conexión con ARCA nunca desactiva la verificación del certificado.
- **Permisos:** rutas nuevas con el permiso en la misma línea. Quién hizo cada movimiento de stock o cada factura sale de la sesión, no de lo que manda el navegador. El PDF se baja con el encabezado de autorización, no con el token en la dirección.
- **Datos personales:** el documento del cliente se ve solo en el panel y en la cuenta del propio cliente; ninguna respuesta pública trae los campos nuevos. No se guardan datos de compradores de Mercado Libre. Lo que se guarda del intercambio con ARCA va sin token ni firma.
- **Registros y alertas:** nunca tokens, claves ni encabezados de autorización en los logs ni en los mails de `reportError`.
- **Repo público:** las respuestas grabadas para tests llevan los datos reemplazados. Ningún commit ni `AVANCES.md` describe un problema sin arreglar; eso va en el archivo privado `C:\Users\2\Desktop\workspace\igwt\auditoria-igwt-pendientes.md`.
- **Dependencias nuevas:** solo `node-forge` y `qrcode-generator`, con versión fija y `npm audit` revisado.
- **Antes de mergear cada rama:** `/security-review` y `/code-review` sobre la rama, corregir lo que salga, y recién entonces mergear. Después de subir, desplegar enseguida.

## Etapa 0: el stock en un solo lugar

**Qué cambia para el dueño:** un botón "Historial de stock" en cada producto, que muestra cada movimiento con su motivo, y que guardar un producto ya no pisa el stock si no se lo tocó.

### Diseño

- `backend/src/services/stock.service.js` (nuevo), única puerta para escribir stock:
  - `adjustStock({ productId, variantId, delta | setTo, reason, ref, actor, tx, respectUnlimited, clampAtZero, visibility })` devuelve `{ ok, before, after, applied, shortfall, movementId }` o `{ ok: false, skipped }`.
  - Dentro de una transacción: toma el candado de la fila (`update` con `increment: 0`), calcula el resultado con el mismo `Math.max(0, …)` de hoy, escribe, inserta el movimiento y corre la publicación automática si corresponde. Se hace con operaciones de Prisma y no con SQL crudo, porque las bases simuladas de los tests no ejecutan SQL.
  - Si el llamador ya está en una transacción tiene que pasar `tx`; si no, el servicio abre otra y se traba contra la de afuera.
  - Las opciones `respectUnlimited` y `visibility` existen para no cambiar comportamiento: hoy las compras no respetan el ilimitado ni republican, y el formulario completo de producto no toca la publicación.
  - `syncProductVisibility` se muda acá desde `backend/src/controllers/product.controller.js:1565` (el controller la sigue exportando, para no cerrar un import circular con `order.controller.js`).
  - `onCommitted(fn)`: aviso después de cada cambio confirmado. En la Etapa 1 despierta al trabajador de Mercado Libre.
- Tabla `stock_movements`: producto, variante, lo que se pidió, delta aplicado, antes, después, motivo (`VENTA_WEB`, `VENTA_MANUAL`, `CANCELACION`, `EDICION_PEDIDO`, `AJUSTE_PANEL`, `COMPRA`, `RMA`, y en la Etapa 1 `VENTA_ML`, `CAMBIO_ML`, `VINCULO_ML`), referencia, quién y fecha. Sin clave foránea al producto: el historial sobrevive a un borrado.
- `GET /api/products/:id/stock-movements` (permiso `productos`) y `frontend/src/components/admin/StockHistoryModal.jsx`, que se abre desde `AdminProducts.jsx`.
- **Formularios del panel:** los cuatro editores (`AdminProducts.jsx:628`, `918`, `973` y `ProductVariantsEditor.jsx:300`) pasan a mandar `stock` solo si se cambió, junto con `stockBase` (el número que mostraban). El backend aplica la diferencia y avisa si el resultado no es el que se tipeó.

### Pasos

Cada paso es un commit desplegable. La regla es no cambiar el comportamiento de cada lugar (quién despublica, quién republica, el piso en 0): solo pasa a ser atómico y a dejar registro.

| Paso | Qué sale |
|---|---|
| 0.0 | Ayudante de tests `backend/test/helpers/fakeStock.js` y tests que fijan el comportamiento actual (RMA, variante, generar variantes, venta manual, Mercado Pago con variante). No toca `src`. |
| 0.1 | Tabla, servicio con sus tests e historial en el panel. Nadie lo llama todavía. |
| 0.2 | Carga a mano y RMA: `createProduct`, `updateProduct`, `quickUpdateProduct` (`product.controller.js`), `PUT /api/variants/:id` (`variant.routes.js:248`), `gasto.routes.js:61-82`, y los cuatro formularios con `stockBase`. |
| 0.3 | Aprobación y cancelación: `applyMpApproval` (`payment.controller.js:305-363`), `updateOrderStatus` (`order.controller.js:844-997`; el recorte de otros pedidos queda igual y usa el `after`), `cancelByCustomer` (`2402-2458`). En commit aparte, reclamo atómico contra el doble clic en "Abonado", igual que `claimApproval`. |
| 0.4 | Edición de pedidos: `updateOrderItem`, `deleteOrderItem`, `addItemToOrder`, `modifyOrder` (`3204-3418`). |
| 0.5 | Los que ya usan transacción: `createManualOrder` (`2964-3036`) y `updateMyQuoteItems` (`2311-2348`), pasando `tx`. |
| 0.6 | Compras: `applyItemTx`, `moveStockTx`, `revertItemTx` (`purchase.controller.js:26-211`), con el costo promedio calculado desde `before`. |
| 0.7 | Generar y borrar variantes, `deleteProduct`, y un test centinela que falla si aparece una escritura de stock fuera del servicio. |

Para encender Mercado Libre alcanzan los pasos 0.0 a 0.3. Los demás pueden salir después, porque la Etapa 1 detecta los cambios comparando números y no depende de que cada lugar avise.

Arreglos deliberados, cada uno en su commit y con su test: una variante pagada por Mercado Pago o dada de baja por RMA despublica el producto si era la última con stock; la venta manual ya no deja stock negativo (`order.controller.js:2994`); `cancelByCustomer` respeta lo despublicado a mano.

Queda como está y se anota: borrar un pedido o un RMA no devuelve stock (el historial lo deja a la vista), y una compra no republica sola el producto.

### Verificación

- `backend/test/stock.test.js`: delta, piso en 0 con faltante, carga de un número, ilimitado, variante de otro producto, publicación automática, con y sin transacción ajena, dos ajustes a la vez.
- Los tests que tocan stock (`checkout`, `orderStatus`, `payments`, `purchases`, `productVisibility`) en verde con Node 24 y Node 22.
- Contra un Postgres temporal, fuera de `npm test`: 50 descuentos simultáneos de 1 sobre un stock de 30 terminan en 0 con 30 aplicados.
- En local: abrir un producto en dos pestañas, cambiar el stock en una y guardar la descripción en la otra; el stock no vuelve atrás. Aprobar, cancelar y editar un pedido y cargar una compra; el historial explica cada cambio.

## Etapa 1: stock compartido con Mercado Libre

**Qué cambia para el dueño:** en Configuración aparece "Mercado Libre" para conectar la cuenta, y en Productos una pantalla "Mercado Libre" con las publicaciones, cada una vinculada (o no) a un producto de la página. Los vinculados comparten stock.

### Regla de sincronización

Las publicaciones que comparten `user_product_id` forman un **pozo**: Mercado Libre ya las mantiene iguales entre sí, así que cuentan como un solo stock. Por cada pozo vinculado se guarda el **último número en que los dos lados coincidieron**. Cada vez que algo cambia (aviso de Mercado Libre, cambio en la página o el barrido periódico):

1. Se lee el stock del pozo. La diferencia con el último número acordado es lo que cambió en Mercado Libre (una venta, una cancelación o una carga a mano).
2. En una sola transacción: esa diferencia se aplica a la página como un movimiento, el número acordado pasa a ser el leído, y se anota el número que hay que escribir si la página quedó distinta.
3. Se vuelve a leer justo antes de escribir. Si cambió, se empieza de nuevo; si ya coincide, no se escribe.
4. Se escribe en Mercado Libre y, con la respuesta, el número acordado pasa a ser el escrito.

| Qué pasó | Mercado Libre | Página | Resultado |
|---|---|---|---|
| Venta en Mercado Libre | de 10 a 9 | 10 | Los dos en 9 |
| Venta en la página | 10 | de 10 a 9 | Los dos en 9 |
| Carga a mano en Mercado Libre | de 10 a 15 | 10 | Los dos en 15 |
| Una venta en cada lado a la vez | de 10 a 9 | de 10 a 9 | Los dos en 8 |

Así no hace falta distinguir una venta de una carga a mano ni interpretar los estados de las órdenes: la página copia lo que Mercado Libre hizo con su número.

**Una regla de uso para el dueño:** cada cambio se carga en un solo lado. Si entran 5 unidades y se suman en la página y también en Mercado Libre, el stock sube 10.

### Convivencia con el publicador

El proyecto `igwt-publicador-ml` corre en el mismo VPS y cambia stock en Mercado Libre. Dos consecuencias:

- **La tienda usa su propia aplicación de Mercado Libre.** El refresh token es de un solo uso por aplicación: si los dos renovaran el mismo, uno dejaría sin acceso al otro (el publicador ya lo tiene anotado en `ml.py`). Mercado Libre pide desde este año "una aplicación por unidad de negocio" y no encontré escrito si deja crear una segunda: se comprueba al crearla. Por eso `mlClient.js` recibe el token de un proveedor intercambiable. Si no se pudiera crear, el plan B es que la tienda le pida el token al publicador por la red interna del VPS (los dos contenedores están en la red `edge`) y que los avisos de la aplicación apunten a la tienda; eso obliga a tocar el otro proyecto y se decide en ese momento.
- **Lo que el publicador cargue en Mercado Libre, la página lo copia.** Para la tienda es un cambio hecho en Mercado Libre como cualquier otro. Las publicaciones nuevas que cree el publicador aparecen en la pantalla de vínculos como "sin vincular".

El publicador crea las publicaciones con `family_name`, así que la cuenta ya trabaja con `user_product_id` y cada color es una publicación aparte.

### Protecciones

- **Un solo trabajador, de a una unidad por vez**, dentro del backend, con todos los pozos de esa unidad en la misma transacción. La cola vive en la base (marcas en las filas), así que un reinicio no pierde nada.
- **Escritura de resultado desconocido** (el backend se cae en el medio o la llamada no contesta): como el número a escribir quedó anotado antes, al volver se compara lo que muestra Mercado Libre con las ventas que hubo desde entonces y se sabe si la escritura entró. Si las cuentas no cierran, se toma el número más bajo, el pozo queda en `REVISAR` y se avisa.
- **Venta en Mercado Libre justo mientras se escribe:** se usa el endpoint de stock con control de versión (`/user-products/{id}/stock` con `x-version`) si la cuenta lo permite: una escritura sobre un número viejo se rechaza y se reintenta. Si no lo permite (probable sin Full), se usa `PUT /items/{id}`, que pisa. Para ese caso se guarda cada escritura con sus horas y sus números, y se lleva un libro de órdenes (`orders_v2`): una venta que cae en esa ventana, que la lectura anterior no incluía y por la que la siguiente no bajó, se descuenta una sola vez con su número de orden. Si las cuentas no cierran, `REVISAR`. Fuera de esa ventana el libro solo sirve para ponerle número de orden a cada movimiento: nunca toca el stock.
- **Guardas sobre lo leído:** solo se toman lecturas de publicaciones propias en estado activo o pausado. Un cambio grande que ninguna orden explica se aplica recién si otra pasada lo confirma. Una lectura igual al número anterior a la última escritura, apenas después de ella, se descarta por vieja.
- **Si la agrupación de un pozo cambia** (una publicación cambia de `user_product_id`), esa unidad se frena y se avisa.
- **Mercado Libre guarda otro número que el enviado** (tope de la publicación, publicación en revisión, o responde bien sin aplicar): se compara con la respuesta y el pozo queda en error con el motivo, en vez de reintentar sin fin.
- **Avisos perdidos:** los avisos son solo un despertador. En cada pasada se revisa lo marcado, se compara el número acordado contra el stock de la página (eso detecta cualquier cambio que no haya pasado por el módulo central) y se relee un lote de pozos, de modo que todos se revisen cada 20 a 30 minutos.
- **Límite de pedidos:** el publicador ya vio que la lectura en lote falla de a ratos y que las ráfagas reciben 429. Se lee de a una publicación, pocas por pasada, y ante un 429 se frena toda la cuenta hasta una hora guardada.
- **Token:** se renueva solo antes de vencer, de a una renovación por vez, y el nuevo se guarda antes de usarlo. Si Mercado Libre lo revoca, el panel muestra "Reconectar" y llega un aviso por mail.
- **Sobreventa** (los dos lados vendieron la última unidad): el stock queda en 0 y llega un aviso con el producto y las ventas.
- **Vínculo roto:** si el producto o la variante de la página ya no existe (por ejemplo, al regenerar variantes cambian los identificadores), el vínculo pasa a `ROTO` y nunca se manda un 0. El panel avisa antes de regenerar variantes de un producto vinculado.
- **Producto con stock ilimitado:** se puede vincular, pero no se sincroniza mientras siga ilimitado.
- **Copia de la base en otra máquina:** restaurar un backup y arrancar el backend sincronizaría contra la cuenta real y dejaría sin token a producción. Por eso el motor solo corre con `ML_SYNC_ENABLED=1` en `backend/.env`, además del interruptor del panel.
- **Tres modos de la cuenta:** `APAGADO`, `OBSERVAR` (lee y registra lo que haría, sin escribir en ningún lado) y `ACTIVO`. Además cada vínculo se activa por separado.
- **Los problemas se ven en el panel**, no solo por mail: `reportError` corta a los 20 mails por hora.
- Una venta de Mercado Libre no recorta pedidos web pendientes, y no se guardan datos de los compradores.

### Datos nuevos

- `ml_account` (una sola fila): usuario de Mercado Libre, tokens cifrados, vencimiento, estado, modo, freno por límite de pedidos, y fechas del último aviso recibido y de la última renovación.
- `ml_pools` (un pozo): clave (`user_product_id`, o publicación y variación si no tiene), producto y variante vinculados (sin clave foránea), si está activo, último número acordado, número pendiente de escribir, cambio grande a confirmar, estado (`OK`, `ERROR`, `REVISAR`, `ROTO`, `CERRADO`), intentos, próximo intento y último error. Un pozo se vincula a una sola unidad de la página; una unidad puede tener varios pozos.
- `ml_listings` (una fila por publicación o variación, vinculada o no): identificadores, pozo, título, SKU, enlace, miniatura, estado, stock y vendidos vistos en Mercado Libre.
- `ml_cycles`: cada escritura con la hora y el número de la lectura, la hora y el número escrito, lo que respondió Mercado Libre y el resultado. En modo observar guarda lo que habría hecho.
- `ml_orders` y `ml_order_lines`: órdenes vistas y sus líneas, sin datos del comprador, para ponerle número de orden a los movimientos y recuperar ventas pisadas.

### Backend

- `backend/src/services/ml/mlClient.js`: llamadas a la API, proveedor de token intercambiable, renovación, errores clasificados (transitorios con espera creciente, permanentes sin reintento).
- `backend/src/services/ml/mlSync.js`: la regla de sincronización, con el cliente y el reloj inyectados para poder probarla.
- `backend/src/services/ml/mlOrders.js`: libro de órdenes.
- `backend/src/services/ml/mlWorker.js`: `kick()` devuelve la promesa de la pasada en curso y, si ya corre, pide otra al terminar. Lo despiertan `stock.onCommitted`, los avisos y un tick en `backend/src/services/cron.service.js`. Los reintentos se guardan como fecha (`nextAttemptAt`), no como temporizadores.
- `backend/src/controllers/ml.controller.js` y `backend/src/routes/ml.routes.js`, montadas en `/api/ml` en `backend/src/index.js`:
  - Cuenta: `GET /status` (permiso `configuracion`); `POST /oauth/start`, `POST /oauth/exchange`, `POST /disconnect` y `PUT /settings` solo superadministrador. La vuelta de Mercado Libre llega a una pantalla del panel, que llama a `exchange` con la sesión del administrador: no hay ruta pública que reciba el código.
  - Vínculos (permiso `productos`): `POST /listings/refresh`, `GET /pools` (con sugerencias por SKU y título), `POST /pools/:id/link`, `POST /pools/:id/unlink`, `POST /pools/:id/activate` (con el número que queda), `POST /pools/:id/resolve` (para los que quedaron en `REVISAR`), `POST /pools/:id/check`.
- `POST /api/ml/webhook/:token`: público. Mercado Libre no firma sus avisos, así que la dirección lleva una clave (`ML_WEBHOOK_TOKEN`, comparada con `timingSafeEqual`; si no coincide responde 404 sin tocar la base). Valida tópico y usuario, marca qué hay que releer, responde 200 siempre y despierta al trabajador. Nunca confía en el contenido: el trabajador vuelve a pedir el dato a la API. Se monta antes del límite general (`index.js:130`) con un límite propio.
- Variables nuevas en `backend/.env` y en `backend/.env.production.example`: `ML_APP_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_WEBHOOK_TOKEN`, `ML_EXPECTED_USER_ID`, `ML_SYNC_ENABLED`, `SECRETS_KEY`.
- `backend/scripts/migracion-mercadolibre.sql`.

### Panel

- `frontend/src/components/admin/MercadoLibreSectionContent.jsx` como sección de `AdminSettings.jsx`: conectar, estado de la cuenta, modo.
- `frontend/src/pages/admin/AdminMlCallback.jsx`: pantalla a la que vuelve Mercado Libre después de autorizar.
- `frontend/src/pages/admin/AdminMercadoLibre.jsx` (submenú de Productos en `AdminLayout.jsx`): publicaciones de la cuenta con su stock, el producto vinculado y su stock, estado y último error. Vincular usa el buscador que ya existe (`GET /api/products/admin/all`) y sugiere por SKU o título parecido. Al activar un vínculo se elige qué número queda. Los que quedaron en `REVISAR` muestran los dos números y las ventas del momento, y se resuelven eligiendo el correcto.
- Etiqueta "ML" en `AdminProducts.jsx` para los productos vinculados.

### Pasos

| Paso | Qué sale | Cómo se comprueba |
|---|---|---|
| 1.0 | Aplicación nueva en Mercado Libre, variables en el VPS y una publicación de prueba | — |
| 1.1 | Conexión, modo `APAGADO` | El panel muestra la cuenta y el token se renueva solo |
| 1.2 | Publicaciones y vínculos, solo lectura | Los dos números lado a lado coinciden con lo que muestra Mercado Libre |
| 1.3 | Avisos, barrido y motor en modo `OBSERVAR` | Durante varios días, lo que registra coincide con las ventas y cambios reales |
| 1.4 | `ACTIVO` solo con la publicación de prueba | Los cuatro casos de la tabla y la lista de "cosas a confirmar" |
| 1.5 | Un producto real de poco movimiento, después el resto | Una semana sin diferencias en el barrido |

En el paso 1.1, con la cuenta conectada y sin escribir nada, se mira una publicación real: si quedan variaciones adentro, el `user_product_id`, y si el endpoint con versión responde. De ahí sale el adaptador de lectura y escritura.

### Verificación

- Tests de `mlSync` con un cliente y un reloj simulados: los cuatro casos de la tabla; dos pozos de una unidad; dos publicaciones del mismo pozo contadas una vez; sobreventa; conflicto de versión; caída entre la transacción y la escritura; los tres desenlaces de una escritura desconocida; relectura que detecta un cambio; venta pisada recuperada una sola vez; cambio grande retenido; lectura vieja descartada; modo observar sin escrituras; 429 que frena la cuenta; vínculo roto; token vencido y token revocado.
- Tests del aviso: clave incorrecta, tópico o usuario ajenos, y que siempre responde 200.
- Con la publicación de prueba: lo que figura en "Riesgos y cosas a confirmar".
- Si Cloudflare frena los avisos, la dirección de avisos pasa a `igwtstore.82-25-74-242.sslip.io`, que `deploy/igwtstore.caddy` ya atiende sin Cloudflare.

## Etapa 2: facturación ARCA

**Qué cambia para el dueño:** en el detalle de cualquier pedido en pesos (de la web o cargado a mano) aparece una tarjeta "Factura" con el botón "Facturar". Se abre una ventana en tres pasos (a quién, datos, revisar) con el tipo sugerido, los datos del cliente y los importes. Al confirmar, ARCA devuelve el CAE y queda la factura con su PDF, el botón para mandarla por mail y el botón "Anular" (nota de crédito). Nada se factura solo.

### Diseño

Conexión directa con ARCA, sin intermediarios, en `backend/src/services/arca/`:

- `transport.js`: `node:https` con cifrados ECDHE explícitos, TLS 1.2 como mínimo, timeout por llamada y tope de tamaño. Es la única excepción a `fetch`: el servidor de producción de wsfev1 le rechaza la conexión (`ERR_SSL_DH_KEY_TOO_SMALL`) y el de pruebas no, así que el problema aparecería recién al salir a producción. Sin `SECLEVEL=1` ni `rejectUnauthorized: false`.
- `pki.js`: clave con `crypto.generateKeyPairSync`; pedido de certificado (CSR) y firma CMS con `node-forge` (versión fija); lectura del certificado con `crypto.X509Certificate`.
- `wsaa.js`: ticket de acceso, guardado cifrado por ambiente y servicio, con una sola solicitud en vuelo. ARCA rechaza pedir otro mientras hay uno vigente, y el contenedor se reinicia en cada deploy.
- `xml.js` y `wsfe.js`: sobres SOAP armados a mano en el orden del WSDL y un lector chico de respuestas. `FECAESolicitar`, `FECompUltimoAutorizado`, `FECompConsultar`, `FEParamGet*`, `FEDummy`.
- `constants.js` y `params.js`: los pocos códigos que el sistema usa (factura A y B, sus notas de crédito, CUIT, DNI, 21 y 10,5) van escritos en el código, porque ARCA entrega código y descripción pero no el significado, y sus tablas traen mucho más de lo que el sistema sabe emitir. El diagnóstico baja las tablas de ARCA, las guarda por ambiente y las compara: si un código usado falta o venció, avisa y bloquea ese tipo. De ARCA salen las etiquetas que se muestran y qué condición frente al IVA va con cada letra.
- `amounts.js`, `receiver.js`, `qr.js`: funciones puras (importes, validación del receptor, texto del QR).
- `invoice.service.js`: numeración, estados y reconciliación.
- `invoicePdf.js`: PDF propio con `pdfkit`. No se reutiliza `buildOrderPdf` (`email.service.js:221`), que no pagina y baja imágenes por red. QR dibujado con `qrcode-generator`, que no trae dependencias.

**Certificado sin que la clave salga del servidor.** El panel genera la clave privada y el CSR. La clave queda cifrada en la base y ningún endpoint la devuelve. El titular sube el CSR a ARCA, baja el certificado y lo carga en el panel, que verifica que corresponda a la clave y que esté vigente. Hay un casillero "pendiente" para renovar sin cortar la emisión, y el panel avisa 30 días antes del vencimiento.

**Dos ambientes**, pruebas (homologación) y producción, cada uno con su certificado, CUIT emisor y punto de venta. El certificado de pruebas se saca con la clave fiscal de una persona y lleva su CUIT; la SRL figura como representada. Por eso el CUIT del certificado y el CUIT que factura son datos separados. Pasar a producción lo hace solo el superadministrador, con el diagnóstico aprobado y una confirmación escrita. Las facturas de prueba llevan la marca "SIN VALIDEZ FISCAL", no se mandan al cliente y no bloquean el pedido.

**Permisos:** uno nuevo, `facturacion`, para emitir (se agrega en `UsersSectionContent.jsx` y `AdminUsers.jsx`). La configuración fiscal y el cambio de ambiente, solo superadministrador.

### Reglas de la factura

- **Total:** siempre lo que pagó el cliente (`Order.total`). Nunca se factura otro número. Todo se calcula en centavos enteros.
- **Importes:** al total se le resta el envío; lo que queda se reparte entre las líneas en proporción a precio por cantidad (con su alícuota sumada si el pedido tiene IVA aparte), de modo que la suma dé exacta. Por cada alícuota (21 o 10,5), base = bruto / (1 + alícuota) e IVA = bruto − base. Es una sola regla para mayorista y minorista, y el cupón y el descuento manual quedan prorrateados igual que en `computeOrderTotals` (`backend/src/utils/orderTotals.js`).
- **`Order.ivaAmount` no se manda a ARCA** (es suma de redondeos, usa la alícuota de hoy y no incluye el envío). Sirve de control: si no coincide con lo calculado, alguien cambió la alícuota después de la venta y el panel avisa antes de emitir.
- **Envío:** una línea aparte con IVA 21 % contenido. La configuración fiscal permite cambiarlo (prorrateado o no gravado) según diga el contador.
- **No se puede facturar:** pedido con alguna línea en dólares, total en cero, alícuota distinta de 21 o 10,5, pedido cancelado o rechazado, o con una factura vigente. Si no figura como abonado, el panel pide confirmar. El costo del correo hay que cargarlo antes.
- **Ítems sin producto** (frecuentes en las ventas cargadas a mano): van al 21 % por defecto y la ventana deja cambiar la alícuota de cada renglón entre 21 y 10,5.
- **Tipo:** A para responsable inscripto o monotributista, con CUIT. B para consumidor final o exento. El panel sugiere y el administrador decide. ARCA no rechaza una A a quien no corresponde (solo la observa), así que para A hay que tildar "verifiqué la constancia".
- **Receptor:** para A, CUIT válido, razón social, condición frente al IVA y domicilio. Para B a consumidor final por debajo del tope vigente (configurable) no hace falta documento. Se manda siempre `CondicionIVAReceptorId`. Se precarga de la última factura del mismo cliente, de su cuenta o del pedido.
- **Numeración sin duplicados:** la factura se guarda como pendiente, con su número, antes de llamar a ARCA. Timeout, corte o error del servidor la dejan "a confirmar": se consulta a ARCA comparando total, documento y fecha antes de cualquier reintento, y mientras tanto no se emite otra de esa serie. Un rechazo libera el número. Un doble clic no genera dos facturas (candado por serie y clave única por pedido).
- **Pedido facturado:** una columna `orders.arcaLockedAt` y la función pura `backend/src/utils/fiscalLock.js` impiden cambiar líneas, descuentos y envío, borrar el pedido y pasarlo a cancelado, rechazado o pendiente. Siguen permitidos el estado logístico, el seguimiento y el método de pago. Se chequea en `deleteOrder`, `updateOrderStatus`, `updateOrderItem`, `deleteOrderItem`, `addItemToOrder`, `modifyOrder`, `updateOrderFields` (`3084`), `publishCotizacion` (`1936`), `approveCotizacion` (`1979`) y `cancelByCustomer`. Va en una columna del pedido y no en una consulta a la tabla nueva para no romper los tests existentes.
- **Devolución por Mercado Pago de un pedido facturado:** no se bloquea; el panel avisa que corresponde nota de crédito.
- **Nota de crédito:** el botón "Anular factura" la emite por el total, del mismo tipo y asociada a la factura. No cancela el pedido ni devuelve plata ni stock: eso se hace después, como siempre. Al autorizarse libera el pedido, que se puede corregir y volver a facturar. Como salida de emergencia, el superadministrador puede anotar una nota hecha por fuera.
- **Lo que se guarda del intercambio con ARCA** va sin el token ni la firma.

### Datos nuevos

- `orders`: `customerDocType`, `customerDocNumber` y `arcaLockedAt`.
- `arca_config` (una fila): datos del emisor que se imprimen (razón social según la constancia y nombre de fantasía opcional), ambiente activo, opción del envío, tope de consumidor final.
- `arca_credentials` (una fila por ambiente): CUIT emisor, punto de venta, clave cifrada, CSR, certificado, vencimiento y casillero pendiente. Ningún controller la devuelve, y un test lo verifica.
- `arca_tickets`: ticket cifrado por ambiente y servicio.
- `arca_params`: copia de las tablas de ARCA por ambiente.
- `arca_invoices`: pedido, ambiente, clase, tipo, punto de venta, número, estado (`PENDING`, `AUTHORIZED`, `REJECTED`, `UNCERTAIN`), datos del receptor, importes, desglose por alícuota, renglones tal como se imprimieron, CAE y vencimiento, observaciones, factura asociada y quién la emitió. Único por ambiente, punto de venta, tipo y número. La relación con el pedido es `ON DELETE RESTRICT`.
- Una sola migración, `backend/scripts/migracion-arca.sql`.

### Backend y panel

- `backend/src/controllers/arca.controller.js` y `backend/src/routes/arca.routes.js`, montadas en `/api/arca`: configuración, CSR, certificado, diagnóstico y ambiente (superadministrador); borrador, emitir, verificar con ARCA, PDF, mail y nota de crédito (permiso `facturacion`).
- `frontend/src/pages/Checkout.jsx:309-332`, `backend/src/middleware/validate.middleware.js` y `createOrder` (`order.controller.js:306`): mandar, validar y guardar el documento.
- `getOrder` (`order.controller.js:264-303`) y `getOrders`: traer las facturas del pedido.
- `frontend/src/components/admin/InvoiceCard.jsx` e `InvoiceModal.jsx`, usados en `AdminOrderDetail.jsx` arriba de "Estado de pago" (`:1417`). `AdminOrders.jsx`: etiqueta "Facturada".
- `frontend/src/components/admin/ArcaSectionContent.jsx` como sección de `AdminSettings.jsx`: emisor, asistente del certificado, diagnóstico y ambiente.
- `frontend/src/services/api.js`: las llamadas de emisión con `timeout: 90000` (el cliente corta a los 12 segundos por defecto) y el PDF como archivo con el encabezado de autorización.
- Mail: `sendInvoiceEmail` en `backend/src/services/email.service.js`, con el PDF adjunto como ya se hace en `:819`.
- `backend/package.json`: `node-forge` y `qrcode-generator`. `.gitignore` y `backend/.dockerignore` nuevo: `*.pem`, `*.key`, `*.crt`, `*.csr`, `*.p12`, y en el segundo también `.env*`, `node_modules` y `uploads`. Con eso, `docker-compose.yml` (desarrollo) necesita `env_file`.

### Pasos

| Paso | Qué sale | Cómo se comprueba |
|---|---|---|
| 2.0 | Sin código: prueba de conexión a ARCA desde adentro del contenedor, hora del VPS, respuestas del contador, alta en el servicio de pruebas | La conexión negocia un cifrado ECDHE |
| 2.1 | Migración y documento del checkout | Un pedido de invitado muestra el documento en el panel |
| 2.2 | Cimientos sin pantalla: cifrado, CUIT, importes, receptor, QR, lector XML | Tests |
| 2.3 | Acceso a ARCA y configuración, en pruebas | El diagnóstico muestra punto de venta y últimos números |
| 2.4 | Emisión y reconciliación, en pruebas | Matriz de casos; forzar un corte y reconciliar |
| 2.5 | PDF, QR y mail | Escanear el QR; el contador revisa una A y una B |
| 2.6 | Bloqueo del pedido y etiqueta en el listado | Tests por función; los tests viejos pasan sin tocarlos |
| 2.7 | Nota de crédito | Anular una factura de prueba |
| 2.8 | Producción | Primera factura B de poco importe, vista en "Mis Comprobantes"; después una A |

Entre 2.4 y 2.8, dos semanas de uso en pruebas sobre pedidos reales, que no quedan bloqueados. Plan B si algo falla en producción: "Comprobantes en línea" con otro punto de venta, y un interruptor que apaga el botón.

### Verificación

- `amounts`: 21, 10,5 y mixto; cupón porcentual y fijo; descuento manual; envío en sus tres modos; mayorista con IVA aparte; ítem libre; alícuota inválida; dólares; total cero. Además un test con muchos pedidos generados que comprueba que la suma siempre cierra al centavo con `Order.total` y que cada IVA corresponde a su base.
- `receiver` y CUIT: dígito verificador, combinaciones de tipo, condición y documento, tope, receptor igual al emisor. `qr`: el ejemplo oficial, byte a byte. `secretBox`: ida y vuelta, dato alterado, clave equivocada.
- `wsfe` con respuestas grabadas (primero las del manual, después las reales de pruebas con los datos reemplazados, porque el repo es público): aprobada, con observaciones, rechazada, error del servidor, HTML de mantenimiento, comprobante encontrado y no encontrado.
- Servicio con base y transporte simulados: la fila pendiente se guarda antes de llamar; un corte no dispara una segunda solicitud; doble clic; dos pedidos a la vez sacan números consecutivos; un rechazo libera número y pedido; las facturas de prueba no bloquean.
- Guardas: el `GET` de configuración no trae secretos; ningún archivo de `arca/` usa `siteConfig`; el sobre guardado no trae token ni firma.
- En pruebas: B sin identificar, B con DNI, B a exento, A a responsable inscripto, A a monotributista, alícuotas mixtas, con descuento, con envío, y un importe sobre el tope sin documento (tiene que rechazar).

## Lo que tienen que hacer ustedes

**Mercado Libre** (te guío paso a paso cuando llegue el momento):

1. Entrar a developers.mercadolibre.com.ar con la cuenta vendedora y crear una aplicación **nueva para la tienda** (no reutilizar la del publicador).
2. Cargar la dirección de vuelta (una pantalla del panel de la tienda), la dirección de avisos (lleva una clave que te paso en el momento), los permisos de lectura, escritura y acceso sin conexión, y los avisos `orders_v2` e `items`.
3. Copiar el ID y la clave secreta de la aplicación en `backend/.env` del VPS, junto con las otras variables nuevas.
4. Crear una publicación de prueba, barata y pausada, para probar sin tocar las reales.

**ARCA, para pruebas** (una persona, con su propia clave fiscal; con la de la SRL no se puede):

1. En el Administrador de Relaciones, adherir "WSASS – Autogestión Certificados Homologación".
2. En el panel de la tienda, generar el pedido de certificado con el CUIT de esa persona y copiarlo.
3. En WSASS, "Nuevo Certificado": pegar el pedido, copiar el certificado y cargarlo en el panel.
4. En WSASS, "Crear Autorización a Servicio" para `wsfe`, con la SRL como CUIT representado.

**ARCA, para producción** (quien administra las relaciones de la SRL, con clave fiscal nivel 3, eligiendo siempre a la SRL como "representado"):

1. Con el contador: que estén habilitados para factura A y B y con el domicilio fiscal electrónico activo.
2. Dar de alta un punto de venta nuevo para web services. No puede ser el de "Comprobantes en línea".
3. Adherir "Administración de Certificados Digitales", subir el pedido de certificado que genera el panel (con el CUIT de la SRL), bajar el certificado y cargarlo en el panel.
4. En el Administrador de Relaciones, autorizar "Facturación Electrónica" para ese certificado.

**Datos que necesito:** CUIT y razón social exacta de la SRL según la constancia, nombre de fantasía si quieren que figure, domicilio comercial, número de ingresos brutos, fecha de inicio de actividades, el punto de venta nuevo y el CUIT de la persona que hace las pruebas. Ningún archivo secreto: la clave no sale del servidor.

**Para el contador:**

- ¿El envío se factura con IVA 21 %, prorrateado o como no gravado? ¿La factura va como "productos" aunque tenga un renglón de envío?
- ¿Están habilitados para factura A común (no "A con leyenda" ni M)? ¿Tienen clientes que obliguen a factura de crédito MiPyME?
- Un mayorista que pagó sin pedir factura y después la pide: ¿se le factura el mismo total con el IVA adentro?
- ¿Qué alícuota llevan los ítems cargados a mano sin producto? ¿Algún producto lleva una distinta de 21 o 10,5?
- ¿Son agentes de percepción? (El plan asume que no.)
- ¿Cuál es hoy el tope para facturar a consumidor final sin documento?

## Riesgos y cosas a confirmar

- **Mercado Libre, ya comprobado** en el código del publicador, que funciona contra esta cuenta: `PUT /items/{id}` con `available_quantity` cambia el stock, `/orders/search?seller=...` trae las ventas con sus líneas, y las publicaciones traen `user_product_id`.
- **Mercado Libre, a comprobar con la publicación de prueba antes de activar:**
  - si se puede crear una segunda aplicación y si tiene PKCE activado;
  - si `GET /user-products/{id}/stock` devuelve versión, si una escritura con versión vieja da 409 y si una venta cambia la versión (es lo que más simplifica), y si la cuenta tiene depósitos múltiples;
  - si leer justo después de escribir devuelve alguna vez el número viejo, y que la respuesta de la escritura traiga la cantidad realmente guardada;
  - si las publicaciones del mismo `user_product_id` muestran el mismo número enseguida después de una venta;
  - si `sold_quantity` es exacto con el token del vendedor y se mueve junto con el stock;
  - qué aviso llega cuando el stock se cambia a mano y cuando lo cambia el publicador (`items` o `stock-locations`);
  - qué hace el contador de Mercado Libre al cancelarse una venta, antes y después del despacho (no cambia el diseño, sí lo que hay que saber: la página copia lo que haga);
  - si quedan publicaciones viejas con variaciones adentro y si al actualizar una hay que mandar todas (mientras no esté probado: mandar todas y comparar los identificadores de la respuesta);
  - que stock 0 pause y stock mayor a 0 reactive solo si la pausa era por falta de stock, y qué error devuelve una publicación cerrada o en revisión;
  - en cuánto tiempo hay que responder los avisos (vi 500 ms en una página y 20 segundos en otra: se diseña para 500 ms) y si pasan por Cloudflare;
  - si las dos aplicaciones comparten el límite de pedidos de la cuenta.
- **ARCA:**
  - La conexión a producción se probó desde esta máquina (Node 24). Falta repetirla dentro del contenedor (Node 22), en el paso 2.0.
  - El ambiente de pruebas no es producción: su padrón es otro, una A a un CUIT real puede rechazarse, y el emisor puede no figurar ahí como responsable inscripto. Se usan CUIT de prueba.
  - Según el manual vigente, omitir `CondicionIVAReceptorId` hoy da una observación y pasará a ser rechazo. Mandándolo siempre, la fecha no importa.
  - El texto exacto de la leyenda de transparencia fiscal, el nombre de la opción del punto de venta para web services y el código de "comprobante inexistente" se confirman en pruebas.
  - WSAA rechaza si el reloj del VPS está corrido. La fecha de la factura va siempre en hora argentina.
- **Black Friday (27/11):** la Etapa 0 cambia cómo se descuenta el stock. Si no llega a estar probada con varios días de margen, conviene desplegarla después.
- **Perder `SECRETS_KEY`** obliga a reconectar Mercado Libre y a generar un certificado nuevo; no se pierde ningún dato fiscal. Hay que guardarla fuera del VPS y no junto con los backups de la base.
- **`prisma db push --accept-data-loss`** sigue en el `CMD` del Dockerfile. Producción lo pisa, pero un entorno que no lo haga puede perder columnas si alguien renombra un campo.
- En este repo hay otras sesiones de Claude abiertas: al commitear, agregar solo los archivos de cada tema.

## Pendiente de definir: etiquetas de la moto

Pedido del dueño (11/11/2026): hoy cada envío en moto se carga a mano en la web de la mensajería para sacar la etiqueta. La mensajería usa esa carga para cobrar, seguir el envío e imprimir la etiqueta, así que cada envío tiene que quedar cargado en su sistema: no alcanza con imprimir una etiqueta propia. Imprimen en térmica 10x15.

Depende de qué ofrezca la mensajería (falta el nombre o la página):
- **Con API:** botón "Generar envío" en el pedido y "Generar envíos del día" en la lista, como ya hace el panel con Correo Argentino (`backend/src/services/micorreo.service.js`); su etiqueta vuelve en PDF o ZPL para la térmica.
- **Con carga masiva (Excel/CSV):** el panel arma el archivo de los pedidos en moto del día en su formato; se sube una vez y bajan todas las etiquetas juntas.
- **Sin ninguna de las dos:** robot que llene su formulario web. No recomendado (se rompe con cada cambio de su página).

## Fuera de este plan

Quedan para después, sobre la misma base: copiar precios o promociones a Mercado Libre, ver las ventas de Mercado Libre como pedidos del panel, facturar ventas de Mercado Libre, facturas sueltas, notas de crédito parciales, pedidos en dólares, completar los datos del cliente consultando el padrón de ARCA, y otros correos.
