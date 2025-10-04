// controllers/gameController.js
const db = require("../config/db"); // mysql2/promise createPool

// ---------- helpers ----------
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function toNullableDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : v; // ส่งกลับ 'YYYY-MM-DD' ที่ผู้ใช้ส่งมา ถ้าผ่านได้
}

async function validateGamePayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  // name
  if (!partial || body.name !== undefined) {
    if (!isNonEmptyString(body.name)) errors.push("name: ต้องเป็น string ไม่ว่าง");
    else data.name = body.name.trim();
  }

  // price (DECIMAL) — รับเป็น number หรือ string ที่ parse ได้
  if (!partial || body.price !== undefined) {
    if (body.price === undefined || body.price === null || body.price === "")
      errors.push("price: จำเป็น");
    else if (isNaN(Number(body.price)))
      errors.push("price: ต้องเป็นตัวเลข");
    else data.price = Number(body.price);
  }

  // tid (FK -> game_type)
  if (!partial || body.tid !== undefined) {
    if (body.tid === undefined || body.tid === null || body.tid === "")
      errors.push("tid: จำเป็น");
    else if (!Number.isInteger(Number(body.tid)))
      errors.push("tid: ต้องเป็นจำนวนเต็ม");
    else data.tid = Number(body.tid);
  }

  // description (optional)
  if (!partial || body.description !== undefined) {
    if (body.description === undefined || body.description === null)
      data.description = null;
    else if (typeof body.description !== "string")
      errors.push("description: ต้องเป็น string หรือ null");
    else data.description = body.description;
  }

  // released_at (DATE, optional)
  if (!partial || body.released_at !== undefined) {
    const d = toNullableDate(body.released_at);
    if (body.released_at !== undefined && d === null && body.released_at !== null && body.released_at !== "")
      errors.push("released_at: รูปแบบวันต้องเป็น YYYY-MM-DD หรือปล่อยว่าง");
    else data.released_at = d; // อนุญาต null
  }

  // rank_score (INT, optional; default 0)
  if (!partial || body.rank_score !== undefined) {
    if (body.rank_score === undefined || body.rank_score === null || body.rank_score === "")
      data.rank_score = 0;
    else if (!Number.isInteger(Number(body.rank_score)))
      errors.push("rank_score: ต้องเป็นจำนวนเต็ม");
    else data.rank_score = Number(body.rank_score);
  }

  return { ok: errors.length === 0, errors, data };
}

async function ensureTypeExists(tid) {
  const [[row]] = await db.query(`SELECT 1 FROM game_type WHERE tid = ? LIMIT 1`, [tid]);
  return !!row;
}

// ---------- controllers ----------

