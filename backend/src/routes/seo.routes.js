const express = require("express");
const { getSitemap, getProductFeed, getProductOgPage } = require("../controllers/seo.controller");

const router = express.Router();

router.get("/sitemap.xml", getSitemap);
router.get("/feed.xml", getProductFeed);
// HTML de la ficha de producto con Open Graph (lo consume el nginx del VPS para /producto/*)
router.get("/og/producto/:slug", getProductOgPage);

module.exports = router;
