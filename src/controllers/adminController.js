// controllers/adminController.js
const db = require("../config/db");

exports.resetSystem = async (req, res) => {
  try {
    global.lastSpecialResults = {}; // เคลียร์ memory (สำหรับรางวัล 4–5)

    // ลบ child ก่อน parent เพื่อไม่ให้ติด foreign key
    await db.query("DELETE FROM Bounty");
    await db.query("DELETE FROM Orders");
    await db.query("DELETE FROM Lotto");
    await db.query("DELETE FROM wallet_transactions");

    // ลบ Users ทั้งหมด ยกเว้น admin
    await db.query("DELETE FROM Users WHERE role != 'admin'");

    return res.json({
      success: true,
      message: "รีเซ็ตระบบสำเร็จ (ลบทุกอย่าง ยกเว้น admin)"
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};