// GET /games
exports.list = async (req, res) => {
  try {
    // เวอร์ชันเบสิค: คืนทั้งหมด (ต่อยอด pagination/filter ทีหลัง)
    const [rows] = await db.query(
      `SELECT gid, name, price, tid, description, released_at, rank_score, created_at, updated_at
       FROM game
       ORDER BY gid DESC`
    );
    // หมายเหตุ: DECIMAL(12,2) จะถูกส่งกลับเป็น string โดย mysql2 ตามค่าเริ่มต้น
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /games/:gid
exports.getById = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  try {
    const [[row]] = await db.query(
      `SELECT gid, name, price, tid, description, released_at, rank_score, created_at, updated_at
       FROM game WHERE gid = ? LIMIT 1`,
      [gid]
    );
    if (!row) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });
    return res.json({ success: true, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /games
exports.create = async (req, res) => {
  const { ok, errors, data } = await validateGamePayload(req.body, { partial: false });
  if (!ok) return res.status(400).json({ success: false, message: errors.join(", ") });

  try {
    // ตรวจ FK: tid ต้องมีใน game_type
    const typeOk = await ensureTypeExists(data.tid);
    if (!typeOk) return res.status(400).json({ success: false, message: "tid ไม่พบใน game_type" });

    const [result] = await db.query(
      `INSERT INTO game (name, price, tid, description, released_at, rank_score)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.name, data.price, data.tid, data.description, data.released_at, data.rank_score]
    );

    const gid = result.insertId;
    const [[row]] = await db.query(
      `SELECT gid, name, price, tid, description, released_at, rank_score, created_at, updated_at
       FROM game WHERE gid = ? LIMIT 1`,
      [gid]
    );
    return res.status(201).json({ success: true, message: "สร้างเกมสำเร็จ", gid, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /games/:gid (อัปเดตทุกฟิลด์)
exports.update = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  const { ok, errors, data } = await validateGamePayload(req.body, { partial: false });
  if (!ok) return res.status(400).json({ success: false, message: errors.join(", ") });

  try {
    // มีอยู่ไหม
    const [[exist]] = await db.query(`SELECT gid FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!exist) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    // ตรวจ FK
    const typeOk = await ensureTypeExists(data.tid);
    if (!typeOk) return res.status(400).json({ success: false, message: "tid ไม่พบใน game_type" });

    await db.query(
      `UPDATE game
       SET name = ?, price = ?, tid = ?, description = ?, released_at = ?, rank_score = ?
       WHERE gid = ?`,
      [data.name, data.price, data.tid, data.description, data.released_at, data.rank_score, gid]
    );

    const [[row]] = await db.query(
      `SELECT gid, name, price, tid, description, released_at, rank_score, created_at, updated_at
       FROM game WHERE gid = ? LIMIT 1`,
      [gid]
    );
    return res.json({ success: true, message: "อัปเดตเกมสำเร็จ", data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /games/:gid (อัปเดตบางฟิลด์)
exports.partialUpdate = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  const { ok, errors, data } = await validateGamePayload(req.body, { partial: true });
  if (!ok) return res.status(400).json({ success: false, message: errors.join(", ") });

  try {
    // มีอยู่ไหม
    const [[exist]] = await db.query(`SELECT gid FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!exist) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    // สร้าง SET แบบไดนามิก
    const sets = [];
    const vals = [];

    if (data.name !== undefined) { sets.push("name = ?"); vals.push(data.name); }
    if (data.price !== undefined) { sets.push("price = ?"); vals.push(data.price); }
    if (data.tid !== undefined) {
      // ตรวจ FK
      const typeOk = await ensureTypeExists(data.tid);
      if (!typeOk) return res.status(400).json({ success: false, message: "tid ไม่พบใน game_type" });
      sets.push("tid = ?"); vals.push(data.tid);
    }
    if (data.description !== undefined) { sets.push("description = ?"); vals.push(data.description); }
    if (data.released_at !== undefined) { sets.push("released_at = ?"); vals.push(data.released_at); }
    if (data.rank_score !== undefined) { sets.push("rank_score = ?"); vals.push(data.rank_score); }

    if (sets.length === 0)
      return res.status(400).json({ success: false, message: "ไม่พบฟิลด์ที่จะแก้ไข" });

    vals.push(gid);

    await db.query(`UPDATE game SET ${sets.join(", ")} WHERE gid = ?`, vals);

    const [[row]] = await db.query(
      `SELECT gid, name, price, tid, description, released_at, rank_score, created_at, updated_at
       FROM game WHERE gid = ? LIMIT 1`,
      [gid]
    );
    return res.json({ success: true, message: "แก้ไขบางฟิลด์สำเร็จ", data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /games/:gid
exports.remove = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  try {
    // เช็คอ้างอิงที่อาจบล็อกการลบ (ตัวอย่าง: cart_item, user_library เป็น ON DELETE RESTRICT)
    // ถ้าต้องการ soft-delete ให้เพิ่มคอลัมน์สถานะแทน
    const [[exist]] = await db.query(`SELECT gid FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!exist) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    await db.query(`DELETE FROM game WHERE gid = ?`, [gid]);
    return res.json({ success: true, message: "ลบเกมสำเร็จ", gid });
  } catch (err) {
    // MySQL ER_ROW_IS_REFERENCED_* = 1451/1452
    if (err && (err.errno === 1451 || err.errno === 1452)) {
      return res.status(409).json({
        success: false,
        message:
          "ลบไม่ได้: มีการอ้างอิงอยู่ (เช่น ถูกเพิ่มในตะกร้า/คลังเกมของผู้ใช้) — พิจารณาย้ายไปใช้ soft delete",
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};
