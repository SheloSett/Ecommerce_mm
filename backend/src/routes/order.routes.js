const express = require("express");
const {
  getOrders, getOrder, createOrder, updateOrderStatus, updateOrderFields, getStats, getMetrics, deleteOrder,
  getMyOrders, getMyCotizaciones, getMyQuoteById,
  updateOrderItem, deleteOrderItem,
  publishCotizacion, approveCotizacion, cancelByCustomer, confirmCotizacionPayment,
  applyCouponToOrder, createManualOrder,
} = require("../controllers/order.controller");
const { authMiddleware, adminMiddleware, customerMiddleware } = require("../middleware/auth.middleware");
const { validateOrder } = require("../middleware/validate.middleware");

const router = express.Router();

// Pública: crear orden desde el checkout
router.post("/", validateOrder, createOrder);

// Cliente: ver su propio historial de pedidos aprobados
// IMPORTANTE: debe ir ANTES de /:id para que /my no sea interpretado como un ID
router.get("/my", authMiddleware, customerMiddleware, getMyOrders);

// Cliente MAYORISTA: ver sus cotizaciones enviadas
// IMPORTANTE: también debe ir ANTES de /:id
router.get("/my-quotes", authMiddleware, customerMiddleware, getMyCotizaciones);
// Cliente MAYORISTA: ver una cotización propia por ID (para la página de pago)
// IMPORTANTE: también debe ir ANTES de /:id
router.get("/my-quotes/:id", authMiddleware, customerMiddleware, getMyQuoteById);

// Admin: registrar una venta manual (presencial, por teléfono, etc.)
// IMPORTANTE: va antes de /:id para que /admin/manual no sea interpretado como un ID
router.post("/admin/manual", authMiddleware, adminMiddleware, createManualOrder);

// Admin: ver y gestionar órdenes
router.get("/stats", authMiddleware, adminMiddleware, getStats);
router.get("/metrics", authMiddleware, adminMiddleware, getMetrics);
router.get("/", authMiddleware, adminMiddleware, getOrders);
router.get("/:id", authMiddleware, adminMiddleware, getOrder);
router.patch("/:id/status", authMiddleware, adminMiddleware, updateOrderStatus);
// Admin: actualizar método de pago y/o estado de pedido (fulfillment)
router.patch("/:id/fields", authMiddleware, adminMiddleware, updateOrderFields);
// Admin: editar/eliminar un item individual de una cotización
router.patch("/:orderId/items/:itemId", authMiddleware, adminMiddleware, updateOrderItem);
router.delete("/:orderId/items/:itemId", authMiddleware, adminMiddleware, deleteOrderItem);
// Admin: publicar cambios al cliente (actualiza snapshot + notifica)
router.post("/:id/publish", authMiddleware, adminMiddleware, publishCotizacion);
// Admin: aprobar cotización
router.post("/:id/approve", authMiddleware, adminMiddleware, approveCotizacion);
// Cliente: cancelar su propia cotización con motivo
router.post("/:id/cancel-by-customer", authMiddleware, customerMiddleware, cancelByCustomer);
// Cliente MAYORISTA: confirmar pago manual de cotización (efectivo o transferencia)
router.post("/:id/confirm-payment", authMiddleware, customerMiddleware, confirmCotizacionPayment);
// Cliente MAYORISTA: aplicar cupón a una cotización aprobada antes de pagar
router.patch("/:id/apply-coupon", authMiddleware, customerMiddleware, applyCouponToOrder);
router.delete("/:id", authMiddleware, adminMiddleware, deleteOrder);

module.exports = router;
