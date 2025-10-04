// controllers/authController.js
const bcrypt = require("bcrypt");
const db = require("../config/db");
const { generateToken } = require("../utils/jwt");

// ⬇️ เพิ่มบรรทัดนี้ (ไม่ต้อง import upload ที่นี่)
const { processImageToWebpSquare, uploadBufferToCloudinary } = require("../services/upload");

function send500(res, err) {
  return res.status(500).json({ success: false, message: err?.message || String(err) });
}

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
    const [dup] = await db.query(
      "SELECT 1 FROM users WHERE username = ? OR email = ? LIMIT 1",
      [username, email]
    );
    if (dup.length > 0) {
      return res.json({ success: false, message: "Username หรือ Email ถูกใช้งานแล้ว" });
    }

    // ⬇️ อัปโหลดรูป (optional) — ถ้าไฟล์พังจะข้ามและสมัครต่อ
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
      user,
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.json({ success: false, message: "Username หรือ Email ถูกใช้งานแล้ว" });
    }
    return send500(res, err);
  }
};

// login เดิมคงไว้…


/**
 * POST /api/auth/login
 * body: { username, email, password }  // provide either username or email
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

    // Look up by username OR email (email case-insensitive)
    const [rows] = await db.query(
      `SELECT uid, username, email, password_hash, img, role, wallet_balance, created_at
       FROM users
       WHERE username = ? OR email = ?
       LIMIT 1`,
      [identity, identityLower]
    );

    if (rows.length === 0) {
      return res.json({ success: false, message: "ไม่พบผู้ใช้" });
    }

    const userRow = rows[0];

    const ok = await bcrypt.compare(password, userRow.password_hash);
    if (!ok) {
      return res.json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
    }

    // Do not return password_hash
    const { password_hash, ...safeUser } = userRow;

    const token = generateToken({
      uid: safeUser.uid,
      username: safeUser.username,
      role: safeUser.role, // 'USER' or 'ADMIN'
    });

    return res.json({
      success: true,
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user: safeUser,
    });
  } catch (err) {
    return send500(res, err);
  }
};
