# TODO: venta manual como cotización + cliente puede editar su cotización

Investigación hecha el 2026-09-18/22, sin implementar nada todavía. Las referencias `archivo:línea`
son de ese momento — si ya tocaste algo de `order.controller.js` puede haberse corrido alguna línea,
pero las funciones y el criterio siguen siendo válidos.

## Qué se pidió

En el modal "Nueva venta manual" (Admin → Órdenes → "+ Nueva venta"), agregar la opción de elegir
**Venta** o **Cotización**, para un cliente existente, nuevo o "de la calle". Si el cliente tiene
cuenta, tiene que poder ver esa cotización en su perfil → Cotizaciones **y modificarla ahí**: cambiar
cantidades, sacar productos, agregar productos.

## Decisión ya tomada

Cuando el cliente modifica su cotización, **vuelve a "pendiente" (revisión)**. Vos revisás precios,
stock y variantes y la aprobás de nuevo; recién ahí el cliente puede pagar. Es como ya funciona hoy
el circuito de cotizaciones de mayoristas (crear → vos publicás/aprobás → cliente paga), asegura que
nada quede con precio o variante sin controlar.

---

## Cómo funciona hoy (para orientarte antes de tocar nada)

### Modelo de datos

- **No hay un modelo `Quote` separado.** Una cotización ES un `Order` con `paymentMethod: "COTIZACION"`.
- `OrderStatus`: `PENDING` (esperando revisión) → `QUOTE_APPROVED` (vos la aprobaste, cliente puede
  pagar) → `PAYMENT_REVIEW` (cliente ya avisó que pagó) → `APPROVED`. O `REJECTED` / `CANCELLED`.
- `Order.clientSnapshot` (Json): copia de los ítems que ve el cliente. Se actualiza SOLO cuando vos
  tocás "Actualizar cotización" (o en algunos casos puntuales, ver más abajo). Forma exacta de cada
  ítem: `{ id, productId, name, price, currency, quantity, image }` — sale de `product.name` /
  `product.images`, **no** de `productName`/`productImage` (importa para el punto 2 de "cosas para
  tener en cuenta", abajo).
- `Order.adminNotes` tiene doble uso: en venta manual es "Notas internas" (solo vos la ves); en
  cotizaciones es la "Nota del vendedor" que **sí ve el cliente**. Ojo si tocás ese campo.
- `Order.isModified` + `Order.originalSnapshot`: ya existen para "vos modificaste un pedido después
  de aprobado, y el cliente puede comparar original vs. modificado". Sirve de modelo (o se puede
  reusar) para "el cliente modificó su cotización".

### Cómo se crea una cotización hoy

- Solo desde `Checkout.jsx:290-316`, con `paymentMethod: "COTIZACION"`. En el front esa opción solo
  se ofrece a mayoristas, pero **el backend no lo valida**: `createOrder`
  (`backend/src/controllers/order.controller.js:262-667`) acepta `COTIZACION` de cualquiera.
- Ahí adentro: calcula el precio de cada ítem del lado del servidor (`effectiveUnitPrice`), reserva
  stock de los productos SIN variantes (595-613; los que tienen variantes no reservan nada todavía),
  arma el `clientSnapshot` (618-635) y manda dos emails: `sendCotizacionToCustomer` /
  `sendCotizacionToAdmin` (654-656).

### Qué podés hacer vos hoy con una cotización (todo en `order.controller.js`)

