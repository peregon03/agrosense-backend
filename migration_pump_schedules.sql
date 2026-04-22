-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: Múltiples programaciones de riego
-- pump_start_time es tipo TIME en la BD, se convierte a VARCHAR "HH:MM"
-- Todo en una transacción: si algo falla, se revierte todo.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Crear la nueva tabla
CREATE TABLE pump_schedules (
  id               SERIAL PRIMARY KEY,
  sensor_id        INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  label            VARCHAR(60),
  start_time       VARCHAR(5) NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pump_schedules_sensor_id ON pump_schedules(sensor_id);

-- 2. Migrar datos existentes (pump_start_time es tipo TIME, usamos TO_CHAR)
INSERT INTO pump_schedules (sensor_id, start_time, duration_minutes, enabled)
SELECT
  id,
  TO_CHAR(pump_start_time, 'HH24:MI'),
  pump_duration_minutes,
  COALESCE(pump_schedule_enabled, FALSE)
FROM sensors
WHERE pump_start_time IS NOT NULL
  AND pump_duration_minutes IS NOT NULL;

-- 3. Eliminar columnas antiguas de sensors
ALTER TABLE sensors
  DROP COLUMN pump_schedule_enabled,
  DROP COLUMN pump_start_time,
  DROP COLUMN pump_duration_minutes;

COMMIT;
