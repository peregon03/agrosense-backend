import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { sendAlertEmail } from "../services/emailService.js";

const router = Router();

const ingestSchema = z.object({
  device_id:    z.string().min(3),
  api_key:      z.string().min(10),
  temperature:  z.number().optional().nullable(),
  air_humidity: z.number().optional().nullable(),
  co2:          z.number().optional().nullable(),
  methane:      z.number().optional().nullable(),
});

router.post("/", async (req, res) => {
  try {
    const { device_id, api_key, temperature, air_humidity, co2, methane } =
      ingestSchema.parse(req.body);

    // Validar sensor — incluye email del usuario para notificaciones
    const sensor = await pool.query(
      `SELECT s.id, s.user_id, s.is_active, s.name AS sensor_name,
              s.temp_min, s.temp_max,
              s.air_hum_min, s.air_hum_max,
              s.co2_min, s.co2_max,
              s.methane_min, s.methane_max,
              u.email AS user_email
       FROM sensors s
       JOIN users u ON u.id = s.user_id
       WHERE s.device_id=$1 AND s.api_key=$2`,
      [device_id, api_key]
    );

    if (sensor.rowCount === 0) {
      return res.status(401).json({ message: "Sensor no autorizado" });
    }
    if (!sensor.rows[0].is_active) {
      return res.status(403).json({ message: "Sensor desactivado" });
    }

    const row = sensor.rows[0];

    // Guardar lectura
    await pool.query(
      `INSERT INTO sensor_readings (sensor_id, temperature, air_humidity, co2, methane)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.id, temperature ?? null, air_humidity ?? null, co2 ?? null, methane ?? null]
    );

    // ── Verificar umbrales y generar alertas (fail-safe) ──────────────────────
    try {
      const checks = [
        { metric: "temperature",  value: temperature,  min: row.temp_min,    max: row.temp_max    },
        { metric: "air_humidity", value: air_humidity, min: row.air_hum_min, max: row.air_hum_max },
        { metric: "co2",          value: co2,          min: row.co2_min,     max: row.co2_max     },
        { metric: "methane",      value: methane,      min: row.methane_min, max: row.methane_max },
      ];

      for (const { metric, value, min, max } of checks) {
        if (value == null) continue;

        let direction = null;
        let threshold = null;

        if      (max != null && value > max) { direction = "above"; threshold = max; }
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

        sendAlertEmail({
          to:         row.user_email,
          sensorName: row.sensor_name,
          metric,
          value,
          threshold,
          direction,
        }).catch(err => console.error("[EMAIL] Error enviando alerta:", err.message));
      }
    } catch (alertErr) {
      console.error("[ALERT] Error en generación de alertas:", alertErr.message);
    }

    return res.status(201).json({ ok: true });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error ingestando datos" });
  }
});

export default router;
