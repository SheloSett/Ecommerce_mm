const express = require("express");
const {
  getAudience,
  searchCustomers,
  previewEmail,
  sendTestEmail,
  createCustomBroadcast,
  announceOfferNow,
  sendOfferToSelected,
  listBroadcasts,
  getBroadcast,
  listRecipients,
  cancelBroadcastNow,
  getEmailSettings,
  updateEmailSettings,
} = require("../controllers/email.controller");
const { authMiddleware, adminMiddleware, requirePermission } = require("../middleware/auth.middleware");

// Admin → Emails. Todo exige el permiso "emails" (el SUPERADMIN siempre lo tiene): mandar un email
// a todos los clientes no es algo que cualquier usuario del panel tenga que poder hacer.
const router = express.Router();
router.use(authMiddleware, adminMiddleware, requirePermission("emails"));

router.get("/audience", getAudience);
router.get("/customers", searchCustomers);
router.post("/preview", previewEmail);
router.post("/test", sendTestEmail);
router.get("/settings", getEmailSettings);
router.put("/settings", updateEmailSettings);
router.get("/broadcasts", listBroadcasts);
router.post("/broadcasts", createCustomBroadcast);
router.get("/broadcasts/:id", getBroadcast);
router.get("/broadcasts/:id/recipients", listRecipients);
router.post("/broadcasts/:id/cancel", cancelBroadcastNow);
router.post("/offers/:id/announce", announceOfferNow);
router.post("/offers/:id/send", sendOfferToSelected); // a clientes elegidos

module.exports = router;
