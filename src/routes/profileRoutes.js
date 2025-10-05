// routes/profileRoutes.js
const express = require("express");
const router = express.Router();
const profileController = require("../controllers/profileController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// ใช้ตัวอัปโหลดเดียวกับ auth (field ชื่อ "image")
const { upload } = require("../services/upload");

/**
 * Base path แนะนำให้เมานต์เป็น /api/profile
 *
 * app.use('/api/profile', profileRoutes);
 *
 * => GET    /api/profile/me
 *    GET    /api/profile/           (ADMIN เท่านั้น: รายชื่อผู้ใช้ทั้งหมด)
 *    GET    /api/profile/:uid       (ADMIN หรือเจ้าของบัญชี)
 *    PUT    /api/profile/:uid       (ADMIN หรือเจ้าของบัญชี) รองรับไฟล์ field "image"
 *    DELETE /api/profile/:uid       (ADMIN หรือเจ้าของบัญชี)
 */

// โปรไฟล์ของตัวเอง
router.get("/me", authMiddleware, profileController.getMyProfile);

// รายชื่อผู้ใช้ทั้งหมด (ADMIN เท่านั้น)
router.get("/", authMiddleware, profileController.listUsers);

// รายละเอียดผู้ใช้ตาม uid (ADMIN หรือเจ้าของ)
router.get("/:uid", authMiddleware, profileController.getUserById);

// อัปเดตผู้ใช้ (ADMIN หรือเจ้าของ) — รองรับอัปโหลดรูป field "image"
router.put("/:uid", authMiddleware, upload.single("image"), profileController.updateUser);

// ลบผู้ใช้ (ADMIN หรือเจ้าของ) — ระวัง FK ของ orders (ON DELETE RESTRICT)
router.delete("/:uid", authMiddleware, profileController.deleteUser);

module.exports = router;
