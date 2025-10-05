// controllers/profileController.js
const bcrypt = require("bcrypt");
const db = require("../config/db");

// ใช้ util เดียวกับ auth สำหรับประมวลผล/อัปโหลดรูป
const { processImageToWebpSquare, uploadBufferToCloudinary } = require("../services/upload");

const send500 = (res, err) =>
  res.status(500).json({ success: false, message: err?.message || String(err) });

function isAdmin(req) {
  return (req.user?.role || "").toUpperCase() === "ADMIN";
}
function isSelf(req, uid) {
  return Number(req.user?.uid) === Number(uid);
}
function deny(res, msg = "ไม่มีสิทธิ์ทำรายการนี้") {
  return res.status(403).json({ success: false, message: msg });
}
function toBool(v) {
  if (v === true) return true;
  const s = String(v || "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

/** GET /profile/me */
exports.getMyProfile = async (req, res) => {
  const uid = req.user.uid;
  try {
    const [rows] = await db.query(
      `SELECT uid, username, email, img, role, wallet_balance, created_at
         FROM users
        WHERE uid = ?
        LIMIT 1`,
      [uid]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้" });
    }
    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /profile  (ADMIN) */
exports.listUsers = async (_req, res) => {
  if (!isAdmin(_req)) return deny(res);
  try {
    const [rows] = await db.query(
      `SELECT uid, username, email, img, role, wallet_balance, created_at
         FROM users
        ORDER BY created_at DESC, uid DESC`
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /profile/:uid (ADMIN หรือเจ้าของ) */
exports.getUserById = async (req, res) => {
  const uid = Number(req.params.uid);
  if (!isAdmin(req) && !isSelf(req, uid)) return deny(res);

  try {
    const [rows] = await db.query(
      `SELECT uid, username, email, img, role, wallet_balance, created_at
         FROM users
        WHERE uid = ?
        LIMIT 1`,
      [uid]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้" });
    }
    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    return send500(res, err);
  }
};

/** PUT /profile/:uid (ADMIN หรือเจ้าของ)
 * รองรับ:
 * - username, email
 * - new_password (+ current_password เมื่อเจ้าของแก้เอง)
 * - ADMIN เท่านั้น: role, wallet_balance
 * - อัปโหลดรูปใหม่ field "image" (multipart/form-data)
 * - ลบรูป: ส่ง remove_image=true (กรณีไม่ได้อัปโหลดใหม่)
 */
exports.updateUser = async (req, res) => {
  const targetUid = Number(req.params.uid);
  const actorIsAdmin = isAdmin(req);
  const actorIsSelf = isSelf(req, targetUid);

  if (!actorIsAdmin && !actorIsSelf) return deny(res);

  // รับค่าที่อนุญาต
  let {
    username,
    email,
    role,               // ADMIN เท่านั้น
    wallet_balance,     // ADMIN เท่านั้น
    new_password,       // ถ้าเจ้าของเปลี่ยนรหัส ควรส่ง current_password มาด้วย
    current_password,   // ใช้ยืนยันเมื่อเจ้าของเปลี่ยนรหัสผ่าน
    remove_image        // "true"/"1"/"yes" เพื่อลบรูปเดิม เมื่อไม่มีไฟล์ใหม่
  } = req.body || {};

  // ทำความสะอาดค่า
  if (typeof username === "string") username = username.trim();
  if (typeof email === "string") email = email.trim().toLowerCase();

  // โหลดข้อมูลเดิมก่อน
  try {
    const [[existing]] = await db.query(
      `SELECT uid, username, email, img, role, wallet_balance, password_hash
         FROM users
        WHERE uid = ?
        LIMIT 1`,
      [targetUid]
    );
    if (!existing) {
      return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้" });
    }

    // สร้างรายการ field ที่จะอัปเดตแบบไดนามิก
    const sets = [];
    const vals = [];
    const updatedFields = [];

    // ===== รูปโปรไฟล์ =====
    // 1) อัปโหลดใหม่ (ถ้ามีไฟล์)
    let imageUpdated = false;
    if (req.file?.buffer) {
      try {
        const webpBuf = await processImageToWebpSquare(req.file.buffer, 512);
        const up = await uploadBufferToCloudinary(webpBuf, {
          folder: "gameshop/users",
          filename: `u_${targetUid}_${Date.now()}`,
        });
        const imgUrl = up.secure_url || null;
        sets.push("img = ?");
        vals.push(imgUrl);
        updatedFields.push("img");
        imageUpdated = true;
      } catch (e) {
        // ถ้าอัปโหลดล้มเหลว ไม่ fail ทั้งคำสั่ง แค่ข้าม
        console.warn("⚠️ Upload avatar failed, skip image:", e?.message || e);
      }
    }
    // 2) ลบรูปเดิม (เฉพาะกรณีไม่ได้อัปโหลดใหม่)
    if (!imageUpdated && toBool(remove_image)) {
      sets.push("img = NULL");
      updatedFields.push("img");
    }

    // ===== username / email (เช็คซ้ำแบบไม่แคร์ตัวพิมพ์ใน email) =====
    const nextUsername = username ?? existing.username;
    const nextEmailLower = (email ?? existing.email).toLowerCase();

    const [dup] = await db.query(
      `SELECT 1
         FROM users
        WHERE (username = ? OR LOWER(email) = ?)
          AND uid <> ?
        LIMIT 1`,
      [nextUsername, nextEmailLower, targetUid]
    );
    if (dup.length > 0) {
      return res.json({ success: false, message: "Username หรือ Email ถูกใช้งานแล้ว" });
    }

    if (username !== undefined && username !== existing.username) {
      sets.push("username = ?");
      vals.push(username);
      updatedFields.push("username");
    }
    if (email !== undefined && nextEmailLower !== existing.email.toLowerCase()) {
      sets.push("email = ?");
      vals.push(nextEmailLower);
      updatedFields.push("email");
    }

    // ===== เปลี่ยนรหัสผ่าน =====
    if (new_password) {
      if (actorIsAdmin) {
        const newHash = await bcrypt.hash(new_password, 10);
        sets.push("password_hash = ?");
        vals.push(newHash);
        updatedFields.push("password_hash");
      } else if (actorIsSelf) {
        if (!current_password) {
          return res.json({ success: false, message: "กรุณาระบุ current_password" });
        }
        const ok = await bcrypt.compare(current_password, existing.password_hash);
        if (!ok) {
          return res.json({ success: false, message: "current_password ไม่ถูกต้อง" });
        }
        const newHash = await bcrypt.hash(new_password, 10);
        sets.push("password_hash = ?");
        vals.push(newHash);
        updatedFields.push("password_hash");
      }
    }

    // ===== ADMIN เท่านั้น: role, wallet_balance =====
    if (actorIsAdmin && role !== undefined) {
      const upRole = String(role).toUpperCase();
      if (upRole !== "USER" && upRole !== "ADMIN") {
        return res.json({ success: false, message: "role ไม่ถูกต้อง (USER|ADMIN)" });
      }
      if (upRole !== existing.role) {
        sets.push("role = ?");
        vals.push(upRole);
        updatedFields.push("role");
      }
    }

    if (actorIsAdmin && wallet_balance !== undefined) {
      const nb = Number(wallet_balance);
      if (!Number.isFinite(nb) || nb < 0) {
        return res.json({ success: false, message: "wallet_balance ไม่ถูกต้อง" });
      }
      if (nb !== Number(existing.wallet_balance)) {
        sets.push("wallet_balance = ?");
        vals.push(nb);
        updatedFields.push("wallet_balance");
      }
    }

    if (sets.length === 0) {
      // ไม่มีอะไรเปลี่ยน
      const [fresh] = await db.query(
        `SELECT uid, username, email, img, role, wallet_balance, created_at
           FROM users WHERE uid = ? LIMIT 1`,
        [targetUid]
      );
      return res.json({ success: true, message: "ไม่มีข้อมูลให้แก้ไข", user: fresh[0] });
    }

    // อัปเดต
    await db.query(`UPDATE users SET ${sets.join(", ")} WHERE uid = ?`, [...vals, targetUid]);

    // ส่งค่าล่าสุดกลับ
    const [rows] = await db.query(
      `SELECT uid, username, email, img, role, wallet_balance, created_at
         FROM users
        WHERE uid = ?
        LIMIT 1`,
      [targetUid]
    );
    return res.json({
      success: true,
      message: "อัปเดตข้อมูลผู้ใช้สำเร็จ",
      updated_fields: updatedFields,
      user: rows[0],
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.json({ success: false, message: "Username หรือ Email ถูกใช้งานแล้ว" });
    }
    return send500(res, err);
  }
};

/** DELETE /profile/:uid (ADMIN หรือเจ้าของ)
 *  หมายเหตุ: FK ของ orders ใช้ ON DELETE RESTRICT
 *  ถ้าผู้ใช้มี orders อยู่ การลบจะล้มเหลวด้วย ER_ROW_IS_REFERENCED_2 (1451)
 */
exports.deleteUser = async (req, res) => {
  const uid = Number(req.params.uid);
  if (!isAdmin(req) && !isSelf(req, uid)) return deny(res);

  try {
    const [del] = await db.query(`DELETE FROM users WHERE uid = ?`, [uid]);
    if (del.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้" });
    }
    return res.json({ success: true, message: "ลบผู้ใช้สำเร็จ" });
  } catch (err) {
    // FK restrict จาก orders
    if (err && (err.code === "ER_ROW_IS_REFERENCED_2" || err.errno === 1451)) {
      return res.status(409).json({
        success: false,
        message:
          "ไม่สามารถลบผู้ใช้ได้ เนื่องจากมีข้อมูลที่อ้างอิงอยู่ (เช่น orders). กรุณาจัดการคำสั่งซื้อก่อน",
      });
    }
    return send500(res, err);
  }
};
