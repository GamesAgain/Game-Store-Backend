// controllers/walletController.js
const db = require("../config/db"); // mysql2/promise pool

// ---------- helpers ----------
function toPosInt(n, def) {
  const x = Number(n);
  return Number.isInteger(x) && x > 0 ? x : def;
}
function parseDateOrNull(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function isValidType(t) {
  return t === "credit" || t === "debit";
}

// GET /wallet/balance/:uid
exports.getUserBalance = async (req, res) => {
  const uid = req.user.uid; // ✅ มาจาก token

  try {
    const [rows] = await db.query("SELECT wallet FROM Users WHERE uid = ?", [uid]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้ใช้" });
    }
    return res.json({ success: true, uid, balance: Number(rows[0].wallet) || 0 });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /wallet/transactions?page=&pageSize=&sort=&startDate=&endDate=
exports.getUserTransactions = async (req, res) => {
  const uid = req.user.uid; // ✅ มาจาก token

  const page = toPosInt(req.query.page, 1);
  const pageSize = Math.min(100, toPosInt(req.query.pageSize, 20));
  const offset = (page - 1) * pageSize;
  const sort = String(req.query.sort || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const startDate = parseDateOrNull(req.query.startDate);
  const endDate = parseDateOrNull(req.query.endDate);

  const where = ["uid = ?"];
  const params = [uid];

  if (startDate) {
    where.push("created_at >= ?");
    params.push(startDate);
  }
  if (endDate) {
    where.push("created_at <= ?");
    params.push(endDate);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const sqlCount = `SELECT COUNT(*) AS total FROM wallet_transactions ${whereSql}`;
  const sqlData = `
    SELECT transaction_id, uid, type, description, amount, created_at
    FROM wallet_transactions
    ${whereSql}
    ORDER BY created_at ${sort}, transaction_id ${sort}
    LIMIT ? OFFSET ?
  `;

  try {
    const [[countRow]] = await db.query(sqlCount, params);
    const total = countRow?.total || 0;
    const [dataRows] = await db.query(sqlData, [...params, pageSize, offset]);

    res.set("X-Total-Count", String(total));
    res.set("X-Page", String(page));
    res.set("X-Page-Size", String(pageSize));

    return res.json({ success: true, data: dataRows });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /wallet/transactions
exports.createTransaction = async (req, res) => {
  const uid = req.user.uid; // ✅ ไม่ให้ user ยิง uid คนอื่น
  const { type, amount, description } = req.body;
  const t = String(type || "").toLowerCase();

  if (!isValidType(t) || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "type('credit'|'debit') และ amount (จำนวนเต็ม > 0) ต้องถูกต้อง"
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query("SELECT wallet FROM Users WHERE uid = ? FOR UPDATE", [uid]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้ใช้" });
    }

    const current = Number(rows[0].wallet) || 0;
    const delta = t === "credit" ? amount : -amount;
    const next = current + delta;

    if (t === "debit" && next < 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "ยอดเงินไม่เพียงพอ" });
    }

    await conn.query("UPDATE Users SET wallet = ? WHERE uid = ?", [next, uid]);
    const [r] = await conn.query(
      `INSERT INTO wallet_transactions (uid, type, description, amount, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [uid, t, description || null, amount]
    );

    await conn.commit();
    return res.status(201).json({
      success: true,
      message: "บันทึกรายการเดินบัญชีสำเร็จ",
      transaction_id: r.insertId,
      type: t,
      uid,
      new_balance: next
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

// ------------------ Deposit / Withdraw / Transfer ------------------

// POST /wallet/topup
exports.topup = async (req, res) => {
  const uid = req.user.uid;
  const { amount, description } = req.body;
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: "amount (>0) ต้องถูกต้อง" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await exports.createTransactionInExistingTx(conn, {
      uid,
      type: "credit",
      amount,
      description: description ?? "โอนเงินเข้า"
    });
    await conn.commit();
    return res.status(201).json({ success: true, action: "topup", uid, ...result });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

// POST /wallet/withdraw
exports.withdraw = async (req, res) => {
  const uid = req.user.uid;
  const { amount, description } = req.body;
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: "amount (>0) ต้องถูกต้อง" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await exports.createTransactionInExistingTx(conn, {
      uid,
      type: "debit",
      amount,
      description: description ?? "ถอนเงินออก",
      preventNegative: true
    });
    await conn.commit();
    return res.status(201).json({ success: true, action: "withdraw", uid, ...result });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    const code = /ยอดเงินไม่เพียงพอ/.test(err.message) ? 400 : 500;
    return res.status(code).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

// POST /wallet/transfer   { toUid, amount, description? }
exports.transfer = async (req, res) => {
  const fromUid = req.user.uid;   // login user
  const { toUsername, amount, description } = req.body;

  if (!toUsername || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "ต้องระบุ toUsername และ amount (>0)"
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ✅ ดึงข้อมูลผู้รับจาก username
    const [toUsers] = await conn.query(
      "SELECT uid, wallet FROM Users WHERE username = ? FOR UPDATE",
      [toUsername]
    );
    if (toUsers.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้ใช้ปลายทาง" });
    }

    // ✅ ดึงข้อมูลผู้โอน (fromUid)
    const [fromUsers] = await conn.query(
      "SELECT uid, wallet FROM Users WHERE uid = ? FOR UPDATE",
      [fromUid]
    );
    if (fromUsers.length === 0) {
      await conn.rollback();
      return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้โอน" });
    }

    const fromRow = fromUsers[0];
    const toRow   = toUsers[0];

    if (fromRow.uid === toRow.uid) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "ห้ามโอนเข้าบัญชีตัวเอง" });
    }

    const fromBal = Number(fromRow.wallet) || 0;
    const toBal   = Number(toRow.wallet) || 0;

    if (fromBal < amount) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: "ยอดเงินไม่เพียงพอ" });
    }

    const newFrom = fromBal - amount;
    const newTo   = toBal + amount;

    // ✅ update
    await conn.query("UPDATE Users SET wallet = ? WHERE uid = ?", [newFrom, fromRow.uid]);
    await conn.query("UPDATE Users SET wallet = ? WHERE uid = ?", [newTo, toRow.uid]);

    const noteFrom = description ?? `transfer to ${toUsername}`;
    const noteTo   = description ?? `transfer from uid:${fromUid}`;

    const [r1] = await conn.query(
      `INSERT INTO wallet_transactions (uid, type, description, amount, created_at)
       VALUES (?, 'debit', ?, ?, NOW())`,
      [fromRow.uid, noteFrom, amount]
    );
    const [r2] = await conn.query(
      `INSERT INTO wallet_transactions (uid, type, description, amount, created_at)
       VALUES (?, 'credit', ?, ?, NOW())`,
      [toRow.uid, noteTo, amount]
    );

    await conn.commit();
    return res.status(201).json({
      success: true,
      message: "โอนเงินสำเร็จ",
      from: { uid: fromRow.uid, new_balance: newFrom, transaction_id: r1.insertId },
      to:   { uid: toRow.uid,   new_balance: newTo,   transaction_id: r2.insertId },
      amount
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};


exports.createTransactionInExistingTx = async (
  conn,
  { uid, type, amount, description, preventNegative = true }
) => {
  const t = String(type || "").toLowerCase();
  if (!uid || !isValidType(t) || !Number.isInteger(amount) || amount <= 0) {
    throw new Error("invalid transaction payload");
  }

  const [rows] = await conn.query("SELECT wallet FROM Users WHERE uid = ? FOR UPDATE", [uid]);
  if (rows.length === 0) throw new Error("ไม่พบบัญชีผู้ใช้");

  const current = Number(rows[0].wallet) || 0;
  const delta = t === "credit" ? amount : -amount;
  const next = current + delta;

  if (preventNegative && next < 0) {
    throw new Error("ยอดเงินไม่เพียงพอ");
  }

  await conn.query("UPDATE Users SET wallet = ? WHERE uid = ?", [next, uid]);
  const [r] = await conn.query(
    `INSERT INTO wallet_transactions (uid, type, description, amount, created_at)
     VALUES (?, ?, ?, ?, NOW())`,
    [uid, t, description || null, amount]
  );

  return { transaction_id: r.insertId, new_balance: next, type: t };
};