// routes/walletRoutes.js
const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const { authMiddleware } = require("../middlewares/authMiddleware");

/**
 * หมายเหตุเรื่องสิทธิ์:
 * - ทุกเส้นใช้ token ผ่าน authMiddleware
 * - ถ้าเป็น USER จะเห็นได้เฉพาะของตัวเอง
 * - ถ้าเป็น ADMIN จะส่ง uid ใครมาก็ได้
 */

// 3.1 ดูยอดคงเหลือกระเป๋า (ผู้ใช้/แอดมิน)
router.get("/balance/:uid?", authMiddleware, walletController.getUserBalance);

// 3.3/3.4 ประวัติเดินบัญชี (รองรับ paginate + filter วันเวลา)
router.get("/transactions/:uid?", authMiddleware, walletController.getUserTransactions);

// 3.2 เติมเงิน
router.post("/topup", authMiddleware, walletController.topup);

// ถอนเงิน (เผื่อใช้งานภายหลัง)
router.post("/withdraw", authMiddleware, walletController.withdraw);

// โอนเงิน user → user (อ้างปลายทางด้วย username)
router.post("/transfer", authMiddleware, walletController.transfer);

// low-level: สร้างทรานแซกชันแบบกำหนด type เอง (admin tool/ทดสอบ)
router.post("/transactions", authMiddleware, walletController.createTransaction);

module.exports = router;
