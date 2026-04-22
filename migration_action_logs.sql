-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: Historial de acciones sobre sensores
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE sensor_action_logs (
  id          SERIAL PRIMARY KEY,
  sensor_id   INTEGER REFERENCES sensors(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id)   ON DELETE SET NULL,
  action_type VARCHAR(40) NOT NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_action_logs_sensor   ON sensor_action_logs(sensor_id, created_at DESC);
CREATE INDEX idx_action_logs_user     ON sensor_action_logs(user_id);
