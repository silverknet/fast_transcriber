-- 004_drop_legacy.sql
--
-- Retires the pre-desktop fingerprint-keyed tables. These were "save a
-- single SongMap snapshot to the cloud" tables, structurally wrong for
-- the real ProjectFile (multi-song folder). The new cloud_projects /
-- cloud_songs schema (migrations 005-007) takes their place.
--
-- IF EXISTS guards the case where this is the first apply against a
-- fresh database (e.g. Supabase prod) — migrations 001-003 also run on
-- the same pass and create the very tables we drop here, so the
-- create-then-drop is a small waste but harmless.

DROP TABLE IF EXISTS editor_sessions CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
