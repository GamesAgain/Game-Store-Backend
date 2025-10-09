// controllers/gameController.js
const db = require("../config/db"); // mysql2/promise createPool
const {
  processImageToWebpSquare,
  uploadBufferToCloudinary,
} = require("../services/upload");

// ---------- helpers ----------
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function toNullableDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : v;
}
function parseIdArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(n => Number(n)).filter(Number.isInteger);
  if (typeof input === "string") {
    try {
      const arr = JSON.parse(input);
      if (Array.isArray(arr)) return arr.map(n => Number(n)).filter(Number.isInteger);
    } catch {}
    return input
      .split(",")
      .map(s => Number(String(s).trim()))
      .filter(Number.isInteger);
  }
  return [];
}

async function validateGamePayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  // name
  if (!partial || body.name !== undefined) {
    if (!isNonEmptyString(body.name)) errors.push("name: ต้องเป็น string ไม่ว่าง");
    else data.name = body.name.trim();
  }

  // price
  if (!partial || body.price !== undefined) {
    if (body.price === undefined || body.price === null || body.price === "")
      errors.push("price: จำเป็น");
    else if (isNaN(Number(body.price))) errors.push("price: ต้องเป็นตัวเลข");
    else data.price = Number(body.price);
  }

  // description (optional)
  if (!partial || body.description !== undefined) {
    if (body.description === undefined || body.description === null) data.description = null;
    else if (typeof body.description !== "string")
      errors.push("description: ต้องเป็น string หรือ null");
    else data.description = body.description;
  }

  // released_at (DATE, optional)
  if (!partial || body.released_at !== undefined) {
    const d = toNullableDate(body.released_at);
    if (
      body.released_at !== undefined &&
      d === null &&
      body.released_at !== null &&
      body.released_at !== ""
    )
      errors.push("released_at: รูปแบบวันต้องเป็น YYYY-MM-DD หรือปล่อยว่าง");
    else data.released_at = d;
  }

  // Developer (optional)
  if (!partial || body.developer !== undefined) {
    if (body.developer === undefined || body.developer === null || body.developer === "")
      data.developer = null;
    else if (typeof body.developer !== "string")
      errors.push("developer: ต้องเป็น string หรือปล่อยว่าง");
    else data.developer = body.developer.trim();
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

// GET /games  (แนบ categories & images ให้ทุกเกม)
exports.list = async (_req, res) => {
  try {
    const [games] = await db.query(
      `SELECT gid, name, price, description, released_at,
              \`Developer\` AS developer, rank_score, created_at, updated_at
         FROM game
        ORDER BY gid DESC`
    );

    if (!games.length) {
      return res.json({ success: true, count: 0, data: [] });
    }

    const gids = games.map(g => g.gid);

    const [catRows] = await db.query(
      `SELECT gc.gid, gc.gcid, gc.tid, gc.category_name, gt.name AS type_name
         FROM game_category gc
         JOIN game_type gt ON gt.tid = gc.tid
        WHERE gc.gid IN (?)
        ORDER BY gc.gid ASC, gc.gcid ASC`,
      [gids]
    );

    const [imgRows] = await db.query(
      `SELECT imgid, gid, url, created_at
         FROM game_image
        WHERE gid IN (?)
        ORDER BY gid ASC, imgid ASC`,
      [gids]
    );

    const catsByGid = new Map();
    const imgsByGid = new Map();

    for (const g of gids) {
      catsByGid.set(g, []);
      imgsByGid.set(g, []);
    }

    for (const r of catRows) {
      catsByGid.get(r.gid).push({
        gcid: r.gcid,
        tid: r.tid,
        category_name: r.category_name,
        type_name: r.type_name,
      });
    }

    for (const r of imgRows) {
      imgsByGid.get(r.gid).push({
        imgid: r.imgid,
        gid: r.gid,
        url: r.url,
        created_at: r.created_at,
      });
    }

    const data = games.map(g => ({
      ...g,
      categories: catsByGid.get(g.gid) ?? [],
      images: imgsByGid.get(g.gid) ?? [],
    }));

    return res.json({ success: true, count: data.length, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /games/:gid — คืนเกม 1 รายการ พร้อม categories และ images
exports.getById = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  try {
    const [[game]] = await db.query(
      `SELECT gid, name, price, description, released_at,
              \`Developer\` AS developer, rank_score, created_at, updated_at
         FROM game
        WHERE gid = ?
        LIMIT 1`,
      [gid]
    );
    if (!game) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    const [catRows] = await db.query(
      `SELECT gc.gcid, gc.tid, gc.category_name, gt.name AS type_name
         FROM game_category gc
         JOIN game_type gt ON gt.tid = gc.tid
        WHERE gc.gid = ?
        ORDER BY gc.gcid ASC`,
      [gid]
    );

    const [imgRows] = await db.query(
      `SELECT imgid, gid, url, created_at
         FROM game_image
        WHERE gid = ?
        ORDER BY imgid ASC`,
      [gid]
    );

    game.categories = catRows.map(r => ({
      gcid: r.gcid,
      tid: r.tid,
      category_name: r.category_name,
      type_name: r.type_name,
    }));
    game.images = imgRows;

    return res.json({ success: true, data: game });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /games (JSON only) — released_at := NOW()
exports.create = async (req, res) => {
  const { ok, errors, data } = await validateGamePayload(req.body, { partial: false });
  if (!ok) return res.status(400).json({ success: false, message: errors.join(", ") });

  try {
    const [result] = await db.query(
      `INSERT INTO game (name, price, description, released_at, \`Developer\`, rank_score)
       VALUES (?, ?, ?, NOW(), ?, ?)`,
      [data.name, data.price, data.description, data.developer, data.rank_score]
    );

    const gid = result.insertId;
    const [[row]] = await db.query(
      `SELECT gid, name, price, description, released_at,
              \`Developer\` AS developer, rank_score, created_at, updated_at
         FROM game
        WHERE gid = ? LIMIT 1`,
      [gid]
    );
    return res.status(201).json({ success: true, message: "สร้างเกมสำเร็จ", gid, data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ POST /games/with-media (multipart + categories + images) — released_at := NOW()
exports.createWithMedia = async (req, res) => {
  const { ok, errors, data } = await validateGamePayload(req.body, { partial: false });
  if (!ok) return res.status(400).json({ success: false, message: errors.join(", ") });

  const tids = parseIdArray(req.body.categories); // "1,2,3" หรือ "[1,2,3]"
  const files = req.files || [];

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [ins] = await conn.query(
      `INSERT INTO game (name, price, description, released_at, \`Developer\`, rank_score)
       VALUES (?, ?, ?, NOW(), ?, ?)`,
      [data.name, data.price, data.description, data.developer, data.rank_score]
    );
    const gid = ins.insertId;

    if (tids.length) {
      const [types] = await conn.query(
        `SELECT tid, name FROM game_type WHERE tid IN (${tids.map(() => "?").join(",")})`,
        tids
      );
      for (const t of types) {
        await conn.query(
          `INSERT INTO game_category (gid, tid, category_name) VALUES (?, ?, ?)`,
          [gid, t.tid, t.name]
        );
      }
    }

    for (const f of files) {
      const buf = await processImageToWebpSquare(f.buffer, 1024);
      const up = await uploadBufferToCloudinary(buf, {
        folder: `gameshop/games/${gid}`,
        filename: `g${gid}_${Date.now()}`,
      });
      await conn.query(
        `INSERT INTO game_image (gid, url, created_at) VALUES (?, ?, NOW())`,
        [gid, up.secure_url]
      );
    }

    await conn.commit();

    const [[game]] = await conn.query(
      `SELECT gid, name, price, description, released_at,
              \`Developer\` AS developer, rank_score, created_at, updated_at
         FROM game WHERE gid = ? LIMIT 1`,
      [gid]
    );
    const [cats] = await conn.query(
      `SELECT gc.gcid, gc.tid, gc.category_name, gt.name AS type_name
         FROM game_category gc
         JOIN game_type gt ON gt.tid = gc.tid
        WHERE gc.gid = ? ORDER BY gc.gcid`,
      [gid]
    );
    const [imgs] = await conn.query(
      `SELECT imgid, gid, url, created_at
         FROM game_image WHERE gid = ? ORDER BY imgid`,
      [gid]
    );

    return res
      .status(201)
      .json({ success: true, message: "สร้างเกมพร้อมสื่อสำเร็จ", data: game, categories: cats, images: imgs });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ success: false, message: err.message || String(err) });
  } finally {
    conn.release();
  }
};

// PUT /games/:gid (JSON only)
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
          SET name = ?, price = ?, description = ?, released_at = ?, \`Developer\` = ?, rank_score = ?
        WHERE gid = ?`,
      [
        data.name,
        data.price,
        data.description,
        data.released_at,
        data.developer,
        data.rank_score,
        gid,
      ]
    );

    const [[row]] = await db.query(
      `SELECT gid, name, price, description, released_at,
              \`Developer\` AS developer, rank_score, created_at, updated_at
         FROM game WHERE gid = ? LIMIT 1`,
      [gid]
    );
    return res.json({ success: true, message: "อัปเดตเกมสำเร็จ", data: row });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ PUT /games/:gid/with-media (multipart + optional replace categories + add/remove images)
exports.updateWithMedia = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  const { ok, errors, data } = await validateGamePayload(req.body, { partial: true });
  if (!ok) return res.status(400).json({ success: false, message: errors.join(", ") });

  // --- สำคัญ: ถ้าส่งฟิลด์ categories มา (แม้จะว่าง) ให้ถือว่า "แทนที่ทั้งหมด" ---
  const categoriesProvided = Object.prototype.hasOwnProperty.call(req.body, "categories");
  const replaceTids = categoriesProvided ? parseIdArray(req.body.categories) : null; // null = ไม่แตะ
  const deleteImgIds = parseIdArray(req.body.delete_image_ids);
  const files = req.files || [];

  const conn = await db.getConnection();
  try {
    const [[exist]] = await conn.query(`SELECT gid FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!exist) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    await conn.beginTransaction();

    // อัปเดตฟิลด์ของเกม
    const sets = [];
    const vals = [];
    if (data.name !== undefined) { sets.push("name = ?"); vals.push(data.name); }
    if (data.price !== undefined) { sets.push("price = ?"); vals.push(data.price); }
    if (data.description !== undefined) { sets.push("description = ?"); vals.push(data.description); }
    if (data.released_at !== undefined) { sets.push("released_at = ?"); vals.push(data.released_at); }
    if (data.developer !== undefined) { sets.push("`Developer` = ?"); vals.push(data.developer); }
    if (data.rank_score !== undefined) { sets.push("rank_score = ?"); vals.push(data.rank_score); }
    if (sets.length) {
      vals.push(gid);
      await conn.query(`UPDATE game SET ${sets.join(", ")} WHERE gid = ?`, vals);
    }

    // แทนที่หมวด ถ้าฟิลด์ categories ถูกส่งมา (แม้ค่าว่างก็ลบหมด)
    if (replaceTids !== null) {
      await conn.query(`DELETE FROM game_category WHERE gid = ?`, [gid]);

      if (replaceTids.length) {
        const [types] = await conn.query(
          `SELECT tid, name FROM game_type WHERE tid IN (${replaceTids.map(() => "?").join(",")})`,
          replaceTids
        );
        for (const t of types) {
          await conn.query(
            `INSERT INTO game_category (gid, tid, category_name) VALUES (?, ?, ?)`,
            [gid, t.tid, t.name]
          );
        }
      }
    }

    // ลบรูปตาม id
    if (deleteImgIds.length) {
      await conn.query(
        `DELETE FROM game_image WHERE gid = ? AND imgid IN (${deleteImgIds.map(() => "?").join(",")})`,
        [gid, ...deleteImgIds]
      );
    }

    // เพิ่มรูปใหม่
    for (const f of files) {
      const buf = await processImageToWebpSquare(f.buffer, 1024);
      const up = await uploadBufferToCloudinary(buf, {
        folder: `gameshop/games/${gid}`,
        filename: `g${gid}_${Date.now()}`,
      });
      await conn.query(
        `INSERT INTO game_image (gid, url, created_at) VALUES (?, ?, NOW())`,
        [gid, up.secure_url]
      );
    }

    await conn.commit();

    // ส่งข้อมูลล่าสุดกลับ
    const [[row]] = await conn.query(
      `SELECT gid, name, price, description, released_at,
              \`Developer\` AS developer, rank_score, created_at, updated_at
         FROM game WHERE gid = ? LIMIT 1`,
      [gid]
    );
    const [cats] = await conn.query(
      `SELECT gc.gcid, gc.tid, gc.category_name, gt.name AS type_name
         FROM game_category gc
         JOIN game_type gt ON gt.tid = gc.tid
        WHERE gc.gid = ?
        ORDER BY gc.gcid`,
      [gid]
    );
    const [imgs] = await conn.query(
      `SELECT imgid, gid, url, created_at FROM game_image WHERE gid = ? ORDER BY imgid`,
      [gid]
    );

    return res.json({
      success: true,
      message: "อัปเดตเกมพร้อมสื่อสำเร็จ",
      data: row,
      categories: cats,
      images: imgs,
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ success: false, message: err.message || String(err) });
  } finally {
    conn.release();
  }
};

// PATCH /games/:gid (JSON only)
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

    if (data.name !== undefined)        { sets.push("name = ?");        vals.push(data.name); }
    if (data.price !== undefined)       { sets.push("price = ?");       vals.push(data.price); }
    if (data.description !== undefined) { sets.push("description = ?"); vals.push(data.description); }
    if (data.released_at !== undefined) { sets.push("released_at = ?"); vals.push(data.released_at); }
    if (data.developer !== undefined)   { sets.push("`Developer` = ?"); vals.push(data.developer); }
    if (data.rank_score !== undefined)  { sets.push("rank_score = ?");  vals.push(data.rank_score); }

    if (!sets.length)
      return res.status(400).json({ success: false, message: "ไม่พบฟิลด์ที่จะแก้ไข" });

    vals.push(gid);
    await db.query(`UPDATE game SET ${sets.join(", ")} WHERE gid = ?`, vals);

    const [[row]] = await db.query(
      `SELECT gid, name, price, description, released_at,
              \`Developer\` AS developer, rank_score, created_at, updated_at
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
    return res.json({ success: true, message: "ลบเกมสำเร็จ", gid });
  } catch (err) {
    if (err && (err.errno === 1451 || err.errno === 1452)) {
      return res.status(409).json({
        success: false,
        message: "ลบไม่ได้: มีการอ้างอิงอยู่ — พิจารณาใช้ soft delete",
      });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /games/:gid/categories
exports.getCategoriesByGame = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  try {
    const [[game]] = await db.query(`SELECT gid, name FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!game) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    const [rows] = await db.query(
      `SELECT gc.gcid, gc.gid, gc.tid, gc.category_name, gt.name AS type_name
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
        type_name: r.type_name,
        category_name: r.category_name,
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /games/:gid/images
exports.getImagesByGame = async (req, res) => {
  const gid = Number(req.params.gid);
  if (!Number.isInteger(gid) || gid <= 0)
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });

  try {
    const [[game]] = await db.query(`SELECT gid, name FROM game WHERE gid = ? LIMIT 1`, [gid]);
    if (!game) return res.status(404).json({ success: false, message: "ไม่พบเกมนี้" });

    const [rows] = await db.query(
      `SELECT imgid, gid, url, created_at
         FROM game_image
        WHERE gid = ?
        ORDER BY imgid ASC`,
      [gid]
    );

    return res.json({
      success: true,
      game: { gid: game.gid, name: game.name },
      count: rows.length,
      images: rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ✅ NEW: GET /games/types — รายการประเภทเกมทั้งหมด
exports.listGameTypes = async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT tid, name
         FROM game_type
        ORDER BY tid ASC`
    );
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
