import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { checkSensorAccess } from "../middleware/sensorAccess.js";

const router = Router();

const createSensorSchema = z.object({
  device_id: z.string().min(3),
  name: z.string().min(2),
  location: z.string().max(160).optional().nullable(),
});

// ── Crear sensor ──────────────────────────────────────────────────────────────
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

// ── Listar sensores del usuario ───────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT id, user_id, device_id, name, location, is_active, created_at, api_key,
              temp_min, temp_max, air_hum_min, air_hum_max, co2_min, co2_max, methane_min, methane_max,
              pump_manual_override
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

// ── Listar sensores eliminados (respaldos) ────────────────────────────────────
router.get("/deleted", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT id, original_id, sensor_data, schedules_data, readings_count, deleted_at, expires_at
       FROM deleted_sensors_backup
       WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY deleted_at DESC`,
      [userId]
    );
    return res.json({ backups: result.rows });
  } catch (e) {
    return res.status(500).json({ message: "Error listando respaldos" });
  }
});

// ── Restaurar sensor eliminado ────────────────────────────────────────────────
router.post("/deleted/:backupId/restore", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId   = req.user.id;
    const backupId = Number(req.params.backupId);

    await client.query("BEGIN");

    // Obtener el respaldo
    const backupResult = await client.query(
      `SELECT * FROM deleted_sensors_backup WHERE id=$1 AND user_id=$2 AND expires_at > NOW()`,
      [backupId, userId]
    );
    if (backupResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Respaldo no encontrado o expirado" });
    }

    const backup      = backupResult.rows[0];
    const sensorData  = backup.sensor_data;
    const schedules   = backup.schedules_data ?? [];
    const readings    = backup.readings_data  ?? [];

    // Verificar que el device_id no esté en uso
    const existing = await client.query(
      "SELECT id FROM sensors WHERE device_id=$1",
      [sensorData.device_id]
    );
    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        message: `El device_id "${sensorData.device_id}" ya está en uso por otro sensor`
      });
    }

    // Re-insertar sensor
    const sensorResult = await client.query(
      `INSERT INTO sensors
         (user_id, device_id, name, location, api_key,
          temp_min, temp_max, air_hum_min, air_hum_max,
          co2_min, co2_max, methane_min, methane_max, pump_manual_override)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, device_id, name, location, api_key`,
      [
        userId,
        sensorData.device_id,
        sensorData.name,
        sensorData.location ?? null,
        sensorData.api_key,
        sensorData.temp_min      ?? null, sensorData.temp_max      ?? null,
        sensorData.air_hum_min   ?? null, sensorData.air_hum_max   ?? null,
        sensorData.co2_min       ?? null, sensorData.co2_max       ?? null,
        sensorData.methane_min   ?? null, sensorData.methane_max   ?? null,
        sensorData.pump_manual_override ?? null,
      ]
    );
    const newSensorId = sensorResult.rows[0].id;

    // Re-insertar programaciones de riego
    for (const s of schedules) {
      await client.query(
        `INSERT INTO pump_schedules (sensor_id, label, start_time, duration_minutes, enabled)
         VALUES ($1,$2,$3,$4,$5)`,
        [newSensorId, s.label ?? null, s.start_time, s.duration_minutes, s.enabled]
      );
    }

    // Re-insertar lecturas
    for (const r of readings) {
      await client.query(
        `INSERT INTO sensor_readings (sensor_id, temperature, air_humidity, co2, methane, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newSensorId, r.temperature ?? null, r.air_humidity ?? null,
         r.co2 ?? null, r.methane ?? null, r.created_at]
      );
    }

    // Eliminar el respaldo
    await client.query("DELETE FROM deleted_sensors_backup WHERE id=$1", [backupId]);

    await client.query("COMMIT");

    return res.json({ sensor: sensorResult.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error restaurando sensor" });
  } finally {
    client.release();
  }
});

// ── Eliminar respaldo permanentemente ─────────────────────────────────────────
router.delete("/deleted/:backupId", requireAuth, async (req, res) => {
  try {
    const userId   = req.user.id;
    const backupId = Number(req.params.backupId);

    const result = await pool.query(
      "DELETE FROM deleted_sensors_backup WHERE id=$1 AND user_id=$2 RETURNING id",
      [backupId, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Respaldo no encontrado" });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Error eliminando respaldo" });
  }
});

