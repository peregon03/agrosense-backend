import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { registerSchema, loginSchema } from "../schemas/auth.schema.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/email.service.js";

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function saveToken(userId, type) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

  // Invalida tokens anteriores del mismo tipo
  await pool.query(
    "UPDATE auth_tokens SET used = TRUE WHERE user_id = $1 AND type = $2 AND used = FALSE",
    [userId, type]
  );

  await pool.query(
    "INSERT INTO auth_tokens (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)",
    [userId, code, type, expiresAt]
  );

  return code;
}

async function validateToken(userId, code, type) {
  const result = await pool.query(
    `SELECT id FROM auth_tokens
     WHERE user_id = $1 AND token = $2 AND type = $3
       AND used = FALSE AND expires_at > NOW()`,
    [userId, code, type]
  );
  return result.rows[0] ?? null;
}

// ── Registro ────────────────────────────────────────────────────────────────

export async function register(req, res) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });
  }

  const { first_name, last_name, password } = parsed.data;
  const email = parsed.data.email.toLowerCase().trim();

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, is_verified)
     VALUES ($1, $2, $3, $4, FALSE)
     RETURNING id, first_name, last_name, email`,
    [first_name, last_name, email, password_hash]
  );

  const user = result.rows[0];
  const code = await saveToken(user.id, "verify");

  try {
    await sendVerificationEmail(email, code);
  } catch (e) {
    console.error("Error enviando email de verificación:", e.message);
    // El registro fue exitoso aunque el email falle
  }

  return res.status(201).json({ email });
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });
  }

  const { password } = parsed.data;
  const email = parsed.data.email.toLowerCase().trim();

  const result = await pool.query(
    "SELECT id, first_name, last_name, email, password_hash, is_verified FROM users WHERE email = $1",
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

  if (!userRow.is_verified) {
    return res.status(403).json({ message: "Email not verified", email, needsVerification: true });
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

// ── Verificar correo ─────────────────────────────────────────────────────────

export async function verifyEmail(req, res) {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ message: "email y code son requeridos" });
  }

  const userResult = await pool.query(
    "SELECT id, first_name, last_name, email FROM users WHERE email = $1",
    [email.toLowerCase().trim()]
  );
  if (userResult.rows.length === 0) {
    return res.status(404).json({ message: "Usuario no encontrado" });
  }

  const user = userResult.rows[0];
  const tokenRow = await validateToken(user.id, code, "verify");
  if (!tokenRow) {
    return res.status(400).json({ message: "Código inválido o expirado" });
  }

  await pool.query("UPDATE users SET is_verified = TRUE WHERE id = $1", [user.id]);
  await pool.query("UPDATE auth_tokens SET used = TRUE WHERE id = $1", [tokenRow.id]);

  const token = signToken(user);
  return res.json({ token, user });
}

// ── Recuperar contraseña ─────────────────────────────────────────────────────

export async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: "email es requerido" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const result = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);

  if (result.rows.length === 0) {
    return res.status(404).json({ message: "No existe una cuenta con ese correo" });
  }

  const userId = result.rows[0].id;
  const code = await saveToken(userId, "reset");

  try {
    await sendPasswordResetEmail(normalizedEmail, code);
  } catch (e) {
    console.error("Error enviando email de recuperación:", e.message);
    return res.status(500).json({ message: "Error enviando el correo. Intenta de nuevo." });
  }

  return res.json({ email: normalizedEmail });
}

// ── Restablecer contraseña ───────────────────────────────────────────────────

export async function resetPassword(req, res) {
  const { email, code, new_password } = req.body;
  if (!email || !code || !new_password) {
    return res.status(400).json({ message: "email, code y new_password son requeridos" });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (userResult.rows.length === 0) {
    return res.status(404).json({ message: "Usuario no encontrado" });
  }

  const userId = userResult.rows[0].id;
  const tokenRow = await validateToken(userId, code, "reset");
  if (!tokenRow) {
    return res.status(400).json({ message: "Código inválido o expirado" });
  }

  const newHash = await bcrypt.hash(new_password, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, userId]);
  await pool.query("UPDATE auth_tokens SET used = TRUE WHERE id = $1", [tokenRow.id]);

  return res.json({ message: "Contraseña actualizada correctamente" });
}

// ── Reenviar código ──────────────────────────────────────────────────────────

export async function resendCode(req, res) {
  const { email, type } = req.body;
  if (!email || !["verify", "reset"].includes(type)) {
    return res.status(400).json({ message: "email y type ('verify' o 'reset') son requeridos" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (userResult.rows.length === 0) {
    return res.status(404).json({ message: "Usuario no encontrado" });
  }

  const userId = userResult.rows[0].id;

  // Cooldown: 1 minuto entre reenvíos
  const recent = await pool.query(
    `SELECT id FROM auth_tokens WHERE user_id = $1 AND type = $2
       AND used = FALSE AND created_at > NOW() - INTERVAL '1 minute'`,
    [userId, type]
  );
  if (recent.rows.length > 0) {
    return res.status(429).json({ message: "Espera 1 minuto antes de solicitar otro código" });
  }

  const code = await saveToken(userId, type);
  try {
    if (type === "verify") await sendVerificationEmail(normalizedEmail, code);
    else                    await sendPasswordResetEmail(normalizedEmail, code);
  } catch (e) {
    console.error("Error reenviando código:", e.message);
    return res.status(500).json({ message: "Error enviando el correo. Intenta de nuevo." });
  }

  return res.json({ message: "Código reenviado" });
}
