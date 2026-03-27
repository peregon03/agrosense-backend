import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

// Listar alertas del usuario (últimas 100)
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT a.id, a.sensor_id, s.name AS sensor_name,
              a.metric, a.value, a.threshold, a.direction, a.read, a.created_at
       FROM sensor_alerts a
       JOIN sensors s ON s.id = a.sensor_id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [userId]
    );
    const unread_count = result.rows.filter(r => !r.read).length;
    return res.json({ alerts: result.rows, unread_count });
  } catch (e) {
    return res.status(500).json({ message: "Error consultando alertas" });
  }
});

// Marcar todas las alertas del usuario como leídas
router.put("/read-all", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    await pool.query(
      `UPDATE sensor_alerts SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
      [userId]
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Error actualizando alertas" });
  }
});

export default router;
