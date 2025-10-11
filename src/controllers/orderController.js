// Version 0.1.5
// Controller สำหรับตะกร้า/ออเดอร์ ตามสคีมา (orders, cart_item, users, game, promotion, promotion_redemption, wallet_transaction, user_library)
const db = require("../config/db"); // mysql2/promise pool

const send500 = (res, err) =>
  res.status(500).json({ success: false, message: err?.message || String(err) });

/** Utility: รันงานในทรานแซกชัน */
async function withTx(work) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (e) {
    try { await conn.rollback(); } catch {}
    throw e;
  } finally {
    conn.release();
  }
}

function parseGids(payload) {
  let arr = [];
  if (!payload) return arr;
  if (Array.isArray(payload)) arr = payload;
  else if (typeof payload === "number") arr = [payload];
  else if (typeof payload === "string") {
    try {
      const j = JSON.parse(payload);
      if (Array.isArray(j)) arr = j;
    } catch {
      arr = String(payload).split(",").map(s => Number(String(s).trim()));
    }
  }
  // กรองให้เหลือเฉพาะจำนวนเต็มบวกที่ไม่ซ้ำ
  return [...new Set(arr.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

/** Utility: ดึงออเดอร์ของผู้ใช้ (lockRow=true จะล็อกด้วย FOR UPDATE) */
async function loadOwnedOrder(connOrPool, oid, uid, lockRow = false) {
  const lock = lockRow ? " FOR UPDATE" : "";
  const [rows] = await connOrPool.query(
    `SELECT oid, uid, pid, status, total_before, total_after, created_at, paid_at
     FROM orders
     WHERE oid = ? AND uid = ?
     LIMIT 1${lock}`,
    [oid, uid]
  );
  return rows[0] || null;
}

/** Utility: สรุปยอดรายการในตะกร้า */
async function summarizeCart(conn, oid) {
  const [[sumRow]] = await conn.query(
    `SELECT COALESCE(SUM(unit_price), 0.00) AS subtotal, COUNT(*) AS items
     FROM cart_item WHERE oid = ?`,
    [oid]
  );
  const subtotal = Number(sumRow.subtotal || 0);
  const items = Number(sumRow.items || 0);
  return { subtotal, items };
}

/** Utility: โหลดโปรโมชันจาก order.pid (lock=true จะล็อกแถวโปรฯ) และตรวจช่วงเวลา */
async function loadValidPromoForOrder(conn, order, lock = false) {
  if (!order.pid) return null;
  const lockSql = lock ? " FOR UPDATE" : "";
  const [[p]] = await conn.query(
    `SELECT pid, code, discount_type, discount_value, max_uses, used_count, starts_at, expires_at
     FROM promotion
     WHERE pid = ?
     LIMIT 1${lockSql}`,
    [order.pid]
  );
  if (!p) return null;

  const [[{ now }]] = await conn.query(`SELECT NOW() AS now`);
  const nowDt = new Date(now);
  if (!(new Date(p.starts_at) <= nowDt && nowDt <= new Date(p.expires_at))) {
    return null;
  }
  return p;
}

/** Utility: คำนวณส่วนลด + อัปเดตยอดใน orders */
async function recalcAndSaveTotals(conn, oid) {
  const [[order]] = await conn.query(
    `SELECT oid, pid FROM orders WHERE oid = ? LIMIT 1`,
    [oid]
  );
  if (!order) throw new Error("Order not found");

  const { subtotal } = await summarizeCart(conn, oid);

  let discount = 0;
  if (order.pid) {
    const promo = await loadValidPromoForOrder(conn, order, false);
    if (promo) {
      if (promo.discount_type === "PERCENT") {
        discount = (subtotal * Number(promo.discount_value || 0)) / 100.0;
      } else if (promo.discount_type === "FIXED") {
        discount = Number(promo.discount_value || 0);
      }
      if (discount > subtotal) discount = subtotal;
    } else {
      // โปรหมดอายุ -> ล้าง pid
      await conn.query(`UPDATE orders SET pid = NULL WHERE oid = ?`, [oid]);
      discount = 0;
    }
  }

  await conn.query(
    `UPDATE orders
       SET total_before = ROUND(?, 2),
           total_after  = ROUND(?, 2)
     WHERE oid = ?`,
    [subtotal, subtotal - discount, oid]
  );

  const [[after]] = await conn.query(
    `SELECT total_before, total_after FROM orders WHERE oid = ?`,
    [oid]
  );
  return {
    total_before: Number(after.total_before),
    total_after: Number(after.total_after),
  };
}

/** POST /orders — สร้าง DRAFT (ถ้ามีอยู่แล้วจะคืนตัวเดิม) */
exports.createDraftOrder = async (req, res) => {
  const uid = req.user.uid;
  try {
    const [[exists]] = await db.query(
      `SELECT oid FROM orders WHERE uid = ? AND status = 'DRAFT'
       ORDER BY created_at DESC
       LIMIT 1`,
      [uid]
    );

    if (exists) {
      const [items] = await db.query(
        `SELECT ci.gid, ci.unit_price, g.name
         FROM cart_item ci
         JOIN game g ON ci.gid = g.gid
         WHERE ci.oid = ?`,
        [exists.oid]
      );
      const [[o]] = await db.query(`SELECT * FROM orders WHERE oid = ?`, [exists.oid]);
      return res.json({ success: true, message: "มี DRAFT อยู่แล้ว", order: o, items });
    }

    const [ins] = await db.query(
      `INSERT INTO orders (uid, status, total_before, total_after, paid_at)
       VALUES (?, 'DRAFT', 0.00, 0.00, NULL)`,
      [uid]
    );
    const oid = ins.insertId;
    const [[order]] = await db.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
    return res.json({ success: true, message: "สร้างออเดอร์ DRAFT สำเร็จ", order });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /orders — รายการออเดอร์ของผู้ใช้ */
exports.listMyOrders = async (req, res) => {
  const uid = req.user.uid;
  const { status } = req.query || {};
  try {
    const args = [uid];
    let where = `WHERE o.uid = ?`;
    if (status && (status === "DRAFT" || status === "PAID")) {
      where += ` AND o.status = ?`;
      args.push(status);
    }
    const [rows] = await db.query(
      `SELECT o.oid, o.status, o.total_before, o.total_after, o.created_at, o.paid_at, o.pid,
              (SELECT COUNT(*) FROM cart_item ci WHERE ci.oid = o.oid) AS items_count
       FROM orders o
       ${where}
       ORDER BY o.created_at DESC, o.oid DESC`,
      args
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /orders/:oid — รายละเอียดออเดอร์ + items */
exports.getOrderDetail = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  try {
    const order = await loadOwnedOrder(db, oid, uid, false);
    if (!order) return res.status(404).json({ success: false, message: "ไม่พบออเดอร์" });

    const [items] = await db.query(
      `SELECT ci.gid, ci.unit_price, g.name
       FROM cart_item ci
       JOIN game g ON ci.gid = g.gid
       WHERE ci.oid = ?`,
      [oid]
    );
    return res.json({ success: true, order, items });
  } catch (err) {
    return send500(res, err);
  }
};

/** PATCH /orders/:oid — อัปเดตเฉพาะ DRAFT: ตั้ง/ล้าง pid หรือ recalc */
exports.updateDraftOrder = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  const { pid, recalc } = req.body || {};

  try {
    const result = await withTx(async (conn) => {
      const order = await loadOwnedOrder(conn, oid, uid, true);
      if (!order) return { error: "ไม่พบออเดอร์" };
      if (order.status !== "DRAFT") return { error: "ออเดอร์ที่ชำระแล้วแก้ไขไม่ได้" };

      if (pid === null) {
        await conn.query(`UPDATE orders SET pid = NULL WHERE oid = ?`, [oid]);
      } else if (pid !== undefined) {
        const [[p]] = await conn.query(`SELECT pid FROM promotion WHERE pid = ?`, [pid]);
        if (!p) return { error: "ไม่พบโปรโมชัน" };
        await conn.query(`UPDATE orders SET pid = ? WHERE oid = ?`, [pid, oid]);
      }

      if (pid !== undefined || recalc) {
        const totals = await recalcAndSaveTotals(conn, oid);
        return { totals };
      }
      const [[o]] = await conn.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
      return { order: o };
    });

    if (result.error) return res.json({ success: false, message: result.error });

    if (result.totals) {
      const [[o]] = await db.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
      return res.json({ success: true, message: "อัปเดตออเดอร์แล้ว", order: o });
    }
    return res.json({ success: true, message: "อัปเดตออเดอร์แล้ว", order: result.order });
  } catch (err) {
    return send500(res, err);
  }
};

/** DELETE /orders/:oid — ลบเฉพาะ DRAFT */
exports.deleteDraftOrder = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  try {
    const result = await withTx(async (conn) => {
      const order = await loadOwnedOrder(conn, oid, uid, true);
      if (!order) return { error: "ไม่พบออเดอร์" };
      if (order.status !== "DRAFT") return { error: "ออเดอร์ที่ชำระแล้วลบไม่ได้" };

      await conn.query(`DELETE FROM orders WHERE oid = ?`, [oid]); // cart_item จะลบตาม FK CASCADE
      return { ok: true };
    });
    if (result.error) return res.json({ success: false, message: result.error });
    return res.json({ success: true, message: "ลบออเดอร์สำเร็จ" });
  } catch (err) {
    return send500(res, err);
  }
};

/** GET /orders/:oid/items — รายการของในตะกร้า */
exports.listItems = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  try {
    const order = await loadOwnedOrder(db, oid, uid, false);
    if (!order) return res.status(404).json({ success: false, message: "ไม่พบออเดอร์" });

    const [rows] = await db.query(
      `SELECT ci.gid, ci.unit_price, g.name
       FROM cart_item ci
       JOIN game g ON ci.gid = g.gid
       WHERE ci.oid = ?`,
      [oid]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    return send500(res, err);
  }
};

/** POST /orders/:oid/items — เพิ่มเกมลงตะกร้า (กันซื้อซ้ำหากผู้ใช้มีอยู่แล้วใน user_library) */
exports.addItem = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  const { gid } = req.body || {};
  if (!gid || isNaN(gid)) {
    return res.status(400).json({ success: false, message: "gid ไม่ถูกต้อง" });
  }

  try {
    const result = await withTx(async (conn) => {
      const order = await loadOwnedOrder(conn, oid, uid, true);
      if (!order) return { error: "ไม่พบออเดอร์" };
      if (order.status !== "DRAFT") return { error: "ออเดอร์ที่ชำระแล้วแก้ไขไม่ได้" };

      // 1) ตรวจว่าผู้ใช้มีเกมนี้อยู่แล้วหรือยัง
      const [[owned]] = await conn.query(
        `SELECT 1 FROM user_library WHERE uid = ? AND gid = ? LIMIT 1`,
        [uid, gid]
      );
      if (owned) return { error: "คุณมีเกมนี้ในไลบรารีแล้ว (ซื้อซ้ำไม่ได้)" };

      // 2) อ่านราคาเกม
      const [[game]] = await conn.query(
        `SELECT gid, price, name FROM game WHERE gid = ? LIMIT 1`,
        [gid]
      );
      if (!game) return { error: "ไม่พบเกม" };

      // 3) เพิ่มลงตะกร้า (กันซ้ำในตะกร้าด้วย UNIQUE(oid,gid))
      try {
        await conn.query(
          `INSERT INTO cart_item (oid, gid, unit_price) VALUES (?, ?, ?)`,
          [oid, gid, game.price]
        );
      } catch (e) {
        if (e && e.code === "ER_DUP_ENTRY") {
          return { error: "เกมนี้อยู่ในตะกร้าแล้ว" };
        }
        throw e;
      }

      // 4) คำนวณยอดใหม่
      const totals = await recalcAndSaveTotals(conn, oid);
      return { totals, added: { gid: game.gid, unit_price: Number(game.price), name: game.name } };
    });

    if (result.error) return res.json({ success: false, message: result.error });

    const [[order]] = await db.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
    return res.json({
      success: true,
      message: "เพิ่มเกมลงตะกร้าแล้ว",
      added: result.added,
      order,
    });
  } catch (err) {
    return send500(res, err);
  }
};

/** DELETE /orders/:oid/items/:gid — ลบเกมออกจากตะกร้า */
exports.removeItem = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  const gid = Number(req.params.gid);

  try {
    const result = await withTx(async (conn) => {
      const order = await loadOwnedOrder(conn, oid, uid, true);
      if (!order) return { error: "ไม่พบออเดอร์" };
      if (order.status !== "DRAFT") return { error: "ออเดอร์ที่ชำระแล้วแก้ไขไม่ได้" };

      const [del] = await conn.query(
        `DELETE FROM cart_item WHERE oid = ? AND gid = ?`,
        [oid, gid]
      );
      if (del.affectedRows === 0) return { error: "ไม่พบเกมในตะกร้า" };

      const totals = await recalcAndSaveTotals(conn, oid);
      return { totals };
    });

    if (result.error) return res.json({ success: false, message: result.error });

    const [[order]] = await db.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
    return res.json({ success: true, message: "ลบเกมออกแล้ว", order });
  } catch (err) {
    return send500(res, err);
  }
};

/** POST /orders/:oid/apply-promo — ใช้โค้ดโปรโมชัน */
exports.applyPromoCode = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ success: false, message: "กรุณาใส่โค้ด" });

  try {
    const result = await withTx(async (conn) => {
      const order = await loadOwnedOrder(conn, oid, uid, true);
      if (!order) return { error: "ไม่พบออเดอร์" };
      if (order.status !== "DRAFT") return { error: "ออเดอร์ที่ชำระแล้วแก้ไขไม่ได้" };

      const [[p]] = await conn.query(
        `SELECT pid, code, discount_type, discount_value, max_uses, used_count, starts_at, expires_at
         FROM promotion
         WHERE code = ?
         LIMIT 1`,
        [code]
      );
      if (!p) return { error: "ไม่พบโปรโมชัน" };

      const [[{ now }]] = await conn.query(`SELECT NOW() AS now`);
      const nowDt = new Date(now);
      if (!(new Date(p.starts_at) <= nowDt && nowDt <= new Date(p.expires_at))) {
        return { error: "โปรโมชันหมดอายุหรือยังไม่เริ่ม" };
      }

      await conn.query(`UPDATE orders SET pid = ? WHERE oid = ?`, [p.pid, oid]);

      const totals = await recalcAndSaveTotals(conn, oid);
      return { totals, promo: { pid: p.pid, code: p.code } };
    });

    if (result.error) return res.json({ success: false, message: result.error });

    const [[order]] = await db.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
    return res.json({ success: true, message: "ใช้โปรโมชันแล้ว", order });
  } catch (err) {
    return send500(res, err);
  }
};

