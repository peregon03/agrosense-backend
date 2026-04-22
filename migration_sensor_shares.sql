-- ─────────────────────────────────────────────────────────────────────────────
-- Migración: Compartir sensores con permisos granulares
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE sensor_shares (
  id               SERIAL PRIMARY KEY,
  sensor_id        INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_with_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_view_graphs  BOOLEAN NOT NULL DEFAULT TRUE,
  can_schedule     BOOLEAN NOT NULL DEFAULT FALSE,
  can_control_pump BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sensor_id, shared_with_id)
);

CREATE INDEX idx_sensor_shares_sensor   ON sensor_shares(sensor_id);
CREATE INDEX idx_sensor_shares_shared   ON sensor_shares(shared_with_id);