// ── Eliminar sensor (con respaldo automático) ─────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId   = req.user.id;
    const sensorId = Number(req.params.id);

    await client.query("BEGIN");

    // Obtener sensor
    const sensorResult = await client.query(
      `SELECT * FROM sensors WHERE id=$1 AND user_id=$2`,
      [sensorId, userId]
    );
    if (sensorResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Sensor no encontrado" });
    }
    const sensor = sensorResult.rows[0];

    // Obtener programaciones de riego
    const schedulesResult = await client.query(
      `SELECT label, start_time, duration_minutes, enabled FROM pump_schedules WHERE sensor_id=$1`,
      [sensorId]
    );

    // Obtener últimas 200 lecturas
    const readingsResult = await client.query(
      `SELECT temperature, air_humidity, co2, methane, created_at
       FROM sensor_readings
       WHERE sensor_id=$1
       ORDER BY created_at DESC
       LIMIT 200`,
      [sensorId]
    );

    const readingsCount = await client.query(
      "SELECT COUNT(*) FROM sensor_readings WHERE sensor_id=$1",
      [sensorId]
    );

    // Guardar respaldo
    await client.query(
      `INSERT INTO deleted_sensors_backup
         (original_id, user_id, sensor_data, schedules_data, readings_count, readings_data)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        sensorId,
        userId,
        JSON.stringify(sensor),
        JSON.stringify(schedulesResult.rows),
        parseInt(readingsCount.rows[0].count),
        JSON.stringify(readingsResult.rows),
      ]
    );

    // Eliminar sensor (cascade borra readings, schedules, alerts)
    await client.query("DELETE FROM sensors WHERE id=$1", [sensorId]);

    await client.query("COMMIT");

    return res.status(200).json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ message: "Error eliminando sensor" });
  } finally {
    client.release();
  }
});

// ── Actualizar umbrales de alerta ─────────────────────────────────────────────
router.put("/:id/thresholds", requireAuth, async (req, res) => {
  try {
    const userId   = req.user.id;
    const sensorId = Number(req.params.id);

    const thresholdSchema = z.object({
      temp_min:    z.number().nullable().optional(),
      temp_max:    z.number().nullable().optional(),
      air_hum_min: z.number().nullable().optional(),
      air_hum_max: z.number().nullable().optional(),
      co2_min:     z.number().nullable().optional(),
      co2_max:     z.number().nullable().optional(),
      methane_min: z.number().nullable().optional(),
      methane_max: z.number().nullable().optional(),
    });
    const data = thresholdSchema.parse(req.body);

    const result = await pool.query(
      `UPDATE sensors
       SET temp_min=$3, temp_max=$4, air_hum_min=$5, air_hum_max=$6,
           co2_min=$7, co2_max=$8, methane_min=$9, methane_max=$10
       WHERE id=$1 AND user_id=$2
       RETURNING id, temp_min, temp_max, air_hum_min, air_hum_max, co2_min, co2_max, methane_min, methane_max`,
      [sensorId, userId,
       data.temp_min ?? null, data.temp_max ?? null,
       data.air_hum_min ?? null, data.air_hum_max ?? null,
       data.co2_min ?? null, data.co2_max ?? null,
       data.methane_min ?? null, data.methane_max ?? null]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: `Sensor ${sensorId} no encontrado` });
    }

    return res.json({ thresholds: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error actualizando umbrales" });
  }
});

// ── Lecturas de un sensor por rango de fecha ──────────────────────────────────
router.get("/:id/readings", requireAuth, async (req, res) => {
  try {
    const userId   = req.user.id;
    const sensorId = Number(req.params.id);

    const intervalMap = {
      today:   "24 hours",
      week:    "7 days",
      month:   "30 days",
      quarter: "90 days",
    };
    const range    = Object.hasOwn(intervalMap, req.query.range ?? "") ? req.query.range : "today";
    const interval = intervalMap[range];

    const access = await checkSensorAccess(sensorId, userId, "can_view_graphs");
    if (!access.authorized) {
      return res.status(access.shareRow ? 403 : 404).json({
        message: access.shareRow ? "Sin permiso para ver gráficas" : "Sensor no encontrado"
      });
    }

    const readings = await pool.query(
      `SELECT id, sensor_id, temperature, air_humidity, co2, methane, created_at
       FROM sensor_readings
       WHERE sensor_id = $1
         AND created_at >= NOW() - INTERVAL '${interval}'
       ORDER BY created_at ASC`,
      [sensorId]
    );

    return res.json({ readings: readings.rows, range, count: readings.rowCount });
  } catch (e) {
    return res.status(500).json({ message: "Error consultando lecturas" });
  }
});

export default router;
