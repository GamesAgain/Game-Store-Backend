const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { authMiddleware, verifyAdmin } = require("../middlewares/authMiddleware");

// reset db
router.delete("/reset", authMiddleware, verifyAdmin, adminController.resetSystem);

module.exports = router;