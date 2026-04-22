-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: Respaldo de sensores eliminados
-- Los datos se conservan 30 días antes de expirar.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE deleted_sensors_backup (
  id             SERIAL PRIMARY KEY,
  original_id    INTEGER NOT NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sensor_data    JSONB NOT NULL,   -- snapshot completo de la fila sensors
  schedules_data JSONB,            -- programaciones de riego al momento de eliminar
  readings_count INTEGER DEFAULT 0,
  readings_data  JSONB,            -- últimas 200 lecturas
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX idx_deleted_sensors_user    ON deleted_sensors_backup(user_id);
CREATE INDEX idx_deleted_sensors_expires ON deleted_sensors_backup(expires_at);
