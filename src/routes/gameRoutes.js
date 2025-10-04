// routes/gameRoutes.js
const express = require("express");
const router = express.Router();
const gameController = require("../controllers/gameController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// อ่านรายการเกม (optional: filter/query/pagination ในภายหลัง)
router.get("/", gameController.list);

// อ่านรายละเอียดเกมตาม gid
router.get("/:gid", gameController.getById);

// สร้างเกมใหม่ (ควรจำกัดสิทธิ์เป็น ADMIN)
router.post("/", authMiddleware, gameController.create);

// อัปเดตทั้งก้อนไปที่ gid (PUT)
router.put("/:gid", authMiddleware, gameController.update);

// อัปเดตเป็นบางฟิลด์ (PATCH)
router.patch("/:gid", authMiddleware, gameController.partialUpdate);

// ลบเกมตาม gid
router.delete("/:gid", authMiddleware, gameController.remove);

module.exports = router;