/** POST /orders/:oid/clear-promo — เคลียร์โปรโมชัน */
exports.clearPromo = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  try {
    const result = await withTx(async (conn) => {
      const order = await loadOwnedOrder(conn, oid, uid, true);
      if (!order) return { error: "ไม่พบออเดอร์" };
      if (order.status !== "DRAFT") return { error: "ออเดอร์ที่ชำระแล้วแก้ไขไม่ได้" };

      await conn.query(`UPDATE orders SET pid = NULL WHERE oid = ?`, [oid]);
      const totals = await recalcAndSaveTotals(conn, oid);
      return { totals };
    });
    if (result.error) return res.json({ success: false, message: result.error });

    const [[order]] = await db.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
    return res.json({ success: true, message: "ลบโปรโมชันแล้ว", order });
  } catch (err) {
    return send500(res, err);
  }
};

/** POST /orders/:oid/recalculate — คำนวณยอดใหม่ */
exports.recalculateTotals = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);
  try {
    const order = await loadOwnedOrder(db, oid, uid, false);
    if (!order) return res.status(404).json({ success: false, message: "ไม่พบออเดอร์" });

    await withTx(async (conn) => {
      await recalcAndSaveTotals(conn, oid);
    });
    const [[latest]] = await db.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
    return res.json({ success: true, message: "คำนวณยอดแล้ว", order: latest });
  } catch (err) {
    return send500(res, err);
  }
};

