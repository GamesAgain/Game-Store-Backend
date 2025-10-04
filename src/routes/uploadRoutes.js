// routes/upload.routes.js
const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const {
  upload,
  processImageToWebpSquare,
  uploadBufferToCloudinary,
} = require("../services/upload");

// อัปโหลดรูปเดียว: field name = "image"
router.post("/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file" });

    // 1) แปลงภาพเป็น webp สี่เหลี่ยม
    const webpBuf = await processImageToWebpSquare(req.file.buffer, 512);

    // 2) อัป Cloudinary
    const folder = req.body.folder || "gameshop/images";
    const result = await uploadBufferToCloudinary(webpBuf, { folder });

    // 3) (ออปชัน) บันทึก URL ลงฐานข้อมูล เช่นตาราง game_image
    //    ต้องมีตารางก่อน: game_image(imgid PK, gid FK, url, created_at)
    const gid = req.body.gid ? Number(req.body.gid) : null;
    if (gid) {
      const conn = await pool.getConnection();
      try {
        await conn.execute(
          "INSERT INTO game_image (gid, url, created_at) VALUES (?, ?, NOW())",
          [gid, result.secure_url]
        );
      } finally {
        conn.release();
      }
    }

    return res.json({
      success: true,
      public_id: result.public_id,
      url: result.secure_url,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || "Upload failed" });
  }
});

// อัปหลายรูป: field name = "images"
router.post("/images", upload.array("images", 8), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ success: false, message: "No files" });

    const folder = req.body.folder || "gameshop/images";
    const gid = req.body.gid ? Number(req.body.gid) : null;

    const results = [];
    for (const f of req.files) {
      const webpBuf = await processImageToWebpSquare(f.buffer, 512);
      const up = await uploadBufferToCloudinary(webpBuf, { folder });
      results.push({ url: up.secure_url, public_id: up.public_id });

      if (gid) {
        const conn = await pool.getConnection();
        try {
          await conn.execute(
            "INSERT INTO game_image (gid, url, created_at) VALUES (?, ?, NOW())",
            [gid, up.secure_url]
          );
        } finally {
          conn.release();
        }
      }
    }

    return res.json({ success: true, images: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || "Upload failed" });
  }
});

module.exports = router;
