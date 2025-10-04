const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET || "GameStore_secret_key";

exports.generateToken = (user) => {
  return jwt.sign(
    {
      uid: user.uid,
      username: user.username,
      role: user.role,
    },
    SECRET,
    { expiresIn: "7d" }
  );
};

exports.verifyToken = (token) => {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
};