/** POST /orders/:oid/pay — ชำระเงินและปิดออเดอร์ (ตรวจกันซื้อซ้ำ + insert user_library + promotion_redemption) */
exports.payOrder = async (req, res) => {
  const uid = req.user.uid;
  const oid = Number(req.params.oid);

  try {
    const result = await withTx(async (conn) => {
      // ล็อกออเดอร์
      const order = await loadOwnedOrder(conn, oid, uid, true);
      if (!order) return { error: "ไม่พบออเดอร์" };
      if (order.status !== "DRAFT") return { error: "ออเดอร์นี้ถูกชำระแล้ว" };

      // ต้องมีสินค้าในตะกร้า
      const { items } = await summarizeCart(conn, oid);
      if (items === 0) return { error: "ตะกร้าว่าง ไม่สามารถชำระเงินได้" };

      // (ใหม่) กันซื้อซ้ำ — หากมีเกมในตะกร้าที่ผู้ใช้เป็นเจ้าของแล้ว ไม่อนุญาตให้ชำระเงิน
      const [ownedInCart] = await conn.query(
        `SELECT ci.gid, g.name
           FROM cart_item ci
           JOIN user_library ul ON ul.uid = ? AND ul.gid = ci.gid
           JOIN game g ON g.gid = ci.gid
          WHERE ci.oid = ?
          LIMIT 10`,
        [uid, oid]
      );
      if (ownedInCart.length > 0) {
        const names = ownedInCart.map(r => r.name).join(", ");
        return { error: `พบเกมในตะกร้าที่คุณมีอยู่แล้ว: ${names}. กรุณานำออกก่อนชำระเงิน` };
      }

      // Recalc ก่อนคิดเงิน
      const totals = await recalcAndSaveTotals(conn, oid);

      // ล็อกผู้ใช้และตรวจเงิน
      const [[user]] = await conn.query(
        `SELECT uid, wallet_balance FROM users WHERE uid = ? FOR UPDATE`,
        [uid]
      );
      if (!user) return { error: "ไม่พบบัญชีผู้ใช้" };

      const totalDue = Number(totals.total_after || 0);
      if (user.wallet_balance < totalDue) {
        return { error: "ยอดเงินในกระเป๋าไม่เพียงพอ" };
      }

      // ถ้ามีโปรโมชัน: ล็อกโปรฯ และตรวจ usage/time อีกรอบ
      let promo = null;
      if (order.pid) {
        const lockPromo = await loadValidPromoForOrder(conn, order, true);
        if (!lockPromo) {
          await conn.query(`UPDATE orders SET pid = NULL WHERE oid = ?`, [oid]);
          await recalcAndSaveTotals(conn, oid);
          promo = null;
        } else {
          if (lockPromo.max_uses > 0 && lockPromo.used_count >= lockPromo.max_uses) {
            return { error: "โปรโมชันนี้เต็มสิทธิ์แล้ว" };
          }
          const [[dupRedeem]] = await conn.query(
            `SELECT 1 FROM promotion_redemption WHERE pid = ? AND uid = ? LIMIT 1`,
            [lockPromo.pid, uid]
          );
          if (dupRedeem) {
            return { error: "คุณใช้โปรโมชันนี้ไปแล้ว" };
          }
          promo = lockPromo;
        }
      }

      // หักเงิน
      await conn.query(
        `UPDATE users SET wallet_balance = ROUND(wallet_balance - ?, 2) WHERE uid = ?`,
        [totalDue, uid]
      );

      // บันทึกธุรกรรม
      await conn.query(
        `INSERT INTO wallet_transaction (uid, oid, type, amount, note)
         VALUES (?, ?, 'DEBIT', ?, ?)`,
        [uid, oid, totalDue, `Pay order #${oid}`]
      );

      // ปิดออเดอร์
      await conn.query(
        `UPDATE orders SET status = 'PAID', paid_at = NOW() WHERE oid = ?`,
        [oid]
      );

      // เพิ่มเกมเข้าไลบรารีของผู้ใช้จากรายการในตะกร้า (กันซ้ำด้วย UNIQUE(uid,gid))
      await conn.query(
        `INSERT IGNORE INTO user_library (uid, gid)
         SELECT ?, ci.gid
           FROM cart_item ci
          WHERE ci.oid = ?`,
        [uid, oid]
      );

      // บันทึกการใช้โปรฯ (ถ้ามี)
      if (promo) {
        await conn.query(
          `INSERT INTO promotion_redemption (pid, uid, oid) VALUES (?, ?, ?)`,
          [promo.pid, uid, oid]
        );
        await conn.query(
          `UPDATE promotion SET used_count = used_count + 1 WHERE pid = ?`,
          [promo.pid]
        );
      }

      const [[finalOrder]] = await conn.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
      return { order: finalOrder };
    });

    if (result.error) return res.json({ success: false, message: result.error });

    return res.json({
      success: true,
      message: "ชำระเงินสำเร็จ",
      order: result.order,
    });
  } catch (err) {
    return send500(res, err);
  }
};

