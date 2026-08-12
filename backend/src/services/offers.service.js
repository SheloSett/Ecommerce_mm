// Motor de campañas de oferta con vigencia.
//
// Una campaña (model Offer) agrupa productos + un descuento + un rango de fechas. Mientras está
// vigente ESCRIBE salePrice / wholesaleSalePrice en los productos y sus variantes; al terminar los
// vuelve a null. No se calcula nada al vuelo: así todos los lugares que ya leen esos campos
// (utils/pricing.js, carrito, checkout, cards, flyer, emails, SEO) funcionan sin tocarlos, y el
// precio del carrito nunca se desincroniza del que ve el cliente en la vidriera.
//
// DOS REGLAS QUE EXPLICAN TODO EL ARCHIVO:
//
//  1. La campaña solo escribe donde el campo estaba en null (o donde el valor actual es exactamente
//     el que ella misma escribió antes). Una oferta cargada a mano por el admin se respeta y el
//     producto se marca como salteado. Corolario: revertir es "volver a null", no hace falta guardar
//     el precio anterior — solo el que escribimos, para saber si sigue siendo nuestro.
//
//  2. Hay que escribir las VARIANTES, no solo el producto. utils/pricing.js documenta que la oferta
//     de una variante NO se hereda del producto padre: si solo escribiéramos el producto, la campaña
//     no tendría ningún efecto sobre los productos con variantes.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Cantidad de updates por transacción. Una campaña grande (cientos de productos con variantes) genera
// muchas operaciones y una sola transacción gigante se pasa del timeout default de Prisma.
const TX_CHUNK = 100;

const round2 = (v) => Math.round(v * 100) / 100;

// Comparación de precios tolerante al ruido de punto flotante (medio centavo).
const sameMoney = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;

// Igual que sameMoney pero considerando "los dos vacíos" como iguales. Sirve para comparar el
// REGISTRO de la campaña (donde null es un valor válido: "este lado no lo toqué"), no para decidir
// si un precio es nuestro — para eso sigue estando sameMoney, que con null siempre da false.
const sameRecordValue = (a, b) => (a == null && b == null) || sameMoney(a, b);

// Clave canónica de una lista de variantes escritas, para comparar el registro guardado contra el
// nuevo sin depender del orden. NO se puede usar JSON.stringify: la columna es `jsonb` y Postgres
// reordena las claves de cada objeto al guardarlas, así que el texto que vuelve de la DB nunca
// coincide con el que mandamos y toda comparación daría "cambió" siempre.
const variantsKey = (list) =>
  (Array.isArray(list) ? list : [])
    .map((e) => `${e.variantId}:${e.salePrice ?? ""}:${e.wholesaleSalePrice ?? ""}`)
    .sort()
    .join("|");

// ── Candado de sincronización ─────────────────────────────────────────────────
//
// POR QUÉ EXISTE: el cron corre cada minuto y el admin puede tocar la misma campaña desde el panel
// en ese mismo instante. Sin candado las dos manos escriben los mismos precios a la vez, y el peor
// entrelazado deja este estado: el precio de oferta ESCRITO en el producto, la anotación del
// OfferItem VACÍA y la campaña marcada como no aplicada. Ese descuento ya no lo revierte nadie —
// ni el cron (para él la campaña no aplicó nada) ni un revert posterior (no tiene contra qué
// comparar). Queda un descuento fantasma sin dueño.
//
// CÓMO SE USA: toda operación que escriba precios de campaña se envuelve acá, y se envuelve
// ENTERA. En el controller no alcanza con encadenar tres llamadas ya protegidas por separado
// (revertir → guardar → sincronizar): el cron podría meterse entre dos de ellas, re-aplicar con la
// lista de productos vieja y dejar precios escritos en productos que justo salían de la campaña.
//
// ALCANCE: un candado en memoria alcanza porque el backend corre en UN solo proceso — PM2 en modo
// fork (deploy/ecosystem.config.cjs no define `instances`) y un único contenedor en el compose de
// producción. Si algún día se pasa a modo cluster o a varias réplicas, esto hay que reemplazarlo
// por un lock en la base (ej: SELECT pg_advisory_lock(...)).
const offerLocks = new Map(); // offerId → promesa de la operación en curso

