import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

const createSensorSchema = z.object({
  device_id: z.string().min(3),
  name: z.string().min(2),
  location: z.string().max(160).optional().nullable(),
});

// Crear sensor
router.post("/", requireAuth, async (req, res) => {
  try {
    const { device_id, name, location } = createSensorSchema.parse(req.body);
    const userId = req.user.id;
    const api_key = crypto.randomBytes(24).toString("hex");

    const result = await pool.query(
      `INSERT INTO sensors (user_id, device_id, name, location, api_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, device_id, name, location, is_active, created_at, api_key`,
      [userId, device_id, name, location ?? null, api_key]
    );

    return res.status(201).json({ sensor: result.rows[0] });
  } catch (e) {
    if (e?.code === "23505") {
      return res.status(409).json({ message: "Ese device_id ya está registrado" });
    }
    return res.status(400).json({ message: e.message ?? "Error creando sensor" });
  }
});

// Listar sensores del usuario
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT id, user_id, device_id, name, location, is_active, created_at
       FROM sensors
       WHERE user_id = $1
       ORDER BY id DESC`,
      [userId]
    );
    return res.json({ sensors: result.rows });
  } catch (e) {
    return res.status(500).json({ message: "Error listando sensores" });
  }
});

// Eliminar sensor
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const sensorId = Number(req.params.id);

    const result = await pool.query(
      `DELETE FROM sensors WHERE id = $1 AND user_id = $2 RETURNING id`,
      [sensorId, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Error eliminando sensor" });
  }
});

// Lecturas de un sensor por rango de fecha
router.get("/:id/readings", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const sensorId = Number(req.params.id);

    const intervalMap = {
      today:   "24 hours",
      week:    "7 days",
      month:   "30 days",
      quarter: "90 days",
    };
    const range = Object.hasOwn(intervalMap, req.query.range ?? "") ? req.query.range : "today";
    const interval = intervalMap[range];

    const sensorCheck = await pool.query(
      `SELECT id FROM sensors WHERE id=$1 AND user_id=$2`,
      [sensorId, userId]
    );
    if (sensorCheck.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }

    const readings = await pool.query(
      `SELECT id, sensor_id, temperature, air_humidity, soil_humidity, created_at
       FROM sensor_readings
       WHERE sensor_id = $1
         AND created_at >= NOW() - INTERVAL '${interval}'
       ORDER BY created_at ASC`,
      [sensorId]
    );

    return res.json({
      readings: readings.rows,
      range,
      count: readings.rowCount,
    });
  } catch (e) {
    return res.status(500).json({ message: "Error consultando lecturas" });
  }
});

export default router;