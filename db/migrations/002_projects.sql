-- Named cloud projects: multiple rows per fingerprint, manually saved by the user.
CREATE TABLE IF NOT EXISTS projects (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash TEXT        NOT NULL,
  name             TEXT        NOT NULL DEFAULT 'Untitled Project',
  song_map_json    JSONB,
  audio_sha256     TEXT,
  audio_bytes      BYTEA,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_fingerprint_idx ON projects (fingerprint_hash, updated_at DESC);
