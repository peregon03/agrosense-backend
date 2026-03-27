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

    // Validar sensor y obtener umbrales
    const sensor = await pool.query(
      `SELECT id, user_id, is_active,
              temp_min, temp_max,
              air_hum_min, air_hum_max,
              soil_hum_min, soil_hum_max
       FROM sensors WHERE device_id=$1 AND api_key=$2`,
      [device_id, api_key]
    );

    if (sensor.rowCount === 0) {
      return res.status(401).json({ message: "Sensor no autorizado" });
    }
    if (!sensor.rows[0].is_active) {
      return res.status(403).json({ message: "Sensor desactivado" });
    }

    const row = sensor.rows[0];

    await pool.query(
      `INSERT INTO sensor_readings (sensor_id, temperature, air_humidity, soil_humidity)
       VALUES ($1, $2, $3, $4)`,
      [row.id, temperature ?? null, air_humidity ?? null, soil_humidity ?? null]
    );

    // ── Verificar umbrales y generar alertas ──────────────────────────────
    const checks = [
      { metric: "temperature",   value: temperature,   min: row.temp_min,     max: row.temp_max     },
      { metric: "air_humidity",  value: air_humidity,  min: row.air_hum_min,  max: row.air_hum_max  },
      { metric: "soil_humidity", value: soil_humidity, min: row.soil_hum_min, max: row.soil_hum_max },
    ];

    for (const { metric, value, min, max } of checks) {
      if (value == null) continue;

      let direction = null;
      let threshold = null;

      if (max != null && value > max) { direction = "above"; threshold = max; }
      else if (min != null && value < min) { direction = "below"; threshold = min; }

      if (!direction) continue;

      // Anti-spam: no crear alerta si ya hay una igual en los últimos 30 minutos
      const recent = await pool.query(
        `SELECT id FROM sensor_alerts
         WHERE sensor_id=$1 AND metric=$2 AND direction=$3
           AND created_at > NOW() - INTERVAL '30 minutes'
         LIMIT 1`,
        [row.id, metric, direction]
      );

      if (recent.rowCount > 0) continue;

      await pool.query(
        `INSERT INTO sensor_alerts (sensor_id, user_id, metric, value, threshold, direction)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [row.id, row.user_id, metric, value, threshold, direction]
      );
    }

    return res.status(201).json({ ok: true });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error ingestando datos" });
  }
});

export default router;
