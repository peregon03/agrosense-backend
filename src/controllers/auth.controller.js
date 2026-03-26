import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { registerSchema, loginSchema } from "../schemas/auth.schema.js";

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

export async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
  }

  const { first_name, last_name, password } = parsed.data;
  const email = parsed.data.email.toLowerCase().trim();

  // Verificar si ya existe
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (first_name, last_name, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, first_name, last_name, email, created_at`,
    [first_name, last_name, email, password_hash]
  );

  const user = result.rows[0];
  const token = signToken(user);

  return res.status(201).json({ token, user });
}

export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
  }

  const { password } = parsed.data;
  const email = parsed.data.email.toLowerCase().trim();

  const result = await pool.query(
    "SELECT id, first_name, last_name, email, password_hash FROM users WHERE email = $1",
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const userRow = result.rows[0];
  const ok = await bcrypt.compare(password, userRow.password_hash);
  if (!ok) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const user = {
    id: userRow.id,
    first_name: userRow.first_name,
    last_name: userRow.last_name,
    email: userRow.email,
  };

  const token = signToken(user);
  return res.json({ token, user });
}
