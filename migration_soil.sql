-- ============================================================
-- AgroSense — Migración: Nodo Suelo (Nodo 03)
-- Ejecutar en la base de datos PostgreSQL de AWS
-- ============================================================

ALTER TABLE sensor_readings
  ADD COLUMN IF NOT EXISTS soil_temp   NUMERIC,
  ADD COLUMN IF NOT EXISTS soil_hum    NUMERIC,
  ADD COLUMN IF NOT EXISTS ec          INTEGER,
  ADD COLUMN IF NOT EXISTS ph          NUMERIC,
  ADD COLUMN IF NOT EXISTS nitrogen    INTEGER,
  ADD COLUMN IF NOT EXISTS phosphorus  INTEGER,
  ADD COLUMN IF NOT EXISTS potassium   INTEGER;

-- Verificar resultado
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sensor_readings'
ORDER BY ordinal_position;
