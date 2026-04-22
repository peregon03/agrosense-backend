import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

const permissionsSchema = z.object({
  can_view_graphs:  z.boolean().default(true),
  can_schedule:     z.boolean().default(false),
  can_control_pump: z.boolean().default(false),
});

// ── GET /api/sensors/shared-with-me ──────────────────────────────────────────
// Sensores que otros usuarios compartieron con el usuario actual
router.get("/shared-with-me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT
         ss.id          AS share_id,
         ss.can_view_graphs, ss.can_schedule, ss.can_control_pump,
         s.id           AS sensor_id,
         s.device_id, s.name, s.location, s.is_active,
         s.pump_manual_override,
         s.temp_min, s.temp_max, s.air_hum_min, s.air_hum_max,
         s.co2_min, s.co2_max, s.methane_min, s.methane_max,
         u.first_name   AS owner_first_name,
         u.last_name    AS owner_last_name,
         u.email        AS owner_email
       FROM sensor_shares ss
       JOIN sensors s ON s.id  = ss.sensor_id
       JOIN users   u ON u.id  = ss.owner_id
       WHERE ss.shared_with_id = $1
       ORDER BY ss.created_at DESC`,
      [userId]
    );
    return res.json({ shared_sensors: result.rows });
  } catch (e) {
    return res.status(500).json({ message: "Error listando sensores compartidos" });
  }
});

// ── GET /api/sensors/:id/shares ───────────────────────────────────────────────
// Lista de usuarios con acceso al sensor (solo propietario)
router.get("/:id/shares", requireAuth, async (req, res) => {
  try {
    const userId   = req.user.id;
    const sensorId = Number(req.params.id);

    const ownerCheck = await pool.query(
      "SELECT id FROM sensors WHERE id=$1 AND user_id=$2",
      [sensorId, userId]
    );
    if (ownerCheck.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }

    const result = await pool.query(
      `SELECT ss.id, ss.sensor_id, ss.shared_with_id,
              ss.can_view_graphs, ss.can_schedule, ss.can_control_pump, ss.created_at,
              u.first_name, u.last_name, u.email
       FROM sensor_shares ss
       JOIN users u ON u.id = ss.shared_with_id
       WHERE ss.sensor_id = $1
       ORDER BY ss.created_at DESC`,
      [sensorId]
    );
    return res.json({ shares: result.rows });
  } catch (e) {
    return res.status(500).json({ message: "Error listando accesos" });
  }
});

// ── POST /api/sensors/:id/share ───────────────────────────────────────────────
// Compartir sensor con otro usuario por email
router.post("/:id/share", requireAuth, async (req, res) => {
  try {
    const ownerId  = req.user.id;
    const sensorId = Number(req.params.id);

    const schema = permissionsSchema.extend({
      email: z.string().email("Email inválido"),
    });
    const data = schema.parse(req.body);

    // Verificar propiedad
    const ownerCheck = await pool.query(
      "SELECT id FROM sensors WHERE id=$1 AND user_id=$2",
      [sensorId, ownerId]
    );
    if (ownerCheck.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }

    // Buscar usuario destino por email
    const userResult = await pool.query(
      "SELECT id, first_name, last_name, email FROM users WHERE LOWER(email)=LOWER($1)",
      [data.email]
    );
    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: "No existe un usuario con ese email" });
    }

    const targetUser = userResult.rows[0];
    if (targetUser.id === ownerId) {
      return res.status(400).json({ message: "No puedes compartir el sensor contigo mismo" });
    }

    // Insertar o actualizar si ya existe
    const result = await pool.query(
      `INSERT INTO sensor_shares
         (sensor_id, owner_id, shared_with_id, can_view_graphs, can_schedule, can_control_pump)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (sensor_id, shared_with_id) DO UPDATE
         SET can_view_graphs=$4, can_schedule=$5, can_control_pump=$6
       RETURNING id, sensor_id, shared_with_id, can_view_graphs, can_schedule, can_control_pump, created_at`,
      [sensorId, ownerId, targetUser.id, data.can_view_graphs, data.can_schedule, data.can_control_pump]
    );

    return res.status(201).json({
      share: {
        ...result.rows[0],
        email:      targetUser.email,
        first_name: targetUser.first_name,
        last_name:  targetUser.last_name,
      }
    });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error compartiendo sensor" });
  }
});

// ── PUT /api/sensors/:id/shares/:shareId ─────────────────────────────────────
// Actualizar permisos de un acceso compartido
router.put("/:id/shares/:shareId", requireAuth, async (req, res) => {
  try {
    const ownerId  = req.user.id;
    const sensorId = Number(req.params.id);
    const shareId  = Number(req.params.shareId);

    const ownerCheck = await pool.query(
      "SELECT id FROM sensors WHERE id=$1 AND user_id=$2",
      [sensorId, ownerId]
    );
    if (ownerCheck.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }

    const data = permissionsSchema.parse(req.body);

    const result = await pool.query(
      `UPDATE sensor_shares
       SET can_view_graphs=$3, can_schedule=$4, can_control_pump=$5
       WHERE id=$1 AND sensor_id=$2
       RETURNING id, sensor_id, shared_with_id, can_view_graphs, can_schedule, can_control_pump`,
      [shareId, sensorId, data.can_view_graphs, data.can_schedule, data.can_control_pump]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Acceso no encontrado" });
    }
    return res.json({ share: result.rows[0] });
  } catch (e) {
    return res.status(400).json({ message: e.message ?? "Error actualizando permisos" });
  }
});

// ── DELETE /api/sensors/:id/shares/:shareId ───────────────────────────────────
// Revocar acceso compartido
router.delete("/:id/shares/:shareId", requireAuth, async (req, res) => {
  try {
    const ownerId  = req.user.id;
    const sensorId = Number(req.params.id);
    const shareId  = Number(req.params.shareId);

    const ownerCheck = await pool.query(
      "SELECT id FROM sensors WHERE id=$1 AND user_id=$2",
      [sensorId, ownerId]
    );
    if (ownerCheck.rowCount === 0) {
      return res.status(404).json({ message: "Sensor no encontrado" });
    }

    const result = await pool.query(
      "DELETE FROM sensor_shares WHERE id=$1 AND sensor_id=$2 RETURNING id",
      [shareId, sensorId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Acceso no encontrado" });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ message: "Error revocando acceso" });
  }
});

export default router;
