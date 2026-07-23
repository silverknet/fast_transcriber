-- 016_cloud_audio.sql
--
-- Cloud AUDIO storage for browser-only ("consumer/collaborator") mode. Until
-- now the cloud carried only the .smap + audio IDENTITY (`expected_audio`); the
-- actual bytes never left the creator's disk, so a browser-only member had no
-- audio to play. This adds a private Storage bucket for the COMPRESSED playback
-- copy (AAC/m4a ~128k, mix + stems) plus a per-song manifest of what's uploaded.
--
-- IMPORTANT: this is a lossy PLAYBACK PROXY, not the master. On desktop the
-- local HD WAV always wins (`src/lib/audio/resolveAudioSource.ts`); this bucket
-- is only ever read in browser mode.
--
-- Path scheme (the FIRST folder is the project id, so the same
-- `is_project_member` helper that gates `cloud_songs` also gates the objects):
--   {cloud_project_id}/{cloud_song_id}/mix.m4a
--   {cloud_project_id}/{cloud_song_id}/stems/{stem}.m4a

-- ── Per-song manifest of uploaded cloud audio ─────────────────────────────
-- Shape (jsonb):
--   { "codec": "aac", "bitrateKbps": 128,
--     "sourceSha256": "<sha of the WAV master — identity / mismatch check>",
--     "mix":   { "path": "...", "bytes": 1234, "durationSec": 240.1 },
--     "stems": { "Bass": { "path": "...", "bytes": ... }, ... },
--     "updatedAt": "<iso>" }
ALTER TABLE cloud_songs ADD COLUMN IF NOT EXISTS cloud_audio jsonb;

-- ── Private bucket ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-audio', 'project-audio', false)
ON CONFLICT (id) DO NOTHING;

-- ── Path → project id (fail-closed: non-uuid first segment → NULL) ─────────
-- `is_project_member(NULL, …)` is false, so a malformed object name denies
-- access instead of erroring inside a policy.
CREATE OR REPLACE FUNCTION public.project_audio_project_id(object_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = storage, public, pg_temp
AS $$
  SELECT CASE
    WHEN (storage.foldername(object_name))[1] ~ '^[0-9a-fA-F-]{36}$'
      THEN ((storage.foldername(object_name))[1])::uuid
    ELSE NULL
  END;
$$;

-- ── RLS on the bucket's objects: project members only ─────────────────────
-- Mirrors cloud_songs (members read + write their project's content). Reuses
-- public.is_project_member from 008_rls.sql. DROP-then-CREATE so the whole
-- migration is idempotent (safe to re-run via the runner OR the SQL editor).
DROP POLICY IF EXISTS "project-audio member read" ON storage.objects;
DROP POLICY IF EXISTS "project-audio member insert" ON storage.objects;
DROP POLICY IF EXISTS "project-audio member update" ON storage.objects;
DROP POLICY IF EXISTS "project-audio member delete" ON storage.objects;

CREATE POLICY "project-audio member read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-audio'
    AND public.is_project_member(public.project_audio_project_id(name), auth.uid())
  );

CREATE POLICY "project-audio member insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-audio'
    AND public.is_project_member(public.project_audio_project_id(name), auth.uid())
  );

CREATE POLICY "project-audio member update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'project-audio'
    AND public.is_project_member(public.project_audio_project_id(name), auth.uid())
  )
  WITH CHECK (
    bucket_id = 'project-audio'
    AND public.is_project_member(public.project_audio_project_id(name), auth.uid())
  );

CREATE POLICY "project-audio member delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-audio'
    AND public.is_project_member(public.project_audio_project_id(name), auth.uid())
  );
