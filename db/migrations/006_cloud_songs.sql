-- 006_cloud_songs.sql
--
-- One row per song in a cloud project. `song_map` carries the
-- COLLABORATIVE subset of the local SongMap (see
-- `src/lib/songmap/collab.ts` for the strip rule). `expected_audio` is
-- the cloud's identity claim (sha256, durationSec, sampleRate, channels,
-- fileSize, fileName, …) used by Phase 5 reconciliation to match local
-- audio without ever syncing paths.
--
-- `sort_order` mirrors the local manifest's song array index; the
-- manifest patch endpoint rewrites all sort_orders in one tx when the
-- user reorders.
--
-- `revision` is per-song; the project's overall `revision` (on
-- cloud_projects) is bumped in the same tx, so clients can pull "all
-- songs with row revision > my_last_seen" via the per-row index.

CREATE TABLE cloud_songs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_project_id uuid        NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
  song_map         jsonb       NOT NULL,
  expected_audio   jsonb,
  hidden           boolean     NOT NULL DEFAULT false,
  sort_order       integer     NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        REFERENCES auth.users(id),
  revision         bigint      NOT NULL DEFAULT 0
);

CREATE INDEX cloud_songs_project_order_idx ON cloud_songs (cloud_project_id, sort_order);
CREATE INDEX cloud_songs_project_revision_idx ON cloud_songs (cloud_project_id, revision);
