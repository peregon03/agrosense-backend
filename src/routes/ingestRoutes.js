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

// ── GET /api/ingest/pump-status ───────────────────────────────────────────────
// El ESP32 llama a esto para saber si debe encender o apagar la bomba.
// Query params: device_id, api_key
router.get("/pump-status", async (req, res) => {
  try {
    const { device_id, api_key } = req.query;
    if (!device_id || !api_key) {
      return res.status(400).json({ message: "device_id y api_key requeridos" });
    }

    const sensorResult = await pool.query(
      `SELECT id, pump_manual_override, pump_override_expires_at
       FROM sensors WHERE LOWER(device_id)=LOWER($1) AND api_key=$2`,
      [device_id, api_key]
    );

    if (sensorResult.rowCount === 0) {
      return res.status(401).json({ message: "Sensor no autorizado" });
    }

    let { id: sensorId, pump_manual_override, pump_override_expires_at } = sensorResult.rows[0];

    // Control manual tiene prioridad, pero verificar si expiró el tiempo máximo de encendido
    if (pump_manual_override !== null && pump_manual_override !== undefined) {
      if (pump_manual_override === true && pump_override_expires_at) {
        const expired = new Date() > new Date(pump_override_expires_at);
        if (expired) {
          // Auto-apagar tras 2 minutos máximo
          await pool.query(
            `UPDATE sensors
             SET pump_manual_override=NULL, pump_override_pending=FALSE, pump_override_expires_at=NULL
             WHERE id=$1`,
            [sensorId]
          );
          pump_manual_override = null; // caer al modo auto a continuación
        } else {
          return res.json({ pump_on: true, mode: "manual" });
        }
      } else {
        return res.json({ pump_on: pump_manual_override, mode: "manual" });
      }
    }

    // Obtener todas las programaciones activas del sensor
    const schedulesResult = await pool.query(
      `SELECT start_time, duration_seconds
       FROM pump_schedules
       WHERE sensor_id=$1 AND enabled=TRUE`,
      [sensorId]
    );

    if (schedulesResult.rowCount === 0) {
      return res.json({ pump_on: false, mode: "auto" });
    }

    // Calcular si la hora actual cae en alguna programación (hora Colombia UTC-5)
    const nowUTC  = new Date();
    const nowCO   = new Date(nowUTC.getTime() - 5 * 60 * 60 * 1000);
    const nowSeconds = nowCO.getUTCHours() * 3600 + nowCO.getUTCMinutes() * 60 + nowCO.getUTCSeconds();

    let pump_on = false;
    for (const { start_time, duration_seconds } of schedulesResult.rows) {
      const [startH, startM] = start_time.toString().split(":").map(Number);
      const startSeconds = startH * 3600 + startM * 60;
      const endSeconds   = startSeconds + duration_seconds;

      // Soporte para rangos que cruzan medianoche
      if (endSeconds <= 86400) {
        if (nowSeconds >= startSeconds && nowSeconds < endSeconds) { pump_on = true; break; }
      } else {
        if (nowSeconds >= startSeconds || nowSeconds < (endSeconds - 86400)) { pump_on = true; break; }
      }
    }

    return res.json({ pump_on, mode: "auto" });
  } catch (e) {
    return res.status(500).json({ message: "Error consultando estado de bomba" });
  }
});

// ── POST /api/ingest/pump-ack ─────────────────────────────────────────────────
// El ESP32 llama a esto para confirmar que recibió la instrucción de bomba.
// Body: { device_id, api_key }
router.post("/pump-ack", async (req, res) => {
  try {
    const { device_id, api_key } = req.body;
    if (!device_id || !api_key) {
      return res.status(400).json({ message: "device_id y api_key requeridos" });
    }

    const result = await pool.query(
      `UPDATE sensors
       SET pump_override_pending = FALSE
       WHERE LOWER(device_id)=LOWER($1) AND api_key=$2
       RETURNING id`,
      [device_id, api_key]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ message: "Sensor no autorizado" });
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Error registrando ACK" });
  }
});

export default router;
