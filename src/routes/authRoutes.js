// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// ⬇️ import upload จากบริการอัปโหลด
const { upload } = require("../services/upload");

// สมัครสมาชิก (รองรับไฟล์ field ชื่อ "image")
router.post("/register", upload.single("image"), authController.register);

// เข้าสู่ระบบ (ไม่มีไฟล์)
router.post("/login", authController.login);

module.exports = router;
