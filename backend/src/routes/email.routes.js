const express = require("express");
const {
  getAudience,
  searchCustomers,
  previewEmail,
  sendTestEmail,
  createCustomBroadcast,
  announceOfferNow,
  sendOfferToSelected,
  listPromosForEmails,
  setPromoAutoAnnounce,
  announcePromoNow,
  sendPromoToSelected,
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
// Descuentos por monto (25/11/2026): mismo aviso que las campañas
router.get("/promos", listPromosForEmails);
router.put("/promos/:id/auto", setPromoAutoAnnounce);
router.post("/promos/:id/announce", announcePromoNow);
router.post("/promos/:id/send", sendPromoToSelected); // a clientes elegidos

module.exports = router;