/** =========================
 *  NEW: POST /orders/buy
 *  ซื้อทันที: สร้างออเดอร์ DRAFT -> ใส่สินค้า -> ใส่โปร (ถ้ามี code) -> คำนวณ -> จ่ายเงิน -> ปิดออเดอร์
 *  Body ตัวอย่าง:
 *    {
 *      "games": [1,3,5],          // หรือ "1,3,5" หรือ 5 เดี่ยวๆ ก็ได้
 *      "promoCode": "NEWUSER10"   // optional
 *    }
 *  ========================= */
exports.buyNow = async (req, res) => {
  const uid = req.user.uid;
  const gamesInput = req.body?.games ?? req.body?.gids ?? req.body?.items;
  const promoCode = req.body?.promoCode || req.body?.code || null;

  const gids = parseGids(gamesInput);
  if (!gids.length) {
    return res.status(400).json({ success: false, message: "ต้องระบุ games (อย่างน้อย 1 รายการ)" });
  }

  try {
    const result = await withTx(async (conn) => {
      // 1) สร้างออเดอร์ DRAFT
      const [ins] = await conn.query(
        `INSERT INTO orders (uid, status, total_before, total_after, paid_at)
         VALUES (?, 'DRAFT', 0.00, 0.00, NULL)`,
        [uid]
      );
      const oid = ins.insertId;

      // 2) ตรวจว่าผู้ใช้มีเกมในรายการอยู่แล้วหรือไม่
      const [alreadyOwned] = await conn.query(
        `SELECT ul.gid, g.name
           FROM user_library ul
           JOIN game g ON g.gid = ul.gid
          WHERE ul.uid = ? AND ul.gid IN (${gids.map(() => "?").join(",")})
          LIMIT 10`,
        [uid, ...gids]
      );
      if (alreadyOwned.length > 0) {
        const names = alreadyOwned.map(r => r.name).join(", ");
        return { error: `คุณเป็นเจ้าของเกมอยู่แล้ว: ${names}` };
      }

      // 3) โหลดราคาเกม
      const [gameRows] = await conn.query(
        `SELECT gid, price, name FROM game WHERE gid IN (${gids.map(() => "?").join(",")})`,
        gids
      );
      if (gameRows.length !== gids.length) {
        const found = new Set(gameRows.map(g => g.gid));
        const missing = gids.filter(x => !found.has(x));
        return { error: `ไม่พบเกม: ${missing.join(", ")}` };
      }

      // 4) ใส่ลง cart_item
      for (const g of gameRows) {
        await conn.query(
          `INSERT INTO cart_item (oid, gid, unit_price) VALUES (?, ?, ?)`,
          [oid, g.gid, g.price]
        );
      }

      // 5) ถ้ามี promoCode -> ตั้ง pid ถ้าใช้ได้
      if (promoCode) {
        const [[p]] = await conn.query(
          `SELECT pid, code, discount_type, discount_value, max_uses, used_count, starts_at, expires_at
             FROM promotion
            WHERE code = ?
            LIMIT 1`,
          [promoCode]
        );
        if (p) {
          const [[{ now }]] = await conn.query(`SELECT NOW() AS now`);
          const nowDt = new Date(now);
          if (new Date(p.starts_at) <= nowDt && nowDt <= new Date(p.expires_at)) {
            await conn.query(`UPDATE orders SET pid = ? WHERE oid = ?`, [p.pid, oid]);
          }
        }
      }

      // 6) คำนวณยอด
      const totals = await recalcAndSaveTotals(conn, oid);
      const totalDue = Number(totals.total_after || 0);

      // 7) ล็อกผู้ใช้และตรวจเงิน
      const [[user]] = await conn.query(
        `SELECT uid, wallet_balance FROM users WHERE uid = ? FOR UPDATE`,
        [uid]
      );
      if (!user) return { error: "ไม่พบบัญชีผู้ใช้" };
      if (user.wallet_balance < totalDue) return { error: "ยอดเงินในกระเป๋าไม่เพียงพอ" };

      // 8) ตรวจโปรฯ อีกครั้งแบบ lock (กัน race) และบันทึก usage หลังชำระ
      const orderLocked = await loadOwnedOrder(conn, oid, uid, true);
      let promo = null;
      if (orderLocked.pid) {
        const lockPromo = await loadValidPromoForOrder(conn, orderLocked, true);
        if (!lockPromo) {
          await conn.query(`UPDATE orders SET pid = NULL WHERE oid = ?`, [oid]);
          await recalcAndSaveTotals(conn, oid);
        } else {
          if (lockPromo.max_uses > 0 && lockPromo.used_count >= lockPromo.max_uses) {
            return { error: "โปรโมชันนี้เต็มสิทธิ์แล้ว" };
          }
          const [[dupRedeem]] = await conn.query(
            `SELECT 1 FROM promotion_redemption WHERE pid = ? AND uid = ? LIMIT 1`,
            [lockPromo.pid, uid]
          );
          if (dupRedeem) return { error: "คุณใช้โปรโมชันนี้ไปแล้ว" };
          promo = lockPromo;
        }
      }

      // 9) หักเงิน + บันทึกธุรกรรม
      await conn.query(
        `UPDATE users SET wallet_balance = ROUND(wallet_balance - ?, 2) WHERE uid = ?`,
        [totalDue, uid]
      );
      await conn.query(
        `INSERT INTO wallet_transaction (uid, oid, type, amount, note)
         VALUES (?, ?, 'DEBIT', ?, ?)`,
        [uid, oid, totalDue, `Buy-now order #${oid}`]
      );

      // 10) ปิดออเดอร์
      await conn.query(
        `UPDATE orders SET status = 'PAID', paid_at = NOW() WHERE oid = ?`,
        [oid]
      );

      // 11) เพิ่มเกมเข้าไลบรารี
      await conn.query(
        `INSERT IGNORE INTO user_library (uid, gid)
         SELECT ?, ci.gid
           FROM cart_item ci
          WHERE ci.oid = ?`,
        [uid, oid]
      );

      // 12) บันทึกการใช้โปรฯ (ถ้ามี)
      if (promo) {
        await conn.query(
          `INSERT INTO promotion_redemption (pid, uid, oid) VALUES (?, ?, ?)`,
          [promo.pid, uid, oid]
        );
        await conn.query(
          `UPDATE promotion SET used_count = used_count + 1 WHERE pid = ?`,
          [promo.pid]
        );
      }

      const [[finalOrder]] = await conn.query(`SELECT * FROM orders WHERE oid = ?`, [oid]);
      const [items] = await conn.query(
        `SELECT ci.gid, ci.unit_price, g.name
           FROM cart_item ci
           JOIN game g ON g.gid = ci.gid
          WHERE ci.oid = ?`,
        [oid]
      );
      return { order: finalOrder, items, charged: totalDue };
    });

    if (result.error) return res.json({ success: false, message: result.error });

    return res.status(201).json({
      success: true,
      message: "ซื้อสำเร็จ (สร้างออเดอร์-จ่ายเงิน-เข้าคลังเกมเรียบร้อย)",
      order: result.order,
      items: result.items,
      charged: result.charged
    });
  } catch (err) {
    return send500(res, err);
  }
};
