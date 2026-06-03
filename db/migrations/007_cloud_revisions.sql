-- 007_cloud_revisions.sql
--
-- Append-only audit log of accepted writes. Powers `?since=<rev>` delta
-- pulls in Phase 4 and gives the conflict-protection layer (Phase 8) a
-- view of who-changed-what when interleavings need to be reconciled.
--
-- `kind`:
--   'manifest' — cloud_projects-level change (rename, member add/remove,
--                song add/remove, song reorder)
--   'song'     — cloud_songs row write (song_map or expected_audio)
--   'member'   — membership grant / revoke (also logged as 'manifest'? no
--                — separate kind so member-only history is filterable)
--
-- `entity_id` is the affected row's id (song id, member's user id, or
-- null for whole-project changes like rename). `payload` carries the
-- minimal diff or new-value snapshot — schema deliberately loose for now
-- because Phase 8's merge logic is what'll dictate the final shape.

CREATE TABLE cloud_project_revisions (
  cloud_project_id uuid        NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
  revision         bigint      NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('manifest','song','member')),
  entity_id        uuid,
  actor            uuid        NOT NULL REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  payload          jsonb,
  PRIMARY KEY (cloud_project_id, revision)
);

-- `since=<rev>` queries scan revision range within a project — that's
-- the primary key path, no extra index needed. But we sometimes ask
-- "what did this user do in this project?" for activity views.
CREATE INDEX cloud_project_revisions_actor_idx
  ON cloud_project_revisions (cloud_project_id, actor);
