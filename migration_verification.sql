-- Ejecutar en PostgreSQL ANTES de reiniciar el servidor

-- 1. Agregar columna is_verified a usuarios existentes
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;

-- 2. Marcar usuarios EXISTENTES como verificados (para no bloquearlos)
UPDATE users SET is_verified = TRUE WHERE is_verified IS NULL OR is_verified = FALSE;

-- 3. Tabla de tokens para verificación y recuperación de contraseña
CREATE TABLE IF NOT EXISTS auth_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(6)   NOT NULL,
  type       VARCHAR(20)  NOT NULL CHECK (type IN ('verify', 'reset')),
  expires_at TIMESTAMPTZ  NOT NULL,
  used       BOOLEAN      DEFAULT FALSE,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_type ON auth_tokens(user_id, type);