| Acción | Función | Línea | Nota |
|---|---|---|---|
| Editar cantidad/precio de un ítem | `updateOrderItem` | 1239 | Solo republica `clientSnapshot` si la orden **ya está APPROVED** — en el caso normal (PENDING) el cliente sigue viendo la versión vieja hasta que publiqués |
| Eliminar un ítem | `deleteOrderItem` | 1314 | Mismo criterio que arriba |
| Agregar un ítem | `addItemToOrder` | 1368 | Este SÍ republica el snapshot siempre (inconsistente con los dos de arriba) |
| "Actualizar cotización" | `publishCotizacion` | 1688 | Arma el snapshot fresco, recalcula totales, notifica al cliente (`COTIZACION_ACTUALIZADA`). El comentario dice que manda email pero **no lo manda** |
| "Aprobar cotización" | `approveCotizacion` | 1731 | Asigna variantes, descuenta stock, pasa a `QUOTE_APPROVED`, notifica |
| Rechazar / cancelar | — | — | No hay endpoint propio: se reusa `updateOrderStatus` (670) con `REJECTED`/`CANCELLED`. El enum `COTIZACION_RECHAZADA` existe pero **nunca se dispara**, y el email de cambio de estado corta a propósito para cotizaciones (`email.service.js:1236`) — **hoy el cliente no se entera si le rechazás la cotización** |

### Qué puede hacer el cliente hoy (todo pide sesión + ser el dueño de la orden)

- **Listar**: `GET /orders/my-quotes` → `getMyCotizaciones` (1580) — devuelve el `clientSnapshot`
  como `items`, nunca los ítems reales de la orden.
- **Ver una**: `GET /orders/my-quotes/:id` → `getMyQuoteById` (1857).
- **Cancelar**: `POST /:id/cancel-by-customer` → `cancelByCustomer` (1882) — sin restricción de
  estado, devuelve stock de todos los ítems (sin distinguir variantes).
- **Pagar** (una vez `QUOTE_APPROVED`): `confirm-payment` (manual) o MercadoPago.
- **Editar ítems (cantidad / sacar / agregar): NO EXISTE.** Ni endpoint — las rutas de ítems son
  todas `adminMiddleware` (`order.routes.js:54-61`) — ni pantalla: `QuotationHistory.jsx` y
  `PayQuotation.jsx` son de solo lectura.

### El modal "Nueva venta manual" (no es un componente aparte, vive dentro de `AdminOrders.jsx`)

- `customerMode`: `"existing" | "new" | "walk-in"` (2106-2271).
  **Ojo: "Cliente nuevo" en este modal NO crea una cuenta.** Solo guarda nombre/email/teléfono
  sueltos en la orden; `customerId` queda `null` (`order.controller.js:2382`). Este es el hueco
  central para lo que pedís: si un "cliente nuevo" tiene que poder entrar después a ver y editar su
  cotización, hace falta crear la cuenta de verdad.
- El alta de cliente por admin **sí existe**, pero en otro lugar y no la usa este modal:
  `POST /customers/admin/create` → `createCustomerAdmin` (`customer.controller.js:554`), usada hoy
  solo desde `AdminCustomers.jsx`. Pide contraseña obligatoria (mínimo 6 caracteres, línea 565-567).
- `handleSaveManual` (`AdminOrders.jsx:424-532`) → `ordersApi.createManual` →
  `POST /orders/admin/manual` → `createManualOrder` (`order.controller.js:2198`).
- `createManualOrder`: `paymentMethod` solo acepta `MERCADOPAGO | EFECTIVO | TRANSFERENCIA` (2210) —
  **cualquier otro valor, incluido `COTIZACION`, cae silenciosamente a `EFECTIVO`**. `status` solo
  admite `PENDING | APPROVED` (2213). No arma `clientSnapshot`, no manda email, no crea notificación,
  no aplica IVA ni cupón.

---

## Qué hay que construir

### A. Selector Venta / Cotización en el modal

- [ ] Toggle en el modal (`AdminOrders.jsx`, cerca del selector de modo de cliente, ~2106): "Venta"
      (como hoy) vs. "Cotización".
- [ ] En modo Cotización: ocultar o deshabilitar el selector de "Estado" (no aplica "Abonada" a una
      cotización) y mandar siempre `status: "PENDING"`.
- [ ] Backend (`createManualOrder`): agregar `"COTIZACION"` a la lista de métodos válidos (línea
      2210) — hoy la excluye por error, de paso conviene arreglarlo.

### B. Que "Cliente nuevo" cree una cuenta real cuando es cotización

