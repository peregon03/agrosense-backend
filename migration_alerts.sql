-- Agregar columnas de umbrales de alerta a la tabla sensors
ALTER TABLE sensors
  ADD COLUMN IF NOT EXISTS temp_min     NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS temp_max     NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS air_hum_min  NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS air_hum_max  NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS soil_hum_min NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS soil_hum_max NUMERIC(5,1);

-- Tabla de alertas disparadas por el servidor al recibir lecturas
CREATE TABLE IF NOT EXISTS sensor_alerts (
  id         SERIAL PRIMARY KEY,
  sensor_id  INT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric     VARCHAR(20) NOT NULL CHECK (metric IN ('temperature','air_humidity','soil_humidity')),
  value      NUMERIC(5,1) NOT NULL,
  threshold  NUMERIC(5,1) NOT NULL,
  direction  VARCHAR(5) NOT NULL CHECK (direction IN ('above','below')),
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_read   ON sensor_alerts(user_id, read);
CREATE INDEX IF NOT EXISTS idx_alerts_sensor_time ON sensor_alerts(sensor_id, created_at DESC);
