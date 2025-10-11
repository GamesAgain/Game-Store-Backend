const db = require("../config/db");

exports.getLibs = async (req, res) => {
  const uid = req.user.uid;
  try {
    const [rows] = await db.query(
      `
      SELECT
        ul.lid,
        ul.uid,
        g.gid,
        g.name,
        COALESCE(
          JSON_ARRAYAGG(
            IF(gi.imgid IS NULL, NULL,
              JSON_OBJECT(
                'imgid', gi.imgid,
                'url',   gi.url,
                'created_at', gi.created_at
              )
            )
          ),
          JSON_ARRAY()
        ) AS images
      FROM user_library ul
      JOIN game g       ON g.gid = ul.gid
      LEFT JOIN game_image gi ON gi.gid = g.gid
      WHERE ul.uid = ?
      GROUP BY
        ul.lid, ul.uid,
        g.gid, g.name
      ORDER BY ul.lid DESC
      `,
      [uid]
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching libraries:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