- [ ] **Decisión a tomar** (ver más abajo): ¿contraseña puesta a mano por vos al crear la venta
      (reusar `createCustomerAdmin` tal cual), o contraseña generada + mail de "activá tu cuenta"
      (reusar `resetToken`/`sendPasswordResetEmail`, ya existen en `customer.controller.js` y
      `email.service.js:1536`)? La segunda es más rápida para vender de mostrador, pero el cliente
      tarda en poder entrar a verla.
- [ ] Si es Cotización Y modo "Cliente nuevo": antes de (o dentro de) `createManual`, crear el
      `Customer` (nuevo endpoint liviano, o reusar `customersApi.createAdmin`) y mandar ese
      `customerId` real en el payload de la venta.
- [ ] "De la calle" se queda igual (`customerId: null`): es la cotización de mostrador que no vas a
      poder mostrarle en ningún perfil porque no hay cuenta — se la das impresa o por WhatsApp, como
      ya se puede con `handlePrint` (`AdminOrders.jsx:1043`). Ojo: esa hoja hoy es la interna, con
      "Nota interna" y la ubicación en el depósito — armar (o adaptar) una versión "de cara al
      cliente" antes de mandársela.

### C. Que `createManualOrder` arme `clientSnapshot` y avise al cliente, cuando es cotización

- [ ] Si `paymentMethod === "COTIZACION"`: construir el `clientSnapshot` igual que `buildSnapshot`
      (1659) — mismo formato `{id, productId, name, price, currency, quantity, image}`.
- [ ] Mandar `sendCotizacionToCustomer` si hay email (mismo mail que ya usa `createOrder`).
- [ ] Si hay `customerId`, `createNotification(customerId, orderId, "COTIZACION_ACTUALIZADA", ...)`
      para que le aparezca el aviso/badge.

### D. Pantalla del cliente para editar su cotización (hoy no existe nada de esto)

- [ ] **Backend** — endpoints nuevos, todos con `authMiddleware` + `customerMiddleware` + validar
      que sea el dueño (`customerId === req.user.id`) + validar `paymentMethod === "COTIZACION"` +
      validar que el estado sea editable (ver "decisión" abajo):
  - [ ] `PATCH /orders/my-quotes/:id/items/:itemId` — cambiar cantidad (reusar la validación de
        stock de `updateOrderItem`, pero **sin dejar que el cliente toque el precio**).
  - [ ] `DELETE /orders/my-quotes/:id/items/:itemId` — sacar un producto. Si es el último ítem, no
        dejar vaciarla del todo: error y sugerir cancelar la cotización en su lugar.
  - [ ] `POST /orders/my-quotes/:id/items` — agregar un producto, con el mismo precio calculado del
        lado del servidor que ya usa `createOrder` (`effectiveUnitPrice`) — **nunca aceptar un
        precio que mande el cliente**.
  - [ ] Las tres, al terminar: recalcular totales (`recalcOrderTotals`, 1621), volver `status` a
        `"PENDING"`, guardar el snapshot anterior en `originalSnapshot` (mismo patrón que
        `modifyOrder`, 2735) para que vos puedas comparar antes/después, y marcar `seenByAdmin:
        false` para que te aparezca de nuevo en el badge de "Cotizaciones" (hoy no hay un tipo de
        notificación para vos, solo para clientes).
- [ ] **Frontend** — en `QuotationHistory.jsx` (hoy 100% solo lectura) o en una pantalla de detalle
      nueva: +/− de cantidad, tacho para sacar un producto, buscador para agregar uno (se puede
      calcar el buscador que ya existe en el modal de venta manual, `AdminOrders.jsx:2291-2306`).
  - [ ] Mientras está `PENDING` recién editada, dejarlo clarísimo en la UI — el cartel de "en
        revisión" que ya existe (`QuotationHistory.jsx:279-292`) alcanza, con volver el status a
        `PENDING` ya se dispara solo.

### E. Stock al editar desde el lado del cliente

