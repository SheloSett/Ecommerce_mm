const express = require("express");
const router = express.Router();
const { listAdmins, createAdmin, updateAdmin, deleteAdmin, resetPassword } = require("../controllers/adminUsers.controller");
const { authMiddleware, superAdminMiddleware } = require("../middleware/auth.middleware");

// Todas las rutas requieren SUPERADMIN
router.use(authMiddleware, superAdminMiddleware);

router.get("/",                          listAdmins);
router.post("/",                         createAdmin);
router.put("/:id",                       updateAdmin);
router.delete("/:id",                    deleteAdmin);
router.patch("/:id/reset-password",      resetPassword);

module.exports = router;
