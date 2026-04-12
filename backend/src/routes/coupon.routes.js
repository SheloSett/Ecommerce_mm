const express = require("express");
const { validateCoupon, getCoupons, createCoupon, updateCoupon, deleteCoupon, getCouponUsages } = require("../controllers/coupon.controller");
const { authMiddleware, adminMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

// Pública: validar un cupón desde el checkout
router.post("/validate", validateCoupon);

// Admin: CRUD de cupones
router.get("/", authMiddleware, adminMiddleware, getCoupons);
router.post("/", authMiddleware, adminMiddleware, createCoupon);
router.patch("/:id", authMiddleware, adminMiddleware, updateCoupon);
router.delete("/:id", authMiddleware, adminMiddleware, deleteCoupon);
router.get("/:id/usages", authMiddleware, adminMiddleware, getCouponUsages);

module.exports = router;
