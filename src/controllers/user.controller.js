import { pool } from "../db.js";

export async function me(req, res) {
  const userId = req.user.id;

  const result = await pool.query(
    "SELECT id, first_name, last_name, email, created_at FROM users WHERE id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ message: "User not found" });
  }

  return res.json({ user: result.rows[0] });
}
