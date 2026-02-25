import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";

const router = Router();

const ingestSchema = z.object({
  device_id:     z.string().min(3),
  api_key:       z.string().min(10),
  temperature:   z.number().optional().nullable(),
  air_humidity:  z.number().optional().nullable(),
  soil_humidity: z.number().optional().nullable(),
});

router.post("/", async (req, res) => {
  try {
    const { device_id, api_key, temperature, air_humidity, soil_humidity } =
      ingestSchema.parse(req.body);

    // Validar sensor por device_id y api_key
    const sensor = await pool.query(
      `SELECT id, is_active FROM sensors WHERE device_id=$1 AND api_key=$2`,
      [device_id, api_key]
    );

    if (sensor.rowCount === 0) {
      return res.status(401).json({ message: "Sensor no autorizado" });
    }
    if (!sensor.rows[0].is_active) {
      return res.status(403).json({ message: "Sensor desactivado" });
    }

    const sensor_id = sensor.rows[0].id;

    await pool.query(
      `INSERT INTO sensor_readings (sensor_id, temperature, air_humidity, soil_humidity)
       VALUES ($1, $2, $3, $4)`,
      [sensor_id, temperature ?? null, air_humidity ?? null, soil_humidity ?? null]
    );

    return res.status(201).json({ ok: true });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error ingestando datos" });
  }
});

export default router;