function withOfferLock(offerId, fn) {
  const prev = offerLocks.get(offerId) || Promise.resolve();
  // Se encadena incluso si la anterior falló (.catch antes del .then): un error en una pasada no
  // puede dejar el candado trabado para siempre.
  const next = prev.catch(() => {}).then(fn);
  offerLocks.set(offerId, next);
  // Si esta es la última operación de la cadena, se saca la entrada del Map para que no crezca sin
  // límite con el correr de los días.
  next.catch(() => {}).then(() => {
    if (offerLocks.get(offerId) === next) offerLocks.delete(offerId);
  });
  return next;
}

// ── Cálculo ───────────────────────────────────────────────────────────────────

// Precio resultante de aplicar el descuento de la campaña sobre `base`.
// null = el descuento no da un precio usable (base inválida, resultado <= 0, o no llega a ser menor
// que la base). Quien llama decide qué motivo mostrar.
function calcOfferPrice(base, offer) {
  if (base == null || !(base > 0)) return null;
  const raw =
    offer.discountType === "PERCENTAGE"
      ? base * (1 - offer.discountValue / 100)
      : base - offer.discountValue;
  const price = round2(raw);
  if (!(price > 0) || price >= base) return null;
  return price;
}

// ¿Este campo es "de la campaña"? Sí si está vacío (nadie lo cargó) o si su valor actual es el que
// la campaña escribió en una pasada anterior. Cualquier otro valor es una oferta manual: se respeta.
function isWritable(current, previouslyWritten) {
  if (current == null) return true;
  return sameMoney(current, previouslyWritten);
}

// Con descuento FIXED, un producto en USD queda afuera: restarle "$5.000" a un precio en dólares no
// tiene sentido. Mismo criterio que bulkPriceAdjust en product.controller.js, que excluye USD del
// ajuste por porcentaje. Con PERCENTAGE se aplica normal, porque es proporcional a la moneda.
function currencyBlocked(offer, currency) {
  return offer.discountType === "FIXED" && currency === "USD";
}

// ── Estado de una campaña (derivado, no se guarda) ────────────────────────────

function offerState(offer, now = new Date()) {
  if (!offer.active) return "PAUSADA";
  if (now < new Date(offer.startsAt)) return "PROGRAMADA";
  if (now >= new Date(offer.endsAt)) return "FINALIZADA";
  return "ACTIVA";
}

const shouldBeApplied = (offer, now = new Date()) => offerState(offer, now) === "ACTIVA";

// ── Planificador ──────────────────────────────────────────────────────────────

