import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { checkSensorAccess } from "../middleware/sensorAccess.js";
import { logAction } from "../middleware/logAction.js";

const router = Router();

const scheduleSchema = z.object({
  label:            z.string().max(60).nullable().optional(),
  start_time:       z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:MM requerido"),
  duration_minutes: z.number().int().min(1).max(1440),
  enabled:          z.boolean().optional().default(true),
});

// Helper: verifica acceso (propietario o share con permiso requerido)
async function resolveSensorId(req, res, requiredPermission = null) {
  const sensorId = Number(req.params.id);
  const userId   = req.user.id;
  const access   = await checkSensorAccess(sensorId, userId, requiredPermission);

  if (!access.authorized) {
    const status = access.shareRow ? 403 : 404;
    const msg    = access.shareRow
      ? "No tienes permiso para realizar esta acción"
      : "Sensor no encontrado";
    res.status(status).json({ message: msg });
    return null;
  }
  return sensorId;
}

// ── GET /api/sensors/:id/pump-schedules ──────────────────────────────────────
// Ver programaciones: propietario, can_view_graphs o can_schedule
router.get("/:id/pump-schedules", requireAuth, async (req, res) => {
  try {
    const sensorId = await resolveSensorId(req, res, ["can_view_graphs", "can_schedule"]);
    if (!sensorId) return;

    const result = await pool.query(
      `SELECT id, sensor_id, label, start_time, duration_minutes, enabled, created_at
       FROM pump_schedules
       WHERE sensor_id = $1
       ORDER BY start_time ASC`,
      [sensorId]
    );
    return res.json({ schedules: result.rows });
  } catch (e) {
    return res.status(500).json({ message: "Error obteniendo programaciones" });
  }
});

// ── POST /api/sensors/:id/pump-schedules ─────────────────────────────────────
// Crear programación: propietario o can_schedule
router.post("/:id/pump-schedules", requireAuth, async (req, res) => {
  try {
    const sensorId = await resolveSensorId(req, res, "can_schedule");
    if (!sensorId) return;

    const data = scheduleSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO pump_schedules (sensor_id, label, start_time, duration_minutes, enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sensor_id, label, start_time, duration_minutes, enabled, created_at`,
      [sensorId, data.label ?? null, data.start_time, data.duration_minutes, data.enabled ?? true]
    );
    const created = result.rows[0];
    logAction(sensorId, req.user.id, "schedule_created", {
      start_time: created.start_time, duration_minutes: created.duration_minutes, label: created.label
    });
    return res.status(201).json({ schedule: created });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error creando programación" });
  }
});

// ── PUT /api/sensors/:id/pump-schedules/:scheduleId ──────────────────────────
// Editar programación: propietario o can_schedule
router.put("/:id/pump-schedules/:scheduleId", requireAuth, async (req, res) => {
  try {
    const sensorId   = await resolveSensorId(req, res, "can_schedule");
    if (!sensorId) return;
    const scheduleId = Number(req.params.scheduleId);

    const data = scheduleSchema.parse(req.body);

    const result = await pool.query(
      `UPDATE pump_schedules
       SET label=$3, start_time=$4, duration_minutes=$5, enabled=$6
       WHERE id=$1 AND sensor_id=$2
       RETURNING id, sensor_id, label, start_time, duration_minutes, enabled, created_at`,
      [scheduleId, sensorId, data.label ?? null, data.start_time, data.duration_minutes, data.enabled ?? true]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Programación no encontrada" });
    }
    const updated = result.rows[0];
    logAction(sensorId, req.user.id, "schedule_updated", {
      start_time: updated.start_time, duration_minutes: updated.duration_minutes, label: updated.label
    });
    return res.json({ schedule: updated });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error actualizando programación" });
  }
});

// ── PATCH /api/sensors/:id/pump-schedules/:scheduleId/toggle ─────────────────
// Toggle: propietario o can_schedule
router.patch("/:id/pump-schedules/:scheduleId/toggle", requireAuth, async (req, res) => {
  try {
    const sensorId   = await resolveSensorId(req, res, "can_schedule");
    if (!sensorId) return;
    const scheduleId = Number(req.params.scheduleId);

    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);

    const result = await pool.query(
      `UPDATE pump_schedules SET enabled=$3
       WHERE id=$1 AND sensor_id=$2
       RETURNING id, sensor_id, label, start_time, duration_minutes, enabled, created_at`,
      [scheduleId, sensorId, enabled]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Programación no encontrada" });
    }
    logAction(sensorId, req.user.id, enabled ? "schedule_enabled" : "schedule_disabled", {
      schedule_id: scheduleId
    });
    return res.json({ schedule: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error al cambiar estado" });
  }
});

// ── DELETE /api/sensors/:id/pump-schedules/:scheduleId ───────────────────────
// Eliminar programación: propietario o can_schedule
router.delete("/:id/pump-schedules/:scheduleId", requireAuth, async (req, res) => {
  try {
    const sensorId   = await resolveSensorId(req, res, "can_schedule");
    if (!sensorId) return;
    const scheduleId = Number(req.params.scheduleId);

    const result = await pool.query(
      "DELETE FROM pump_schedules WHERE id=$1 AND sensor_id=$2 RETURNING id",
      [scheduleId, sensorId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Programación no encontrada" });
    }
    logAction(sensorId, req.user.id, "schedule_deleted", { schedule_id: scheduleId });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Error eliminando programación" });
  }
});

// ── PUT /api/sensors/:id/pump-override ───────────────────────────────────────
// Control manual: propietario o can_control_pump
router.put("/:id/pump-override", requireAuth, async (req, res) => {
  try {
    const sensorId = await resolveSensorId(req, res, "can_control_pump");
    if (!sensorId) return;

    const { override } = z.object({ override: z.boolean().nullable() }).parse(req.body);

    const result = await pool.query(
      `UPDATE sensors SET pump_manual_override=$2
       WHERE id=$1
       RETURNING pump_manual_override`,
      [sensorId, override]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }
    const actionType = override === true ? "pump_on" : override === false ? "pump_off" : "pump_auto";
    logAction(sensorId, req.user.id, actionType);
    return res.json({ pump_manual_override: result.rows[0].pump_manual_override });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error actualizando control manual" });
  }
});

export default router;
