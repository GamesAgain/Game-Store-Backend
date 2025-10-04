// services/upload.js
const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");
const sharp = require("sharp");
require("dotenv").config();

// ---- Cloudinary config ----
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ---- Multer memory storage (10MB) ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    if (!ok) return cb(new Error("Only JPEG/PNG/WEBP allowed"));
    cb(null, true);
  },
});

// ---- Helpers ----
async function processImageToWebpSquare(inputBuffer, size = 512) {
  return await sharp(inputBuffer)
    .resize(size, size, { fit: "cover" })
    .toFormat("webp", { quality: 90 })
    .toBuffer();
}

async function uploadBufferToCloudinary(buffer, { folder = "images", filename } = {}) {
  return await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", format: "webp", public_id: filename },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

module.exports = {
  cloudinary,
  upload,
  processImageToWebpSquare,
  uploadBufferToCloudinary,
};
