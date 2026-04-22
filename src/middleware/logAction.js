import { pool } from "../db.js";

/**
 * Registra una acción en el historial del sensor.
 * Falla silenciosamente para no interrumpir el flujo principal.
 *
 * action_type posibles:
 *   pump_on | pump_off | pump_auto
 *   schedule_created | schedule_updated | schedule_deleted | schedule_enabled | schedule_disabled
 *   sensor_shared | share_updated | share_revoked
 *   thresholds_updated
 */
export async function logAction(sensorId, userId, actionType, details = {}) {
  try {
    await pool.query(
      `INSERT INTO sensor_action_logs (sensor_id, user_id, action_type, details)
       VALUES ($1, $2, $3, $4)`,
      [sensorId, userId, actionType, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[LOG] Error registrando acción:", err.message);
  }
}
