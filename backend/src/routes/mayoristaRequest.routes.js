const express = require("express");
const router = express.Router();
const {
  createRequest,
  getMyRequest,
  getAll,
  approveRequest,
  rejectRequest,
} = require("../controllers/mayoristaRequest.controller");
const { authMiddleware, adminMiddleware, customerMiddleware } = require("../middleware/auth.middleware");

// Rutas del cliente (requiere token de CUSTOMER)
router.post("/",      authMiddleware, customerMiddleware, createRequest);
router.get("/my",     authMiddleware, customerMiddleware, getMyRequest);

// Rutas del admin
router.get("/",                    authMiddleware, adminMiddleware, getAll);
router.patch("/:id/approve",       authMiddleware, adminMiddleware, approveRequest);
router.patch("/:id/reject",        authMiddleware, adminMiddleware, rejectRequest);

module.exports = router;
