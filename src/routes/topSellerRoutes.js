// routes/topSellerRoutes.js
const express = require("express");
const router = express.Router();
const topSellerController = require("../controllers/topSellerController");

// GET /api/top-sellers?date=YYYY-MM-DD
// - ไม่ระบุ date => Top 5 ตลอดเวลา
// - ระบุ date => Top 5 เฉพาะวันที่กำหนด (เทียบกับ orders.paid_at)
router.get("/", topSellerController.getTopSellers);

module.exports = router;
