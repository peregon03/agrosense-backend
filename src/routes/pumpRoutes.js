import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

// ── GET /api/sensors/:id/pump-schedule ────────────────────────────────────────
// Obtener programación de bomba de un sensor (app)
router.get("/:id/pump-schedule", requireAuth, async (req, res) => {
  try {
    const userId   = req.user.id;
    const sensorId = Number(req.params.id);

    const result = await pool.query(
      `SELECT pump_schedule_enabled, pump_start_time, pump_duration_minutes
       FROM sensors WHERE id=$1 AND user_id=$2`,
      [sensorId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }

    return res.json({ schedule: result.rows[0] });
  } catch (e) {
    return res.status(500).json({ message: "Error obteniendo programación" });
  }
});

// ── PUT /api/sensors/:id/pump-schedule ────────────────────────────────────────
// Guardar programación de bomba (app)
router.put("/:id/pump-schedule", requireAuth, async (req, res) => {
  try {
    const userId   = req.user.id;
    const sensorId = Number(req.params.id);

    const schema = z.object({
      pump_schedule_enabled:   z.boolean(),
      pump_start_time:         z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:MM requerido"),
      pump_duration_minutes:   z.number().int().min(1).max(1440),
    });

    const data = schema.parse(req.body);

    const result = await pool.query(
      `UPDATE sensors
       SET pump_schedule_enabled=$3, pump_start_time=$4, pump_duration_minutes=$5
       WHERE id=$1 AND user_id=$2
       RETURNING pump_schedule_enabled, pump_start_time, pump_duration_minutes`,
      [sensorId, userId,
       data.pump_schedule_enabled,
       data.pump_start_time,
       data.pump_duration_minutes]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }

    return res.json({ schedule: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error guardando programación" });
  }
});

export default router;
