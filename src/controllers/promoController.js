// controllers/promoController.js
// Version 0.1.0
const db = require("../config/db"); // mysql2/promise pool

const send500 = (res, err) =>
  res.status(500).json({ success: false, message: err?.message || String(err) });

const toInt = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
};

function parseDateInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

/** auto-expire เมื่อใช้ครบ */
async function autoExpireIfExhausted(conn, promo) {
  if (!promo) return;
  if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) {
    // หากยังไม่หมดอายุ ให้ทำให้หมดอายุทันที
    const [[{ now }]] = await conn.query(`SELECT NOW() AS now`);
    const nowDt = new Date(now);
    if (new Date(promo.expires_at) > nowDt) {
      await conn.query(`UPDATE promotion SET expires_at = ? WHERE pid = ?`, [nowDt, promo.pid]);
    }
  }
}

/* ================== USER ================== */

/** POST /promo/validate  { code } */
exports.validateCode = async (req, res) => {
  const uid = req.user?.uid;
  const code = String(req.body?.code || req.body?.promoCode || "").trim();

  if (!code) return res.status(400).json({ success: false, message: "กรุณาระบุโค้ด" });

  try {
    const result = await db.getConnection().then(async (conn) => {
      try {
        const [[p]] = await conn.query(
          `SELECT pid, code, description, discount_type, discount_value, max_uses, used_count, starts_at, expires_at
             FROM promotion
            WHERE code = ?
            LIMIT 1`,
          [code]
        );
        if (!p) return { ok: false, message: "ไม่พบโค้ด" };

        // window time
        const [[{ now }]] = await conn.query(`SELECT NOW() AS now`);
        const nowDt = new Date(now);
        if (!(new Date(p.starts_at) <= nowDt && nowDt <= new Date(p.expires_at))) {
          return { ok: false, message: "โค้ดหมดอายุ/ยังไม่เริ่ม" };
        }

        // max uses
        if (p.max_uses > 0 && p.used_count >= p.max_uses) {
          await autoExpireIfExhausted(conn, p);
          return { ok: false, message: "โค้ดถูกใช้ครบสิทธิ์แล้ว" };
        }

        // one per account
        if (uid) {
          const [[dup]] = await conn.query(
            `SELECT 1 FROM promotion_redemption WHERE pid = ? AND uid = ? LIMIT 1`,
            [p.pid, uid]
          );
          if (dup) return { ok: false, message: "บัญชีของคุณใช้โค้ดนี้ไปแล้ว" };
        }

        return { ok: true, promo: p };
      } finally {
        conn.release();
      }
    });

    if (!result.ok) return res.json({ success: false, message: result.message });
    return res.json({ success: true, promo: result.promo });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /promo/me/redemptions */
exports.listMyRedemptions = async (req, res) => {
  const uid = req.user?.uid;
  try {
    const [rows] = await db.query(
      `SELECT pr.prid, pr.pid, pr.oid, pr.redeemed_at, p.code, p.description
         FROM promotion_redemption pr
         JOIN promotion p ON p.pid = pr.pid
        WHERE pr.uid = ?
        ORDER BY pr.redeemed_at DESC, pr.prid DESC`,
      [uid]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /promo/public/active?q=... */
exports.listActivePublic = async (req, res) => {
  const q = String(req.query?.q || "").trim();
  try {
    const args = [];
    let where = `WHERE starts_at <= NOW() AND expires_at >= NOW()`;
    if (q) {
      where += ` AND (code LIKE ? OR description LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`);
    }
    const [rows] = await db.query(
      `SELECT pid, code, description, discount_type, discount_value, max_uses, used_count, starts_at, expires_at
         FROM promotion
       ${where}
       ORDER BY created_at DESC, pid DESC`,
      args
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return send500(res, err);
  }
};

/* ================== ADMIN ================== */

/** POST /promo  (create) */
exports.createPromo = async (req, res) => {
  const {
    code, description,
    discount_type, discount_value,
    max_uses = 0,
    starts_at, expires_at
  } = req.body || {};

  const type = String(discount_type || "").toUpperCase();
  const value = Number(discount_value);
  const start = parseDateInput(starts_at);
  const end = parseDateInput(expires_at);

  if (!code || !["PERCENT","FIXED"].includes(type) || !Number.isFinite(value) || value <= 0 || !start || !end) {
    return res.status(400).json({ success: false, message: "payload ไม่ถูกต้อง" });
  }

  try {
    const [r] = await db.query(
      `INSERT INTO promotion (code, description, discount_type, discount_value, max_uses, used_count, starts_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [code.trim().toUpperCase(), description || null, type, value, toInt(max_uses,0), start, end]
    );
    const [[promo]] = await db.query(`SELECT * FROM promotion WHERE pid = ?`, [r.insertId]);
    return res.status(201).json({ success: true, message: "สร้างโปรสำเร็จ", promo });
  } catch (err) {
    // duplicate code
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "รหัสโค้ดซ้ำ (code ต้องไม่ซ้ำ)" });
    }
    return send500(res, err);
  }
};

/** PATCH /promo/:pid  (update any fields) */
exports.updatePromo = async (req, res) => {
  const pid = Number(req.params.pid);
  if (!pid) return res.status(400).json({ success: false, message: "pid ไม่ถูกต้อง" });

  // field ที่อนุญาต
  const allow = ["code","description","discount_type","discount_value","max_uses","starts_at","expires_at"];
  const sets = [];
  const args = [];

  for (const k of allow) {
    if (req.body[k] !== undefined) {
      if (k === "discount_type") {
        const t = String(req.body[k]).toUpperCase();
        if (!["PERCENT","FIXED"].includes(t)) return res.status(400).json({ success: false, message: "discount_type ไม่ถูกต้อง" });
        sets.push(`${k} = ?`); args.push(t);
      } else if (k === "discount_value") {
        const v = Number(req.body[k]); if (!Number.isFinite(v) || v <= 0) return res.status(400).json({ success: false, message: "discount_value ไม่ถูกต้อง" });
        sets.push(`${k} = ?`); args.push(v);
      } else if (k === "max_uses") {
        sets.push(`${k} = ?`); args.push(Math.max(0, toInt(req.body[k], 0)));
      } else if (k === "starts_at" || k === "expires_at") {
        const d = parseDateInput(req.body[k]); if (!d) return res.status(400).json({ success: false, message: `${k} ไม่ถูกต้อง` });
        sets.push(`${k} = ?`); args.push(d);
      } else if (k === "code") {
        sets.push(`${k} = ?`); args.push(String(req.body[k]).trim().toUpperCase());
      } else {
        sets.push(`${k} = ?`); args.push(req.body[k]);
      }
    }
  }
  if (sets.length === 0) return res.json({ success: false, message: "ไม่มีฟิลด์ให้แก้ไข" });

  try {
    await db.query(`UPDATE promotion SET ${sets.join(", ")} WHERE pid = ?`, [...args, pid]);
    const [[promo]] = await db.query(`SELECT * FROM promotion WHERE pid = ?`, [pid]);
    return res.json({ success: true, message: "อัปเดตโปรสำเร็จ", promo });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "รหัสโค้ดซ้ำ (code ต้องไม่ซ้ำ)" });
    }
    return send500(res, err);
  }
};

/** DELETE /promo/:pid — ถ้ามีการใช้งานแล้วให้ soft-deactivate */
exports.deleteOrDeactivate = async (req, res) => {
  const pid = Number(req.params.pid);
  if (!pid) return res.status(400).json({ success: false, message: "pid ไม่ถูกต้อง" });

  try {
    const conn = await db.getConnection();
    try {
      const [[p]] = await conn.query(`SELECT * FROM promotion WHERE pid = ?`, [pid]);
      if (!p) { conn.release(); return res.status(404).json({ success: false, message: "ไม่พบโปรโมชัน" }); }

      const [[used]] = await conn.query(`SELECT COUNT(*) AS c FROM promotion_redemption WHERE pid = ?`, [pid]);
      if (used.c > 0) {
        // soft: ทำให้หมดอายุทันที
        await conn.query(`UPDATE promotion SET expires_at = NOW() WHERE pid = ?`, [pid]);
        conn.release();
        return res.json({ success: true, message: "โปรถูกใช้แล้ว จึงทำการปิด (expire) แทนการลบ", softDeactivated: true });
      }

      // safe to delete
      await conn.query(`DELETE FROM promotion WHERE pid = ?`, [pid]);
      conn.release();
      return res.json({ success: true, message: "ลบโปรสำเร็จ" });
    } catch (e) {
      try { conn.release(); } catch {}
      throw e;
    }
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /promo — รายการโปร (admin) ?q=&activeOnly=1&page=1&pageSize=20 */
exports.listPromos = async (req, res) => {
  const q = String(req.query?.q || "").trim();
  const activeOnly = String(req.query?.activeOnly || "") === "1";
  const page = Math.max(1, toInt(req.query?.page, 1));
  const pageSize = Math.min(100, Math.max(1, toInt(req.query?.pageSize, 20)));
  const offset = (page - 1) * pageSize;

  try {
    const args = [];
    let where = `WHERE 1=1`;
    if (q) {
      where += ` AND (code LIKE ? OR description LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`);
    }
    if (activeOnly) {
      where += ` AND starts_at <= NOW() AND expires_at >= NOW()`;
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM promotion ${where}`,
      args
    );
    const [rows] = await db.query(
      `SELECT pid, code, description, discount_type, discount_value, max_uses, used_count, starts_at, expires_at, created_at
         FROM promotion
       ${where}
       ORDER BY created_at DESC, pid DESC
       LIMIT ? OFFSET ?`,
      [...args, pageSize, offset]
    );

    res.set("X-Total-Count", String(total));
    res.set("X-Page", String(page));
    res.set("X-Page-Size", String(pageSize));

    return res.json({ success: true, data: rows });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /promo/:pid — อ่านโปร */
exports.getPromo = async (req, res) => {
  const pid = Number(req.params.pid);
  try {
    const [[p]] = await db.query(`SELECT * FROM promotion WHERE pid = ?`, [pid]);
    if (!p) return res.status(404).json({ success: false, message: "ไม่พบโปรโมชัน" });
    return res.json({ success: true, promo: p });
  } catch (err) {
    return send500(res, err);
  }
};

/** POST /promo/:pid/deactivate — ปิดใช้งานทันที (หมดอายุ) */
exports.deactivatePromo = async (req, res) => {
  const pid = Number(req.params.pid);
  try {
    const [r] = await db.query(`UPDATE promotion SET expires_at = NOW() WHERE pid = ?`, [pid]);
    if (r.affectedRows === 0) return res.status(404).json({ success: false, message: "ไม่พบโปรโมชัน" });
    const [[p]] = await db.query(`SELECT * FROM promotion WHERE pid = ?`, [pid]);
    return res.json({ success: true, message: "ปิดโปรเรียบร้อย", promo: p });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /promo/:pid/redemptions — รายชื่อการใช้โปร */
exports.listRedemptionsByPromo = async (req, res) => {
  const pid = Number(req.params.pid);
  try {
    const [rows] = await db.query(
      `SELECT pr.prid, pr.uid, pr.oid, pr.redeemed_at,
              u.username, u.email
         FROM promotion_redemption pr
         JOIN users u ON u.uid = pr.uid
        WHERE pr.pid = ?
        ORDER BY pr.redeemed_at DESC, pr.prid DESC`,
      [pid]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return send500(res, err);
  }
};
