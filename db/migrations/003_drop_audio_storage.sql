-- The server never stores audio. All audio lives on the user's local
-- filesystem via the BarBro Desktop sidecar; the database tracks only
-- musical-document state (SongMap JSON) and ownership.
--
-- This migration removes the legacy bytea + sha256 columns from both
-- editor_sessions and projects. After running, no audio bytes can be
-- persisted server-side even if old code paths slip through — the
-- column simply doesn't exist.

ALTER TABLE editor_sessions
  DROP COLUMN IF EXISTS audio_bytes,
  DROP COLUMN IF EXISTS audio_sha256;

ALTER TABLE projects
  DROP COLUMN IF EXISTS audio_bytes,
  DROP COLUMN IF EXISTS audio_sha256;
