// controllers/topSellerController.js
const db = require("../config/db");

function parseDateOnly(input) {
  if (input === undefined) return { ok: true, value: null };
  const str = String(input).trim();
  if (!str) {
    return {
      ok: false,
      message: "date: กรุณาระบุวันที่ในรูปแบบ YYYY-MM-DD",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return {
      ok: false,
      message: "date: รูปแบบต้องเป็น YYYY-MM-DD",
    };
  }
  const dt = new Date(str);
  if (Number.isNaN(dt.getTime())) {
    return {
      ok: false,
      message: "date: วันที่ไม่ถูกต้อง",
    };
  }
  return { ok: true, value: str };
}

async function updateRankScores(topRows) {
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    await connection.query("UPDATE game SET rank_score = 0");

    if (topRows.length) {
      const caseFragments = topRows.map(() => "WHEN ? THEN ?").join(" ");
      const params = [];

      topRows.forEach((row, index) => {
        params.push(row.gid);
        params.push(index + 1);
      });

      const gids = topRows.map((row) => row.gid);

      await connection.query(
        `UPDATE game
            SET rank_score = CASE gid ${caseFragments} ELSE rank_score END
          WHERE gid IN (?)`,
        [...params, gids]
      );
    }

    await connection.commit();
  } catch (err) {
    if (connection) await connection.rollback();
    throw err;
  } finally {
    if (connection) connection.release();
  }
}

async function queryTopSellers({ date = null } = {}) {
  const whereParts = ["o.status = 'PAID'", "o.paid_at IS NOT NULL"];
  const params = [];

  if (date) {
    whereParts.push("DATE(o.paid_at) = ?");
    params.push(date);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const [rows] = await db.query(
    `SELECT g.gid,
            g.name,
            g.price,
            g.\`Developer\` AS developer,
            g.rank_score,
            COUNT(*) AS sold_count,
            SUM(ci.unit_price) AS total_revenue,
            MIN(o.paid_at) AS first_paid_at,
            MAX(o.paid_at) AS last_paid_at
       FROM cart_item ci
       JOIN orders o ON o.oid = ci.oid
       JOIN game g ON g.gid = ci.gid
      ${whereClause}
   GROUP BY g.gid
   ORDER BY sold_count DESC, total_revenue DESC, g.gid ASC
      LIMIT 5`,
    params
  );

  if (!rows.length) {
    await updateRankScores([]);
    return [];
  }

  rows.forEach((row, index) => {
    row.rank_score = index + 1;
  });

  await updateRankScores(rows);

  const gids = rows.map((row) => row.gid);

  const [imageRows] = await db.query(
    `SELECT imgid, gid, url, created_at
       FROM game_image
      WHERE gid IN (?)
      ORDER BY gid ASC, imgid ASC`,
    [gids]
  );

  const imagesByGid = new Map();

  for (const gid of gids) {
    imagesByGid.set(gid, []);
  }

  for (const image of imageRows) {
    if (!imagesByGid.has(image.gid)) continue;
    imagesByGid.get(image.gid).push({
      imgid: image.imgid,
      gid: image.gid,
      url: image.url,
      created_at: image.created_at,
    });
  }

  return rows.map((row) => ({
    gid: row.gid,
    name: row.name,
    price: row.price !== undefined && row.price !== null ? Number(row.price) : null,
    developer: row.developer,
    rank_score: row.rank_score,
    sold_count: Number(row.sold_count) || 0,
    total_revenue:
      row.total_revenue !== undefined && row.total_revenue !== null
        ? Number(row.total_revenue)
        : 0,
    first_paid_at: row.first_paid_at,
    last_paid_at: row.last_paid_at,
    images: imagesByGid.get(row.gid) ?? [],
  }));
}

exports.getTopSellers = async (req, res) => {
  try {
    const { ok, value, message } = parseDateOnly(req.query?.date);

    if (!ok) {
      return res.status(400).json({ success: false, message });
    }

    const data = await queryTopSellers({ date: value });

    return res.json({
      success: true,
      scope: {
        type: value ? "by-date" : "overall",
        date: value,
      },
      count: data.length,
      data,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || String(err) });
  }
};
