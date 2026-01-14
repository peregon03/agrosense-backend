import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;

/**
 * En la nube (Render / Supabase / Railway):
 *  - usamos DATABASE_URL
 * En local:
 *  - usamos DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */
const dbUrl = process.env.DATABASE_URL;

export const pool = dbUrl
  ? new Pool({
      connectionString: dbUrl,
      // Render y otros PaaS requieren SSL
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

// Test de conexión (usado por /health)
export async function testDb() {
  const res = await pool.query("SELECT NOW() as now");
  return res.rows[0].now;
}