// Calcula qué debería escribir la campaña en un producto y sus variantes. NO escribe nada: devuelve
// el plan. Lo usan por igual applyOffer() y el preview del admin, así lo que el cliente ve antes de
// confirmar es exactamente lo que va a pasar.
//
// product debe venir con `variants` (solo las activas). prevItem es el OfferItem previo (o null).
function planProduct(offer, product, prevItem) {
  const wantsRetail    = offer.appliesTo === "MINORISTA" || offer.appliesTo === "AMBOS";
  const wantsWholesale = offer.appliesTo === "MAYORISTA" || offer.appliesTo === "AMBOS";

  const prevVariants = new Map(
    (Array.isArray(prevItem?.appliedVariants) ? prevItem.appliedVariants : []).map((v) => [v.variantId, v])
  );

  const plan = { productId: product.id, salePrice: null, wholesaleSalePrice: null, variants: [] };
  const skips = new Set();

  // La moneda es propiedad EXCLUSIVA del producto: él define la UNIDAD y la variante el NÚMERO
  // (ver effectiveCurrency en utils/pricing.js). ProductVariant.currency está deprecada — la columna
  // todavía guarda datos del modelo viejo, así que leerla haría que una variante con un "USD"
  // heredado se saltee dentro de un producto ARS: el producto recibiría el descuento y esa variante
  // no, que es justo la desincronización que este motor existe para evitar.
  // Por eso este chequeo se hace UNA vez y vale para el producto y para todas sus variantes.
  const productCurrency = product.currency || "ARS";
  const blockedByCurrency = currencyBlocked(offer, productCurrency);

  // Una oferta cargada a mano en el PADRE bloquea ese lado también para las variantes (ver el
  // bloque de variantes más abajo). Antes solo se salteaba el producto y las variantes recibían el
  // descuento igual: como el precio que termina pagando el cliente sale de la variante, la oferta
  // manual que el motor decía respetar quedaba pisada, y encima el admin leía "salteado por oferta
  // manual" mientras el precio efectivo SÍ cambiaba. Ahora el mensaje y lo que pasa coinciden.
  let retailBlockedByManual    = false;
  let wholesaleBlockedByManual = false;

  // ── Producto ──
  if (blockedByCurrency) {
    skips.add("Precio en USD: un descuento de monto fijo no aplica");
  } else {
    if (wantsRetail) {
      if (!isWritable(product.salePrice, prevItem?.appliedSalePrice)) {
        skips.add("Ya tiene oferta minorista cargada a mano");
        retailBlockedByManual = true;
      } else {
        const p = calcOfferPrice(product.price, offer);
        if (p == null) skips.add("El descuento no da un precio minorista válido");
        else plan.salePrice = p;
      }
    }
    if (wantsWholesale) {
      // Sin wholesalePrice no hay nada a lo que aplicarle el descuento mayorista.
      if (product.wholesalePrice == null) {
        skips.add("Sin precio mayorista cargado");
      } else if (!isWritable(product.wholesaleSalePrice, prevItem?.appliedWholesaleSalePrice)) {
        skips.add("Ya tiene oferta mayorista cargada a mano");
        wholesaleBlockedByManual = true;
      } else {
        const p = calcOfferPrice(product.wholesalePrice, offer);
        if (p == null) skips.add("El descuento no da un precio mayorista válido");
        else plan.wholesaleSalePrice = p;
      }
    }
  }

  // ── Variantes activas ──
  // Cada variante se resuelve por separado, con la misma precedencia que utils/pricing.js:
  // su base es su propio precio si lo define, si no cae al del producto padre.
  // Si el producto quedó bloqueado por moneda, sus variantes también: están expresadas en la moneda
  // del padre, así que descontarles un monto fijo en pesos sería el mismo disparate.
  for (const variant of blockedByCurrency ? [] : (product.variants || [])) {
    const prev = prevVariants.get(variant.id);
    const entry = { variantId: variant.id, salePrice: null, wholesaleSalePrice: null };

    // retailBlockedByManual / wholesaleBlockedByManual: el padre tiene una oferta cargada a mano en
    // ese lado, así que la campaña no toca NADA de ese producto por ese lado — tampoco sus variantes.
    if (wantsRetail && !retailBlockedByManual) {
      if (!isWritable(variant.salePrice, prev?.salePrice)) {
        skips.add("Alguna variante ya tiene oferta minorista cargada a mano");
      } else {
        const base = variant.price != null ? variant.price : product.price;
        const p = calcOfferPrice(base, offer);
        // Antes: if (p != null) entry.salePrice = p;   ← el else quedaba mudo
        // Una variante que no puede tomar el descuento (típico: descuento de monto fijo mayor que el
        // precio de esa variante) se salteaba en silencio: el producto quedaba con descuento, esa
        // variante a precio lleno y el admin sin ningún aviso de por qué. Ahora se reporta.
        if (p != null) entry.salePrice = p;
        else skips.add("Alguna variante no puede tomar el descuento (le daría un precio de $0 o menos)");
      }
    }
    if (wantsWholesale && !wholesaleBlockedByManual) {
      const base = variant.wholesalePrice != null ? variant.wholesalePrice : product.wholesalePrice;
      if (base == null) {
        // Sin precio mayorista en la variante ni en el padre — ya se reportó a nivel producto.
      } else if (!isWritable(variant.wholesaleSalePrice, prev?.wholesaleSalePrice)) {
        skips.add("Alguna variante ya tiene oferta mayorista cargada a mano");
      } else {
        const p = calcOfferPrice(base, offer);
        // Mismo motivo que en el bloque minorista de arriba: no quedarse callado.
        if (p != null) entry.wholesaleSalePrice = p;
        else skips.add("Alguna variante no puede tomar el descuento mayorista (le daría un precio de $0 o menos)");
      }
    }

    if (entry.salePrice != null || entry.wholesaleSalePrice != null) plan.variants.push(entry);
  }

  plan.skippedReason = skips.size > 0 ? [...skips].join(" · ") : null;
  // touched: la campaña efectivamente escribe algo en este producto
  plan.touched =
    plan.salePrice != null || plan.wholesaleSalePrice != null || plan.variants.length > 0;
  return plan;
}

