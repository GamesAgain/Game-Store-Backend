const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
require("dotenv").config();

const authRoutes = require("./src/routes/authRoutes");
const gameRoutes = require("./src/routes/gameRoutes");
const orderRoutes = require("./src/routes/orderRoutes");
const walletRoutes = require("./src/routes/walletRoutes");
const adminRoutes = require("./src/routes/adminRoutes");
const uploadRoutes = require("./src/routes/uploadRoutes");
const profileRoutes = require("./src/routes/profileRoutes");

const app = express();
const os = require("os");

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}
const ip = getLocalIP();

app.use(cors());
app.use(bodyParser.json());

app.use("/api/auth", authRoutes);
app.use("/api/game", gameRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/profile", profileRoutes);
app.get("/", (req, res) => {
  res.send("Hello GameShop");
});


app.use("/api/upload", uploadRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://${ip}:${port}`);
});