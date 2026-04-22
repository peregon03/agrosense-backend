import { pool } from "../db.js";

/**
 * Verifica si userId tiene acceso a sensorId.
 *
 * - Si es propietario → acceso total (isOwner: true).
 * - Si tiene un share activo con el permiso requerido → acceso concedido.
 *
 * @param {number}            sensorId
 * @param {number}            userId
 * @param {string|string[]|null} requiredPermission
 *   Permiso requerido: 'can_view_graphs' | 'can_schedule' | 'can_control_pump'
 *   Puede ser un array → basta con cumplir uno.
 *   null → cualquier share concede acceso.
 *
 * @returns {{ authorized: boolean, isOwner: boolean, shareRow: object|null }}
 */
export async function checkSensorAccess(sensorId, userId, requiredPermission = null) {
  // Verificar propiedad
  const ownerCheck = await pool.query(
    "SELECT id FROM sensors WHERE id=$1 AND user_id=$2",
    [sensorId, userId]
  );
  if (ownerCheck.rowCount > 0) {
    return { authorized: true, isOwner: true, shareRow: null };
  }

  // Verificar acceso compartido
  const shareCheck = await pool.query(
    "SELECT * FROM sensor_shares WHERE sensor_id=$1 AND shared_with_id=$2",
    [sensorId, userId]
  );
  if (shareCheck.rowCount === 0) {
    return { authorized: false, isOwner: false, shareRow: null };
  }

  const shareRow = shareCheck.rows[0];

  if (!requiredPermission) {
    return { authorized: true, isOwner: false, shareRow };
  }

  // Soporta array de permisos: basta con tener uno
  const permissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
  const hasPermission = permissions.some(p => shareRow[p]);

  return { authorized: hasPermission, isOwner: false, shareRow };
}
