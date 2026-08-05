const express = require("express");
const { getSitemap, getProductFeed } = require("../controllers/seo.controller");

const router = express.Router();

router.get("/sitemap.xml", getSitemap);
router.get("/feed.xml", getProductFeed);

module.exports = router;
