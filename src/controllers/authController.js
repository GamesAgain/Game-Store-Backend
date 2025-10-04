// controllers/authController.js
const bcrypt = require("bcrypt");
const db = require("../config/db");
const { generateToken } = require("../utils/jwt");

// ไม่ต้อง import multer ที่นี่ ใช้เฉพาะ util สำหรับประมวลผลรูป
const { processImageToWebpSquare, uploadBufferToCloudinary } = require("../services/upload");

function send500(res, err) {
  return res.status(500).json({ success: false, message: err?.message || String(err) });
}

/**
 * POST /api/auth/register
 * form-data (optional file: avatar): { username, email, password, wallet? }
 */
exports.register = async (req, res) => {
  let { username, email, password, wallet } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: "กรุณากรอกข้อมูลให้ครบ" });
  }

  username = String(username).trim();
  email = String(email).trim().toLowerCase();

  const wallet_balance =
    wallet === undefined || wallet === null || wallet === "" ? 0 : Number(wallet);

  if (!Number.isFinite(wallet_balance) || wallet_balance < 0) {
    return res.json({ success: false, message: "ค่าเงินเริ่มต้นไม่ถูกต้อง" });
  }

  try {
    // กันซ้ำเบื้องต้น (แนะนำให้มี UNIQUE ใน DB ตาม schema อยู่แล้ว)
    const [dup] = await db.query(
      "SELECT 1 FROM users WHERE username = ? OR email = ? LIMIT 1",
      [username, email]
    );
    if (dup.length > 0) {
      return res.json({ success: false, message: "Username หรือ Email ถูกใช้งานแล้ว" });
    }

    // อัปโหลดรูปโปรไฟล์ (ถ้ามี) – หากล้มเหลวจะไม่บล็อกการสมัคร
    let imgUrl = null;
    if (req.file?.buffer) {
      try {
        const webpBuf = await processImageToWebpSquare(req.file.buffer, 512);
        const up = await uploadBufferToCloudinary(webpBuf, {
          folder: "gameshop/users",
          filename: `u_${Date.now()}`,
        });
        imgUrl = up.secure_url || null;
      } catch (e) {
        console.warn("⚠️ Upload avatar failed, continue without image:", e?.message || e);
      }
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      `INSERT INTO users (username, email, password_hash, img, role, wallet_balance)
       VALUES (?, ?, ?, ?, 'USER', ?)`,
      [username, email, password_hash, imgUrl, wallet_balance]
    );

    const uid = result.insertId;

    // ดึงข้อมูลกลับมายืนยัน
    const [rows] = await db.query(
      `SELECT uid, username, email, img, role, wallet_balance, created_at
       FROM users
       WHERE uid = ? LIMIT 1`,
      [uid]
    );

    const user = rows[0];

    const token = generateToken({
      uid: user.uid,
      username: user.username,
      role: user.role,
    });

    return res.json({
      success: true,
      message: "สมัครสมาชิกสำเร็จ",
      token,
      user, // มีฟิลด์ img กลับไปด้วย
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.json({ success: false, message: "Username หรือ Email ถูกใช้งานแล้ว" });
    }
    return send500(res, err);
  }
};

/**
 * POST /api/auth/login
 * body: { username?, email?, password }  // ใส่ username หรือ email อย่างใดอย่างหนึ่ง
 * response.user จะมี "img" เสมอ (ถ้าไม่มีรูปจะเป็น null)
 */
exports.login = async (req, res) => {
  const { username, email, password } = req.body || {};

  if ((!username && !email) || !password) {
    return res.status(400).json({
      success: false,
      message: "กรุณากรอก username/email และ password",
    });
  }

  try {
    const identity = (username || email || "").toString().trim();
    const identityLower = identity.toLowerCase();

    // ค้นหาจาก username แบบตรงตัว หรือ email แบบไม่แคร์ตัวพิมพ์
    const [rows] = await db.query(
      `SELECT uid, username, email, password_hash, img, role, wallet_balance, created_at
       FROM users
       WHERE username = ? OR LOWER(email) = ?
       LIMIT 1`,
      [identity, identityLower]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: "ไม่พบผู้ใช้" });
    }

    const row = rows[0];

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      return res.json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
    }

    // สร้างอ็อบเจ็กต์ user ที่ปลอดภัย และการันตีว่ามี key img
    const user = {
      uid: row.uid,
      username: row.username,
      email: row.email,
      img: row.img || null,           // ✅ การันตีส่งคืน img
      role: row.role,
      wallet_balance: row.wallet_balance,
      created_at: row.created_at,
    };

    const token = generateToken({
      uid: user.uid,
      username: user.username,
      role: user.role, // 'USER' | 'ADMIN'
    });

    return res.json({
      success: true,
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user,
    });
  } catch (err) {
    return send500(res, err);
  }
};