// ── Aplicar / revertir ────────────────────────────────────────────────────────

// Ejecuta los updates en tandas para no pasarse del timeout de una transacción única.
async function runChunked(ops) {
  for (let i = 0; i < ops.length; i += TX_CHUNK) {
    await prisma.$transaction(ops.slice(i, i + TX_CHUNK));
  }
}

// Escribe los precios de oferta de una campaña. Es IDEMPOTENTE: se puede correr todas las veces que
// haga falta y solo emite UPDATE donde hay diferencia real. Por eso el cron la vuelve a correr sobre
// las campañas ya activas — así entran las variantes creadas o los precios base editados en el medio.
//
// OJO: NO tomar esta función directamente desde un handler ni desde el cron — va envuelta en
// withOfferLock() por quien la llama (ver el comentario del candado arriba).
async function applyOffer(offerId) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { items: true } });
  if (!offer) return { applied: 0, skipped: 0 };

  const productIds = offer.items.map((i) => i.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { variants: { where: { active: true } } },
      })
    : [];

  const ops = [];
  let applied = 0;
  let skipped = 0;

  for (const product of products) {
    const item = offer.items.find((i) => i.productId === product.id);
    const plan = planProduct(offer, product, item);

    // Producto: solo se actualiza si el valor cambia
    const data = {};
    if (plan.salePrice != null && !sameMoney(product.salePrice, plan.salePrice)) {
      data.salePrice = plan.salePrice;
    }
    if (plan.wholesaleSalePrice != null && !sameMoney(product.wholesaleSalePrice, plan.wholesaleSalePrice)) {
      data.wholesaleSalePrice = plan.wholesaleSalePrice;
    }
    if (Object.keys(data).length > 0) {
      ops.push(prisma.product.update({ where: { id: product.id }, data }));
    }

    // Variantes
    for (const entry of plan.variants) {
      const variant = product.variants.find((v) => v.id === entry.variantId);
      const vData = {};
      if (entry.salePrice != null && !sameMoney(variant.salePrice, entry.salePrice)) {
        vData.salePrice = entry.salePrice;
      }
      if (entry.wholesaleSalePrice != null && !sameMoney(variant.wholesaleSalePrice, entry.wholesaleSalePrice)) {
        vData.wholesaleSalePrice = entry.wholesaleSalePrice;
      }
      if (Object.keys(vData).length > 0) {
        ops.push(prisma.productVariant.update({ where: { id: entry.variantId }, data: vData }));
      }
    }

    // Variantes que la campaña escribió en una pasada anterior y que AHORA están desactivadas: no
    // vienen en `plan` porque acá solo se leen las activas. Si no las arrastráramos, se perderían del
    // registro y al terminar la campaña su precio de oferta quedaría pegado — reapareciendo apenas
    // alguien vuelva a activar esa variante. Se conservan en el registro sin volver a escribirlas.
    const activeVariantIds = new Set(product.variants.map((v) => v.id));
    const carriedVariants = (Array.isArray(item.appliedVariants) ? item.appliedVariants : [])
      .filter((e) => !activeVariantIds.has(e.variantId));
    const recordedVariants = [...plan.variants, ...carriedVariants];

    // Registro de lo que la campaña se adjudica (aunque esta pasada no haya emitido UPDATE porque
    // el valor ya estaba bien): es lo que después permite revertir sin pisar cambios manuales.
    //
    // Antes este UPDATE se emitía SIEMPRE, una vez por producto y por pasada. Como el cron corre cada
    // minuto, una campaña de 300 productos escribía 300 filas por minuto (432.000 por día) sin que
    // nada hubiera cambiado. Ahora se compara contra lo ya guardado y solo se escribe si difiere.
    const recordChanged =
      !sameRecordValue(item.appliedSalePrice, plan.salePrice) ||
      !sameRecordValue(item.appliedWholesaleSalePrice, plan.wholesaleSalePrice) ||
      (item.skippedReason || null) !== (plan.skippedReason || null) ||
      variantsKey(item.appliedVariants) !== variantsKey(recordedVariants);

    if (recordChanged) {
      ops.push(
        prisma.offerItem.update({
          where: { id: item.id },
          data: {
            appliedSalePrice:          plan.salePrice,
            appliedWholesaleSalePrice: plan.wholesaleSalePrice,
            appliedVariants:           recordedVariants.length > 0 ? recordedVariants : null,
            skippedReason:             plan.skippedReason,
          },
        })
      );
    }

    if (plan.touched) applied++;
    if (plan.skippedReason) skipped++;
  }

  // Antes: ops.push(prisma.offer.update(... { applied: true })) sin condición — otra escritura por
  // minuto que casi nunca cambiaba nada. Solo se marca cuando realmente pasa de no-aplicada a aplicada.
  if (!offer.applied) {
    ops.push(prisma.offer.update({ where: { id: offerId }, data: { applied: true } }));
  }
  await runChunked(ops);

  return { applied, skipped };
}

