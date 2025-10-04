// config/db.js
const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

pool.getConnection()
  .then((conn) => {
    console.log("✅ Connected to MySQL Database");
    conn.release();
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
  });

module.exports = pool;
