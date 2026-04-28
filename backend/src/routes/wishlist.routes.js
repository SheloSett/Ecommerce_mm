const express = require("express");
const router = express.Router();
const { authMiddleware, customerMiddleware } = require("../middleware/auth.middleware");
const { getWishlist, addToWishlist, removeFromWishlist } = require("../controllers/wishlist.controller");

router.get(   "/",            authMiddleware, customerMiddleware, getWishlist);
router.post(  "/",            authMiddleware, customerMiddleware, addToWishlist);
router.delete("/:productId",  authMiddleware, customerMiddleware, removeFromWishlist);

module.exports = router;