// Saca los precios de oferta que escribió la campaña. Un campo vuelve a null SOLO si su valor actual
// sigue siendo el que escribimos: si el admin lo cambió a mano mientras la campaña corría, se respeta
// su cambio y no se toca.
//
// OJO: igual que applyOffer, va envuelta en withOfferLock() por quien la llama.
async function revertOffer(offerId) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { items: true } });
  if (!offer) return { reverted: 0 };

  const productIds = offer.items.map((i) => i.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { variants: true },
      })
    : [];

  const ops = [];
  let reverted = 0;

  for (const item of offer.items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;

    const data = {};
    if (sameMoney(product.salePrice, item.appliedSalePrice)) data.salePrice = null;
    if (sameMoney(product.wholesaleSalePrice, item.appliedWholesaleSalePrice)) data.wholesaleSalePrice = null;
    if (Object.keys(data).length > 0) {
      ops.push(prisma.product.update({ where: { id: product.id }, data }));
      reverted++;
    }

    const appliedVariants = Array.isArray(item.appliedVariants) ? item.appliedVariants : [];
    for (const entry of appliedVariants) {
      const variant = product.variants.find((v) => v.id === entry.variantId);
      if (!variant) continue;
      const vData = {};
      if (sameMoney(variant.salePrice, entry.salePrice)) vData.salePrice = null;
      if (sameMoney(variant.wholesaleSalePrice, entry.wholesaleSalePrice)) vData.wholesaleSalePrice = null;
      if (Object.keys(vData).length > 0) {
        ops.push(prisma.productVariant.update({ where: { id: variant.id }, data: vData }));
        reverted++;
      }
    }

    // Solo se limpia el registro si tenía algo — mismo criterio que en applyOffer: no emitir UPDATEs
    // que no cambian nada.
    const hadRecord =
      item.appliedSalePrice != null ||
      item.appliedWholesaleSalePrice != null ||
      item.skippedReason != null ||
      (Array.isArray(item.appliedVariants) && item.appliedVariants.length > 0);

    if (hadRecord) {
      ops.push(
        prisma.offerItem.update({
          where: { id: item.id },
          data: {
            appliedSalePrice: null,
            appliedWholesaleSalePrice: null,
            appliedVariants: null,
            skippedReason: null,
          },
        })
      );
    }
  }

  ops.push(prisma.offer.update({ where: { id: offerId }, data: { applied: false } }));
  await runChunked(ops);

  return { reverted };
}

