const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middlewares/authMiddleware");
const libController = require("../controllers/libController");

router.get("/", authMiddleware, libController.getLibs);

module.exports = router;
