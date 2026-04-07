-- Anonymous editor sessions: one row per browser fingerprint (no accounts).
CREATE TABLE IF NOT EXISTS editor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash TEXT NOT NULL UNIQUE,
  song_map_json JSONB,
  audio_sha256 TEXT,
  audio_bytes BYTEA,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editor_sessions_updated_at_idx ON editor_sessions (updated_at DESC);