// Deja una campaña en el estado que le corresponde según el reloj y su flag `active`.
// Es la función que hay que llamar después de crear/editar/pausar una campaña.
//
// OJO: NO toma el candado. Se usa así a propósito: el controller necesita encerrar TODA su secuencia
// (revertir → guardar → sincronizar) en un solo candado, y si esta función tomara el suyo se
// trabaría a sí misma. Desde afuera del service se entra por syncOfferSafe() o por withOfferLock().
async function syncOffer(offerId) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) return null;

  if (shouldBeApplied(offer)) {
    // Se re-aplica aunque ya esté applied: la pasada es idempotente y así entran las variantes
    // nuevas o los precios base editados mientras la campaña corría.
    const r = await applyOffer(offer.id);
    return { state: "ACTIVA", ...r };
  }
  if (offer.applied) {
    const r = await revertOffer(offer.id);
    return { state: offerState(offer), ...r };
  }
  return { state: offerState(offer) };
}

// Versión "de afuera": sincroniza una campaña tomando el candado. Es la puerta de entrada para el
// cron y para el botón "Sincronizar ahora" del panel.
const syncOfferSafe = (offerId) => withOfferLock(offerId, () => syncOffer(offerId));

// Job: recorre las campañas que necesitan atención y las sincroniza. Se saltea las FINALIZADAS que
// ya fueron revertidas (applied=false), que con el tiempo van a ser la mayoría.
//
// El cron lo dispara cada minuto. Dos pasadas no se pisan entre sí: cada campaña entra por
// syncOfferSafe(), así que si una pasada todavía está trabajando sobre la campaña 5, la siguiente
// espera su turno en vez de escribir los mismos precios en paralelo.
async function syncOffers() {
  try {
    const offers = await prisma.offer.findMany({
      where: {
        OR: [
          { applied: true },                                       // puede necesitar revertirse o re-aplicarse
          { active: true, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } }, // debería estar aplicada
        ],
      },
      select: { id: true },
    });
    for (const { id } of offers) {
      // Antes: await syncOffer(id).catch(...) — sin candado, podía cruzarse con una edición del admin.
      await syncOfferSafe(id).catch((e) =>
        console.error(`[CRON][offers] Error sincronizando campaña ${id}:`, e.message)
      );
    }
  } catch (err) {
    console.error("[CRON][offers] Error en syncOffers:", err.message);
  }
}

// ── Reajuste del registro cuando los precios se mueven por afuera ─────────────

