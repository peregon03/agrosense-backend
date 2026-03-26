import bcrypt from "bcryptjs";
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

export async function updateProfile(req, res) {
  const userId = req.user.id;
  const { first_name, last_name, email } = req.body;

  if (!first_name || !last_name || !email) {
    return res.status(400).json({ message: "first_name, last_name y email son requeridos" });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Verificar que el email no esté en uso por otro usuario
  const conflict = await pool.query(
    "SELECT id FROM users WHERE email = $1 AND id != $2",
    [normalizedEmail, userId]
  );
  if (conflict.rows.length > 0) {
    return res.status(409).json({ message: "El correo ya está registrado por otro usuario" });
  }

  const result = await pool.query(
    `UPDATE users SET first_name = $1, last_name = $2, email = $3
     WHERE id = $4
     RETURNING id, first_name, last_name, email`,
    [first_name.trim(), last_name.trim(), normalizedEmail, userId]
  );

  return res.json({ user: result.rows[0] });
}

export async function changePassword(req, res) {
  const userId = req.user.id;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ message: "current_password y new_password son requeridos" });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ message: "La nueva contraseña debe tener al menos 6 caracteres" });
  }

  const result = await pool.query(
    "SELECT password_hash FROM users WHERE id = $1",
    [userId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ message: "Usuario no encontrado" });
  }

  const ok = await bcrypt.compare(current_password, result.rows[0].password_hash);
  if (!ok) {
    return res.status(401).json({ message: "Contraseña actual incorrecta" });
  }

  const newHash = await bcrypt.hash(new_password, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, userId]);

  return res.json({ message: "Contraseña actualizada correctamente" });
}
