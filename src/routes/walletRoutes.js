// routes/walletRoutes.js
const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// ✅ ดึงยอดคงเหลือกระเป๋าเงินของผู้ใช้
router.get("/balance/:uid", authMiddleware, walletController.getUserBalance);

// ✅ ดึงรายการเดินบัญชีของผู้ใช้ (รองรับ paginate + filter วันที่)
router.get("/transactions/:uid", authMiddleware, walletController.getUserTransactions);

// ✅ สร้างรายการเดินบัญชี (amount เป็นจำนวนเต็ม: บวก=รับเงิน, ลบ=จ่ายเงิน)
//    จะอัปเดต Users.wallet พร้อมกันแบบ atomic
router.post("/transactions", authMiddleware, walletController.createTransaction);

// ------------------ New: Deposit / Withdraw / Transfer ------------------

// ✅ เติมเงินเข้ากระเป๋า
router.post("/topup", authMiddleware, walletController.topup);

// ✅ ถอนเงินออกจากกระเป๋า
router.post("/withdraw", authMiddleware, walletController.withdraw);

// ✅ โอนเงินจาก fromUid → toUid
router.post("/transfer", authMiddleware, walletController.transfer);

module.exports = router;
