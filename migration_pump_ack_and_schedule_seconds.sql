-- ── Pump ACK tracking + Schedule duration in seconds ─────────────────────────
-- Ejecutar en el servidor:  psql -U <user> -d <db> -f migration_pump_ack_and_schedule_seconds.sql

-- 1. Columnas de seguimiento de ACK y expiración en tabla sensors
ALTER TABLE sensors
  ADD COLUMN IF NOT EXISTS pump_override_pending    BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pump_override_expires_at TIMESTAMPTZ;

-- 2. Renombrar duration_minutes → duration_seconds en pump_schedules
ALTER TABLE pump_schedules
  RENAME COLUMN duration_minutes TO duration_seconds;
