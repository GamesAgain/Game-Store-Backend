// controllers/walletController.js
const db = require("../config/db"); // mysql2/promise pool

// ---------- helpers ----------
const as2 = (n) => Math.round(n * 100) / 100;

function parseAmount2(v) {
  const n = Number(v);
  if (!isFinite(n)) return null;
  const r = as2(n);
  return r > 0 ? r : null;
}
function toPosInt(n, def) {
  const x = Number(n);
  return Number.isInteger(x) && x > 0 ? x : def;
}
function parseDateOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function normType(t) {
  const k = String(t || "").toUpperCase();
  return k === "CREDIT" || k === "DEBIT" ? k : null;
}
function canSee(uidFromToken, roleFromToken, targetUid) {
  return roleFromToken === "ADMIN" || Number(uidFromToken) === Number(targetUid);
}
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

// ===================== Controllers =====================

// 3.1 GET /wallet/balance/:uid?
exports.getUserBalance = async (req, res) => {
  const requesterUid = req.user.uid;
  const requesterRole = req.user.role;
  const targetUid = req.params.uid ?? requesterUid;

  if (!canSee(requesterUid, requesterRole, targetUid)) {
    return res.status(403).json({ success: false, message: "forbidden" });
  }

  try {
    // ตามสคีมา: ตาราง users คอลัมน์ wallet_balance (DECIMAL(12,2))
    const [rows] = await db.query(
      "SELECT uid, wallet_balance FROM users WHERE uid = ?",
      [targetUid]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้ใช้" });
    }
    return res.json({
      success: true,
      uid: rows[0].uid,
      balance: Number(rows[0].wallet_balance) || 0,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 3.3/3.4 GET /wallet/transactions/:uid?  (page,pageSize,sort,startDate,endDate)
exports.getUserTransactions = async (req, res) => {
  const requesterUid = req.user.uid;
  const requesterRole = req.user.role;
  const targetUid = req.params.uid ?? requesterUid;

  if (!canSee(requesterUid, requesterRole, targetUid)) {
    return res.status(403).json({ success: false, message: "forbidden" });
  }

  const page = toPosInt(req.query.page, 1);
  const pageSize = Math.min(100, toPosInt(req.query.pageSize, 20));
  const offset = (page - 1) * pageSize;
  const sort = String(req.query.sort || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const startDate = parseDateOrNull(req.query.startDate);
  const endDate = parseDateOrNull(req.query.endDate);

  const where = ["uid = ?"];
  const params = [targetUid];

  if (startDate) { where.push("created_at >= ?"); params.push(startDate); }
  if (endDate)   { where.push("created_at <= ?"); params.push(endDate); }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  // ตาราง = wallet_transaction (เอกพจน์), คอลัมน์ wid/uid/oid/type/amount/note/created_at
  const sqlCount = `SELECT COUNT(*) AS total FROM wallet_transaction ${whereSql}`;
  const sqlData = `
    SELECT wid, uid, oid, type, amount, note, created_at
      FROM wallet_transaction
     ${whereSql}
     ORDER BY created_at ${sort}, wid ${sort}
     LIMIT ? OFFSET ?
  `;

  try {
    const [[countRow]] = await db.query(sqlCount, params);
    const total = Number(countRow?.total || 0);
    const [dataRows] = await db.query(sqlData, [...params, pageSize, offset]);

    res.set("X-Total-Count", String(total));
    res.set("X-Page", String(page));
    res.set("X-Page-Size", String(pageSize));

    return res.json({ success: true, data: dataRows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 3.2/low-level POST /wallet/transactions  ({ type: CREDIT|DEBIT, amount, note? })
exports.createTransaction = async (req, res) => {
  const uid = req.user.uid; // ไม่เปิดให้ยิงแทนคนอื่น (ถ้าจะทำ admin tool ให้เพิ่มเช็ค role และ body.uid)
  const t = normType(req.body.type);
  const amt = parseAmount2(req.body.amount);
  const note = req.body.note || null;

  if (!t || amt == null) {
    return res.status(400).json({
      success: false,
      message: "type: CREDIT|DEBIT และ amount > 0 (ทศนิยม 2 ตำแหน่ง) ต้องถูกต้อง",
    });
  }

  try {
    const result = await withTx(async (conn) => {
      const [[row]] = await conn.query(
        "SELECT wallet_balance FROM users WHERE uid = ? FOR UPDATE",
        [uid]
      );
      if (!row) return { error: "ไม่พบบัญชีผู้ใช้" };

      const current = Number(row.wallet_balance) || 0;
      const next = t === "CREDIT" ? as2(current + amt) : as2(current - amt);

      if (t === "DEBIT" && next < 0) {
        return { error: "ยอดเงินไม่เพียงพอ" };
      }

      await conn.query(
        "UPDATE users SET wallet_balance = ? WHERE uid = ?",
        [next, uid]
      );
      const [ins] = await conn.query(
        `INSERT INTO wallet_transaction (uid, oid, type, amount, note, created_at)
         VALUES (?, NULL, ?, ?, ?, NOW())`,
        [uid, t, amt, note]
      );

      return { new_balance: next, wid: ins.insertId };
    });

    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.status(201).json({
      success: true,
      uid,
      type: t,
      amount: amt,
      new_balance: result.new_balance,
      wid: result.wid,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 3.2 POST /wallet/topup  ({ amount, note? })
exports.topup = async (req, res) => {
  const uid = req.user.uid;
  const amt = parseAmount2(req.body.amount);
  const note = req.body.note ?? "Top up";

  if (amt == null) {
    return res.status(400).json({ success: false, message: "amount > 0 ไม่ถูกต้อง" });
  }

  try {
    const result = await withTx(async (conn) => {
      const [[row]] = await conn.query(
        "SELECT wallet_balance FROM users WHERE uid = ? FOR UPDATE",
        [uid]
      );
      if (!row) return { error: "ไม่พบบัญชีผู้ใช้" };

      const next = as2(Number(row.wallet_balance) + amt);

      await conn.query("UPDATE users SET wallet_balance = ? WHERE uid = ?", [next, uid]);
      const [ins] = await conn.query(
        `INSERT INTO wallet_transaction (uid, oid, type, amount, note, created_at)
         VALUES (?, NULL, 'CREDIT', ?, ?, NOW())`,
        [uid, amt, note]
      );

      return { new_balance: next, wid: ins.insertId };
    });

    if (result.error) return res.status(404).json({ success: false, message: result.error });

    return res.status(201).json({
      success: true,
      action: "topup",
      uid,
      amount: amt,
      new_balance: result.new_balance,
      wid: result.wid,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /wallet/withdraw  ({ amount, note? })
exports.withdraw = async (req, res) => {
  const uid = req.user.uid;
  const amt = parseAmount2(req.body.amount);
  const note = req.body.note ?? "Withdraw";

  if (amt == null) {
    return res.status(400).json({ success: false, message: "amount > 0 ไม่ถูกต้อง" });
  }

  try {
    const result = await withTx(async (conn) => {
      const [[row]] = await conn.query(
        "SELECT wallet_balance FROM users WHERE uid = ? FOR UPDATE",
        [uid]
      );
      if (!row) return { error: "ไม่พบบัญชีผู้ใช้" };

      const current = Number(row.wallet_balance) || 0;
      if (current < amt) return { error: "ยอดเงินไม่เพียงพอ" };

      const next = as2(current - amt);

      await conn.query("UPDATE users SET wallet_balance = ? WHERE uid = ?", [next, uid]);
      const [ins] = await conn.query(
        `INSERT INTO wallet_transaction (uid, oid, type, amount, note, created_at)
         VALUES (?, NULL, 'DEBIT', ?, ?, NOW())`,
        [uid, amt, note]
      );

      return { new_balance: next, wid: ins.insertId };
    });

    if (result.error) return res.status(400).json({ success: false, message: result.error });

    return res.status(201).json({
      success: true,
      action: "withdraw",
      uid,
      amount: amt,
      new_balance: result.new_balance,
      wid: result.wid,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 3.2 (ขยาย) POST /wallet/transfer  ({ toUsername, amount, note? })
exports.transfer = async (req, res) => {
  const fromUid = req.user.uid;
  const toUsername = req.body.toUsername;
  const amt = parseAmount2(req.body.amount);
  const baseNote = req.body.note || null;

  if (!toUsername || amt == null) {
    return res.status(400).json({ success: false, message: "ต้องระบุ toUsername และ amount > 0" });
  }

  try {
    const result = await withTx(async (conn) => {
      // หา toUid ก่อน
      const [[toUser]] = await conn.query(
        "SELECT uid FROM users WHERE username = ?",
        [toUsername]
      );
      if (!toUser) return { error: "ไม่พบบัญชีปลายทาง" };
      const toUid = Number(toUser.uid);

      if (toUid === Number(fromUid)) return { error: "ห้ามโอนเข้าบัญชีตัวเอง" };

      // ล็อกทั้งสองฝั่งแบบสั่งรวมเพื่อลดโอกาส deadlock
      const [locked] = await conn.query(
        "SELECT uid, wallet_balance FROM users WHERE uid IN (?, ?) FOR UPDATE",
        [fromUid, toUid]
      );
      if (locked.length !== 2) return { error: "บัญชีไม่พร้อมทำรายการ" };

      const fromRow = locked.find(r => Number(r.uid) === Number(fromUid));
      const toRow   = locked.find(r => Number(r.uid) === Number(toUid));

      const fromBal = Number(fromRow.wallet_balance) || 0;
      const toBal   = Number(toRow.wallet_balance) || 0;

      if (fromBal < amt) return { error: "ยอดเงินไม่เพียงพอ" };

      const newFrom = as2(fromBal - amt);
      const newTo   = as2(toBal + amt);

      await conn.query("UPDATE users SET wallet_balance = ? WHERE uid = ?", [newFrom, fromUid]);
      await conn.query("UPDATE users SET wallet_balance = ? WHERE uid = ?", [newTo, toUid]);

      const noteFrom = baseNote ?? `transfer to ${toUsername}`;
      const noteTo   = baseNote ?? `transfer from uid:${fromUid}`;

      const [r1] = await conn.query(
        `INSERT INTO wallet_transaction (uid, oid, type, amount, note, created_at)
         VALUES (?, NULL, 'DEBIT', ?, ?, NOW())`,
        [fromUid, amt, noteFrom]
      );
      const [r2] = await conn.query(
        `INSERT INTO wallet_transaction (uid, oid, type, amount, note, created_at)
         VALUES (?, NULL, 'CREDIT', ?, ?, NOW())`,
        [toUid, amt, noteTo]
      );

      return {
        from: { uid: Number(fromUid), new_balance: newFrom, wid: r1.insertId },
        to:   { uid: Number(toUid),   new_balance: newTo,   wid: r2.insertId },
        amount: amt,
      };
    });

    if (result.error) return res.status(400).json({ success: false, message: result.error });

    return res.status(201).json({ success: true, message: "โอนเงินสำเร็จ", ...result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ===== shared for orderController (ถ้าต้องการเรียกใช้ซ้ำ) =====
exports.createTransactionInExistingTx = async (
  conn,
  { uid, type, amount, note = null, preventNegative = true, oid = null }
) => {
  const t = normType(type);
  const amt = parseAmount2(amount);
  if (!uid || !t || amt == null) {
    throw new Error("invalid transaction payload");
  }

  const [[row]] = await conn.query(
    "SELECT wallet_balance FROM users WHERE uid = ? FOR UPDATE",
    [uid]
  );
  if (!row) throw new Error("ไม่พบบัญชีผู้ใช้");

  const current = Number(row.wallet_balance) || 0;
  const next = t === "CREDIT" ? as2(current + amt) : as2(current - amt);
  if (preventNegative && next < 0) throw new Error("ยอดเงินไม่เพียงพอ");

  await conn.query("UPDATE users SET wallet_balance = ? WHERE uid = ?", [next, uid]);
  const [ins] = await conn.query(
    `INSERT INTO wallet_transaction (uid, oid, type, amount, note, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [uid, oid, t, amt, note]
  );

  return { wid: ins.insertId, new_balance: next, type: t, amount: amt };
};
