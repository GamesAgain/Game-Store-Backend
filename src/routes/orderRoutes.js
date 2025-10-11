// Version 0.1.0
const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// === Orders (Cart) CRUD ===
// สร้างออเดอร์ (DRAFT) — ถ้ามี DRAFT ของผู้ใช้อยู่แล้วจะคืนตัวนั้นกลับ (กันซ้ำ)
router.post("/", authMiddleware, orderController.createDraftOrder);

// ดูรายการออเดอร์ของผู้ใช้ (option: ?status=DRAFT|PAID)
router.get("/", authMiddleware, orderController.listMyOrders);

// ดูรายละเอียดออเดอร์ (รวม items)
router.get("/:oid", authMiddleware, orderController.getOrderDetail);

// อัปเดตออเดอร์ (เฉพาะ DRAFT): อนุญาตแก้ไข pid (ตั้ง/เอาออก), หรือสั่ง recalc
router.patch("/:oid", authMiddleware, orderController.updateDraftOrder);

// ลบออเดอร์ (เฉพาะ DRAFT) — cart_item จะถูกลบแบบ CASCADE ตาม FK
router.delete("/:oid", authMiddleware, orderController.deleteDraftOrder);

// === Items in Cart ===
// ดูรายการ items ในออเดอร์
router.get("/:oid/items", authMiddleware, orderController.listItems);

// เพิ่มเกมลงตะกร้า (unit_price จะคัดลอกราคาปัจจุบันของเกม)
router.post("/:oid/items", authMiddleware, orderController.addItem);

// ลบเกมออกจากตะกร้า
router.delete("/:oid/items/:gid", authMiddleware, orderController.removeItem);

// === Promotion & Totals ===
// ใส่โค้ดโปรโมชัน (ตรวจช่วงเวลา, ยังไม่หัก usage จนกว่าจะจ่ายเงิน)
router.post("/:oid/apply-promo", authMiddleware, orderController.applyPromoCode);

// เคลียร์โปรโมชันออก
router.post("/:oid/clear-promo", authMiddleware, orderController.clearPromo);

// คำนวณยอดใหม่ (subtotal, discount, total_after) และอัปเดตลง orders
router.post("/:oid/recalculate", authMiddleware, orderController.recalculateTotals);

// === Payment ===
// ชำระเงิน: ตรวจ wallet, ล็อกแถว, หัก wallet_balance, บันทึก wallet_transaction,
// เปลี่ยนสถานะเป็น PAID และตั้ง paid_at = NOW(), บันทึก promotion_redemption (ถ้ามี)
router.post("/:oid/pay", authMiddleware, orderController.payOrder);

// === Buy Now (สร้างออเดอร์ + ใส่สินค้า + จ่ายเงิน ในครั้งเดียว) ===
router.post("/buy", authMiddleware, orderController.buyNow);

module.exports = router;
