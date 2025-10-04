const { verifyToken } = require("../utils/jwt");

exports.authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "กรุณาเข้าสู่ระบบก่อน" });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ success: false, message: "Token ไม่ถูกต้อง" });
  }

  req.user = decoded;
  next();
};

exports.verifyAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "เฉพาะ admin เท่านั้น" });
  }
  next();
};