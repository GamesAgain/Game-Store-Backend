const db = require("../config/db"); // mysql2/promise pool

// ---------- helpers ----------
const isAdmin = (req) => req?.user?.role === "ADMIN";

function toPosInt(n, def) {
  const x = Number(n);
  return Number.isInteger(x) && x > 0 ? x : def;
}
function parseDateOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function isPositiveAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}
function normType(t) {
  const s = String(t || "").toUpperCase();
  return s === "CREDIT" || s === "DEBIT" ? s : null;
}

// ---------- Balance ----------
exports.getMyBalance = async (req, res) => {
  const uid = req.user.uid;
  try {
    const [[row]] = await db.query("SELECT wallet_balance FROM users WHERE uid = ? LIMIT 1", [uid]);
    if (!row) return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้ใช้" });
    return res.json({ success: true, uid, balance: Number(row.wallet_balance) || 0 });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getBalanceByUid = async (req, res) => {
  const targetUid = Number(req.params.uid);
  if (!Number.isInteger(targetUid) || targetUid <= 0)
    return res.status(400).json({ success: false, message: "uid ไม่ถูกต้อง" });

  // อนุญาตเฉพาะ ADMIN หรือเจ้าของเอง
  if (!isAdmin(req) && targetUid !== req.user.uid)
    return res.status(403).json({ success: false, message: "ไม่ได้รับอนุญาต" });

  try {
    const [[row]] = await db.query("SELECT wallet_balance FROM users WHERE uid = ? LIMIT 1", [targetUid]);
    if (!row) return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้ใช้" });
    return res.json({ success: true, uid: targetUid, balance: Number(row.wallet_balance) || 0 });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ---------- Transactions (list) ----------
async function listTransactions(req, res, uid) {
  const page = toPosInt(req.query.page, 1);
  const pageSize = Math.min(100, toPosInt(req.query.pageSize, 20));
  const offset = (page - 1) * pageSize;
  const sort = String(req.query.sort || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const startDate = parseDateOrNull(req.query.startDate);
  const endDate = parseDateOrNull(req.query.endDate);

  const where = ["uid = ?"];
  const params = [uid];
  if (startDate) { where.push("created_at >= ?"); params.push(startDate); }
  if (endDate)   { where.push("created_at <= ?"); params.push(endDate); }

  const whereSql = `WHERE ${where.join(" AND ")}`;

  try {
    const [[countRow]] = await db.query(`SELECT COUNT(*) AS total FROM wallet_transaction ${whereSql}`, params);
    const total = Number(countRow?.total || 0);

    const [rows] = await db.query(
      `SELECT wid, uid, oid, type, amount, note, created_at
         FROM wallet_transaction
        ${whereSql}
        ORDER BY created_at ${sort}, wid ${sort}
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.set("X-Total-Count", String(total));
    res.set("X-Page", String(page));
    res.set("X-Page-Size", String(pageSize));

    return res.json({ success: true, data: rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

exports.getMyTransactions = async (req, res) => listTransactions(req, res, req.user.uid);

exports.getTransactionsByUid = async (req, res) => {
  const targetUid = Number(req.params.uid);
  if (!Number.isInteger(targetUid) || targetUid <= 0)
    return res.status(400).json({ success: false, message: "uid ไม่ถูกต้อง" });
  if (!isAdmin(req) && targetUid !== req.user.uid)
    return res.status(403).json({ success: false, message: "ไม่ได้รับอนุญาต" });
  return listTransactions(req, res, targetUid);
};

// ---------- Create raw transaction (self only) ----------
exports.createTransaction = async (req, res) => {
  const uid = req.user.uid;
  const type = normType(req.body.type);
  const amount = Number(req.body.amount);
  const note = req.body.note ?? null;

  if (!type || !isPositiveAmount(amount))
    return res.status(400).json({ success: false, message: "type(CREDIT|DEBIT) และ amount (>0) ต้องถูกต้อง" });

  const preventNegative = type === "DEBIT";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await createTransactionInExistingTx(conn, {
      uid, type, amount, note, preventNegative
    });
    await conn.commit();
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    const code = /ยอดเงินไม่เพียงพอ/.test(err.message) ? 400 : 500;
    return res.status(code).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

// ---------- Money operations ----------
exports.topup = async (req, res) => {
  const uid = req.user.uid;
  const amount = Number(req.body.amount);
  const note = req.body.note ?? "Topup";
  if (!isPositiveAmount(amount))
    return res.status(400).json({ success: false, message: "amount (>0) ต้องถูกต้อง" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await createTransactionInExistingTx(conn, {
      uid, type: "CREDIT", amount, note
    });
    await conn.commit();
    return res.status(201).json({ success: true, action: "topup", ...result });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

exports.withdraw = async (req, res) => {
  const uid = req.user.uid;
  const amount = Number(req.body.amount);
  const note = req.body.note ?? "Withdraw";
  if (!isPositiveAmount(amount))
    return res.status(400).json({ success: false, message: "amount (>0) ต้องถูกต้อง" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await createTransactionInExistingTx(conn, {
      uid, type: "DEBIT", amount, note, preventNegative: true
    });
    await conn.commit();
    return res.status(201).json({ success: true, action: "withdraw", ...result });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    const code = /ยอดเงินไม่เพียงพอ/.test(err.message) ? 400 : 500;
    return res.status(code).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

// { toUsername, amount, note? }
exports.transfer = async (req, res) => {
  const fromUid = req.user.uid;
  const { toUsername } = req.body || {};
  const amount = Number(req.body.amount);
  const note = req.body.note ?? null;

  if (!toUsername || !isPositiveAmount(amount))
    return res.status(400).json({ success: false, message: "ต้องระบุ toUsername และ amount (>0)" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // lock receiver
    const [[toUser]] = await conn.query(
      "SELECT uid, wallet_balance FROM users WHERE username = ? FOR UPDATE",
      [toUsername]
    );
    if (!toUser) throw new Error("ไม่พบบัญชีผู้ใช้ปลายทาง");

    // lock sender
    const [[fromUser]] = await conn.query(
      "SELECT uid, wallet_balance FROM users WHERE uid = ? FOR UPDATE",
      [fromUid]
    );
    if (!fromUser) throw new Error("ไม่พบบัญชีผู้โอน");

    if (fromUser.uid === toUser.uid) throw new Error("ห้ามโอนเข้าบัญชีตัวเอง");

    const fromBal = Number(fromUser.wallet_balance) || 0;
    const toBal = Number(toUser.wallet_balance) || 0;

    if (fromBal < amount) throw new Error("ยอดเงินไม่เพียงพอ");

    const newFrom = +(fromBal - amount).toFixed(2);
    const newTo = +(toBal + amount).toFixed(2);

    await conn.query("UPDATE users SET wallet_balance = ? WHERE uid = ?", [newFrom, fromUser.uid]);
    await conn.query("UPDATE users SET wallet_balance = ? WHERE uid = ?", [newTo, toUser.uid]);

    const noteFrom = note ?? `transfer to ${toUsername}`;
    const noteTo   = note ?? `transfer from uid:${fromUid}`;

    const [r1] = await conn.query(
      `INSERT INTO wallet_transaction (uid, type, amount, note, created_at)
       VALUES (?, 'DEBIT', ?, ?, NOW())`,
      [fromUser.uid, amount, noteFrom]
    );
    const [r2] = await conn.query(
      `INSERT INTO wallet_transaction (uid, type, amount, note, created_at)
       VALUES (?, 'CREDIT', ?, ?, NOW())`,
      [toUser.uid, amount, noteTo]
    );

    await conn.commit();
    return res.status(201).json({
      success: true,
      message: "โอนเงินสำเร็จ",
      from: { uid: fromUser.uid, new_balance: newFrom, wid: r1.insertId },
      to:   { uid: toUser.uid,   new_balance: newTo,   wid: r2.insertId },
      amount
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

// ---------- Internal: create tx within an existing transaction ----------
async function createTransactionInExistingTx(
  conn,
  { uid, type, amount, note, preventNegative = false, oid = null }
) {
  const T = normType(type);
  if (!uid || !T || !isPositiveAmount(amount)) throw new Error("invalid transaction payload");

  const [[row]] = await conn.query(
    "SELECT wallet_balance FROM users WHERE uid = ? FOR UPDATE",
    [uid]
  );
  if (!row) throw new Error("ไม่พบบัญชีผู้ใช้");

  const current = Number(row.wallet_balance) || 0;
  const delta = T === "CREDIT" ? amount : -amount;
  const next = +(current + delta).toFixed(2);

  if (preventNegative && next < 0) throw new Error("ยอดเงินไม่เพียงพอ");

  await conn.query("UPDATE users SET wallet_balance = ? WHERE uid = ?", [next, uid]);
  const [r] = await conn.query(
    `INSERT INTO wallet_transaction (uid, oid, type, amount, note, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [uid, oid, T, amount, note ?? null]
  );

  return { wid: r.insertId, uid, type: T, amount, new_balance: next };
}

// export helper for other modules (e.g., orders)
exports.createTransactionInExistingTx = createTransactionInExistingTx;
