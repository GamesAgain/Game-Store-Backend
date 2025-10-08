// routes/gameRoutes.js
const express = require("express");
const router = express.Router();
const gameController = require("../controllers/gameController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// ⬇️ ใช้ multer จากบริการอัปโหลด (รับหลายไฟล์ field: "images")
const { upload } = require("../services/upload");


// อ่านรายการเกม
router.get("/", gameController.list);

// ดึง game_type
router.get("/types", gameController.listGameTypes); // GET /api/game/types
// ...

// อ่านรายละเอียดเกมตาม gid
router.get("/:gid", gameController.getById);

// หมวดหมู่ของเกม
router.get("/:gid/categories", gameController.getCategoriesByGame);

// รูปทั้งหมดของเกม
router.get("/:gid/images", gameController.getImagesByGame);

// สร้างเกม (JSON-only)
router.post("/", authMiddleware, gameController.create);

// ✅ สร้างเกมแบบรวมไฟล์/หมวด (multipart form-data: images[])
router.post(
  "/with-media",
  authMiddleware,
  upload.array("images", 8),
  gameController.createWithMedia
);

// อัปเดตทั้งก้อน (JSON-only)
router.put("/:gid", authMiddleware, gameController.update);

// ✅ อัปเดตพร้อมไฟล์/หมวด (multipart form-data: images[])
router.put(
  "/:gid/with-media",
  authMiddleware,
  upload.array("images", 8),
  gameController.updateWithMedia
);

// อัปเดตบางฟิลด์ (JSON-only)
router.patch("/:gid", authMiddleware, gameController.partialUpdate);

// ลบเกม
router.delete("/:gid", authMiddleware, gameController.remove);



module.exports = router;
