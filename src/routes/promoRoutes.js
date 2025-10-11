// routes/promoRoutes.js
// Version 0.1.0
const express = require("express");
const router = express.Router();
const promoController = require("../controllers/promoController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// helper admin guard (บางโปรเจ็กต์คุณอาจมี middleware แยกอยู่แล้ว)
function adminOnly(req, res, next) {
  const u = req.user || {};
  const ok =
    (u.role && String(u.role).toUpperCase() === "ADMIN") ||
    u.is_admin === 1 ||
    u.isAdmin === true;
  if (!ok) return res.status(403).json({ success: false, message: "Admin only" });
  next();
}

/* ================== USER ================== */

// ตรวจสอบโค้ด ว่าใช้งานได้ไหม (คำนึงถึงวันเวลา, max_uses, การใช้ซ้ำต่อบัญชี)
router.post("/validate", authMiddleware, promoController.validateCode);

// ดูประวัติการใช้โค้ดของฉัน
router.get("/me/redemptions", authMiddleware, promoController.listMyRedemptions);

// (Public) ดูรายการโปรที่ยัง Active (optional: q=ค้นหา)
router.get("/public/active", promoController.listActivePublic);

/* ================== ADMIN ================== */

// สร้างโปรโมชั่น
router.post("/", authMiddleware, adminOnly, promoController.createPromo);

// แก้ไขโปรโมชั่น
router.patch("/:pid", authMiddleware, adminOnly, promoController.updatePromo);

// ลบโปรโมชั่น (หากมีการใช้งานแล้วจะทำ soft-deactivate แทน)
router.delete("/:pid", authMiddleware, adminOnly, promoController.deleteOrDeactivate);

// รายการโปรทั้งหมด (รองรับค้นหา/แบ่งหน้า/กรอง activeOnly)
router.get("/", authMiddleware, adminOnly, promoController.listPromos);

// อ่านรายละเอียดโปร 1 รายการ
router.get("/:pid", authMiddleware, adminOnly, promoController.getPromo);

// บังคับปิดโปร (หมดอายุทันที)
router.post("/:pid/deactivate", authMiddleware, adminOnly, promoController.deactivatePromo);

// รายชื่อการใช้โปรต่อโปร (ดู redemptions ของ pid)
router.get("/:pid/redemptions", authMiddleware, adminOnly, promoController.listRedemptionsByPromo);

module.exports = router;
