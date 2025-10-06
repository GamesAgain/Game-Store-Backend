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

// ---------- controllers ----------

// GET /games
exports.list = async (_req, res) => {
  try {
    // หมายเหตุ: DECIMAL(12,2) จะถูกส่งกลับเป็น string โดย mysql2 ตามค่าเริ่มต้น
    const [rows] = await db.query(
      `SELECT gid, name, price, description, released_at, rank_score, created_at, updated_at
       FROM game
       ORDER BY gid DESC`
    );
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
      `SELECT gid, name, price, description, released_at, rank_score, created_at, updated_at
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
    const [result] = await db.query(
      `INSERT INTO game (name, price, description, released_at, rank_score)
       VALUES (?, ?, ?, ?, ?)`,
      [data.name, data.price, data.description, data.released_at, data.rank_score]
    );

    const gid = result.insertId;
    const [[row]] = await db.query(
      `SELECT gid, name, price, description, released_at, rank_score, created_at, updated_at
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
    const [[exist]] = await db.query(`SELECT gid FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!exist) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    await db.query(
      `UPDATE game
       SET name = ?, price = ?, description = ?, released_at = ?, rank_score = ?
       WHERE gid = ?`,
      [data.name, data.price, data.description, data.released_at, data.rank_score, gid]
    );

    const [[row]] = await db.query(
      `SELECT gid, name, price, description, released_at, rank_score, created_at, updated_at
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
    const [[exist]] = await db.query(`SELECT gid FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!exist) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    const sets = [];
    const vals = [];

    if (data.name !== undefined)         { sets.push("name = ?");         vals.push(data.name); }
    if (data.price !== undefined)        { sets.push("price = ?");        vals.push(data.price); }
    if (data.description !== undefined)  { sets.push("description = ?");  vals.push(data.description); }
    if (data.released_at !== undefined)  { sets.push("released_at = ?");  vals.push(data.released_at); }
    if (data.rank_score !== undefined)   { sets.push("rank_score = ?");   vals.push(data.rank_score); }

    if (sets.length === 0)
      return res.status(400).json({ success: false, message: "ไม่พบฟิลด์ที่จะแก้ไข" });

    vals.push(gid);
    await db.query(`UPDATE game SET ${sets.join(", ")} WHERE gid = ?`, vals);

    const [[row]] = await db.query(
      `SELECT gid, name, price, description, released_at, rank_score, created_at, updated_at
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
    const [[exist]] = await db.query(`SELECT gid FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!exist) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    await db.query(`DELETE FROM game WHERE gid = ?`, [gid]);
    // หมายเหตุ: game_category อ้างอิงด้วย FK ON DELETE CASCADE
    return res.json({ success: true, message: "ลบเกมสำเร็จ", gid });
  } catch (err) {
    if (err && (err.errno === 1451 || err.errno === 1452)) {
      return res.status(409).json({
        success: false,
        message:
          "ลบไม่ได้: มีการอ้างอิงอยู่ (เช่น ถูกเพิ่มในตะกร้า/คลังเกมของผู้ใช้) — พิจารณา soft delete",
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// NEW: GET /games/:gid/categories — ดึงหมวด/ประเภททั้งหมดของเกม
exports.getCategoriesByGame = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  try {
    // ตรวจว่ามีเกมนี้จริง
    const [[game]] = await db.query(`SELECT gid, name FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!game) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    // ดึง categories ทั้งหมดของเกม
    const [rows] = await db.query(
      `SELECT gc.gcid, gc.gid, gc.tid, gc.category_name,
              gt.name AS type_name
         FROM game_category gc
         JOIN game_type gt ON gc.tid = gt.tid
        WHERE gc.gid = ?
        ORDER BY gc.gcid ASC`,
      [gid]
    );

    return res.json({
      success: true,
      game: { gid: game.gid, name: game.name },
      count: rows.length,
      categories: rows.map(r => ({
        gcid: r.gcid,
        gid: r.gid,
        tid: r.tid,
        type_name: r.type_name,     // ชื่อประเภทจาก game_type
        category_name: r.category_name // ถ้าคุณใช้เก็บชื่อย่อยเฉพาะหมวด (optional)
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