- Pensarlo junto con el punto D: hoy, cuando el cliente CANCELA, devuelve stock de todos los ítems
  sin mirar variantes (`cancelByCustomer`, 1897-1909). Al EDITAR (sacar o bajar cantidad) hay que
  devolver proporcionalmente; al agregar o subir, descontar — con el mismo cuidado que ya falta en
  el resto del código para productos con variantes (ver el punto 3 de abajo).

---

## Cosas del código actual para tener en cuenta (van a chocar con esto si no se contemplan)

1. **El `clientSnapshot` no se actualiza siempre igual**: `updateOrderItem` y `deleteOrderItem` solo
   lo republican si la orden ya está `APPROVED`; `addItemToOrder` lo republica siempre. Si tocás esta
   zona convendría unificarlo — con la regla nueva de "el cliente edita → la orden vuelve a PENDING"
   quizás no haga falta tocarlo, pero conviene revisarlo con cuidado.
2. **Los ítems libres (`productId: null`, "producto libre" de la venta manual) no están
   contemplados en el snapshot**: `buildSnapshot` y el snapshot de `createOrder` arman el nombre/
   imagen desde `product?.name` / `product?.images`, no desde `productName`/`productImage`. Si
   generás una cotización con un ítem libre, hoy ese renglón le aparecería vacío al cliente en "Mis
   cotizaciones".
3. **Riesgo de descontar stock dos veces**: `confirmCotizacionPayment` cambia el `paymentMethod` de
   la orden antes de que se apruebe el pago; si después se marca `APPROVED` con
   `updateOrderStatus`, esa función vuelve a descontar stock (que `createOrder` ya había descontado
   al crearla). Tenerlo presente si tocás algo de esta cadena.
4. **"Rechazar" no avisa al cliente**: el email de cambio de estado corta a propósito para
   `COTIZACION` (`email.service.js:1236`) y el tipo de notificación `COTIZACION_RECHAZADA` nunca se
   dispara. Si vas a andar cerca de este código, es un hueco fácil de tapar de paso.
5. **`/cotizaciones` y `/pagar-cotizacion` están limitadas a `MAYORISTA` en el frontend**
   (`QuotationHistory.jsx:80`, `PayQuotation.jsx:74`, y los links de `Navbar.jsx`/
   `MobileBottomNav.jsx`). Para que un cliente MINORISTA (el caso típico de "cliente nuevo" en una
   venta manual) pueda ver y editar su cotización, hay que sacar esa restricción — el backend
   (`getMyCotizaciones`) ya no filtra por tipo, así que es solo un cambio de frontend.

---

## Orden sugerido para encararlo

1. **Backend**: aceptar `COTIZACION` + armar snapshot + mandar el email en `createManualOrder`
   (partes A + C). Es lo más chico y te deja probar de punta a punta "vendo → el cliente ve la
   cotización" con un cliente que YA tiene cuenta.
2. **Sacar el gate de MAYORISTA** en `/cotizaciones` (punto 5 de arriba) — sin esto no podés ni
   probar con un cliente minorista.
3. **Alta de cliente nuevo con cuenta real** (parte B) — dejalo para después de probar el punto 1
   con un cliente existente, para no mezclar dos cosas nuevas a la vez.
4. **Edición del lado del cliente** (partes D + E) — es la parte más grande, dejarla para el final.

## Decisiones que te faltan tomar

- **Contraseña del cliente nuevo**: ¿la tipeás vos al crear la venta, o se manda un mail para que la
  ponga el cliente?
- **¿En qué estados puede editar el cliente?** `PENDING` seguro que sí. ¿`QUOTE_APPROVED` también
  (una vez que ya la aprobaste), o una vez aprobada ya no se toca y si quiere cambios cancela y le
  hacés una cotización nueva?
- **¿Puede vaciarla del todo** sacando todos los productos, o el mínimo es un ítem y si quiere menos
  cancela la cotización entera?
- **La hoja para el cliente "de la calle" sin cuenta**: ¿adaptás `handlePrint` tal cual (hoy expone
  "Nota interna" y la ubicación en el depósito, pensada para uso interno) o armás una versión nueva
  pensada para dársela al cliente?
