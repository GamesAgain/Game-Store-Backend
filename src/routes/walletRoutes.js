const express = require("express");
const router = express.Router();
const walletController = require("../controllers/walletController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// ----- Balance -----
router.get("/balance", authMiddleware, walletController.getMyBalance);          // ของตัวเอง
router.get("/balance/:uid", authMiddleware, walletController.getBalanceByUid);  // ADMIN ดูของคนอื่น

// ----- Transactions -----
router.get("/transactions", authMiddleware, walletController.getMyTransactions);
router.get("/transactions/:uid", authMiddleware, walletController.getTransactionsByUid);

// ----- Create a raw transaction (self only) -----
router.post("/transactions", authMiddleware, walletController.createTransaction);

// ----- Money operations -----
router.post("/topup", authMiddleware, walletController.topup);
router.post("/withdraw", authMiddleware, walletController.withdraw);
router.post("/transfer", authMiddleware, walletController.transfer);

module.exports = router;