// PROBLEMA QUE RESUELVE: la campaña reconoce sus precios porque anota el número exacto que escribió
// ("al producto 47 le puse 8.000"). El ajuste masivo por porcentaje de product.controller.js escala
// el precio normal Y el precio de oferta (10.000→11.000 y 8.000→8.800), pero no esa anotación.
// Resultado: la campaña ve 8.800 donde anotó 8.000, concluye "esto lo cargaron a mano", suelta el
// producto y AL TERMINAR NO LO REVIERTE. El descuento queda pegado para siempre.
//
// Solución: escalar la anotación con el mismo factor y redondeo que el ajuste, para que la campaña
// siga reconociendo el precio como propio. Después conviene correr syncOffers(): con el descuento
// por porcentaje el número escalado ya coincide, pero con uno de monto fijo no (a $11.000 hay que
// restarle $5.000 = $6.000, no escalar los $5.000 viejos), así que la pasada lo recalcula sobre la
// base nueva y lo corrige.
//
// Solo toca los campos del PRODUCTO porque el ajuste masivo solo escribe productos, no variantes.
async function rescaleAppliedPrices(factor, { retail = true, wholesale = true } = {}) {
  if (!(factor > 0) || factor === 1) return { rescaled: 0 };

  const items = await prisma.offerItem.findMany({
    // Antes: where: { offer: { applied: true } }   ← sin filtrar por moneda
    // El ajuste masivo solo mueve los precios de los productos en ARS (bulkPriceAdjust filtra por
    // currency: "ARS"). Si acá escaláramos también la anotación de los productos en USD, les
    // estaríamos corriendo el número de referencia sin que su precio real se haya movido: la campaña
    // vería 88 donde el producto sigue en 80, lo tomaría por "oferta cargada a mano" y no se lo
    // revertiría nunca. Es el mismo descuento pegado que esta función viene a evitar, pero al revés.
    // (Un producto en USD sí puede estar en campaña: currencyBlocked solo excluye los descuentos
    // FIXED, los de porcentaje se aplican normal.)
    where: { offer: { applied: true }, product: { currency: "ARS" } },
    select: { id: true, appliedSalePrice: true, appliedWholesaleSalePrice: true },
  });

  const ops = [];
  for (const it of items) {
    const data = {};
    if (retail && it.appliedSalePrice != null) {
      data.appliedSalePrice = round2(it.appliedSalePrice * factor);
    }
    if (wholesale && it.appliedWholesaleSalePrice != null) {
      data.appliedWholesaleSalePrice = round2(it.appliedWholesaleSalePrice * factor);
    }
    if (Object.keys(data).length > 0) {
      ops.push(prisma.offerItem.update({ where: { id: it.id }, data }));
    }
  }
  await runChunked(ops);
  return { rescaled: ops.length };
}

// ── Preview para el admin ─────────────────────────────────────────────────────

// Qué le va a pasar a cada producto si se guarda la campaña con estos parámetros. Usa el MISMO
// planificador que applyOffer, así el preview no puede mentir.
// offerLike: { discountType, discountValue, appliesTo }. offerId opcional: si se está editando una
// campaña ya aplicada, sus propias escrituras previas no cuentan como "oferta manual".
async function previewOffer(offerLike, productIds, offerId = null) {
  if (!Array.isArray(productIds) || productIds.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { variants: { where: { active: true } } },
  });

  const prevItems = offerId
    ? await prisma.offerItem.findMany({ where: { offerId, productId: { in: productIds } } })
    : [];

  return products.map((product) => {
    const prev = prevItems.find((i) => i.productId === product.id) || null;
    const plan = planProduct(offerLike, product, prev);
    return {
      productId: product.id,
      name: product.name,
      image: product.images?.[0] || null,
      currency: product.currency || "ARS",
      price: product.price,
      wholesalePrice: product.wholesalePrice,
      // Precio resultante (null = ese lado no se toca)
      newSalePrice: plan.salePrice,
      newWholesaleSalePrice: plan.wholesaleSalePrice,
      variantsAffected: plan.variants.length,
      skippedReason: plan.skippedReason,
      touched: plan.touched,
    };
  });
}

module.exports = {
  // Candado: envolver acá cualquier secuencia que escriba precios de campaña desde afuera
  withOfferLock,
  // Internas — SIN candado (quien las llama tiene que tenerlo tomado)
  applyOffer,
  revertOffer,
  syncOffer,
  // Con candado — puerta de entrada para el cron y los handlers
  syncOfferSafe,
  syncOffers,
  rescaleAppliedPrices,
  previewOffer,
  offerState,
  shouldBeApplied,
  calcOfferPrice,
  planProduct,
};
