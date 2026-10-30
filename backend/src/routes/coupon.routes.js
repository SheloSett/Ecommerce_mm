const express = require("express");
const { validateCoupon, getCoupons, createCoupon, updateCoupon, deleteCoupon, getCouponUsages } = require("../controllers/coupon.controller");
const { authMiddleware, adminMiddleware, requireAnyPermission } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: validar un cupón desde el checkout
router.post("/validate", validateCoupon);

// Admin: CRUD de cupones
router.get("/", authMiddleware, adminMiddleware, requireAnyPermission("cupones"), getCoupons);
router.post("/", authMiddleware, adminMiddleware, requireAnyPermission("cupones", "clientes"), createCoupon);
router.patch("/:id", authMiddleware, adminMiddleware, requireAnyPermission("cupones"), updateCoupon);
router.delete("/:id", authMiddleware, adminMiddleware, requireAnyPermission("cupones"), deleteCoupon);
router.get("/:id/usages", authMiddleware, adminMiddleware, requireAnyPermission("cupones"), getCouponUsages);

module.exports = router;
