-- Realtime publication for the cloud collaboration tables.
--
-- WHY THIS EXISTS
--
-- `cloudRealtime.ts` subscribes to `postgres_changes` on `cloud_songs`,
-- `cloud_projects` and `cloud_project_members`, and the app relies on those
-- events to auto-pull a collaborator's edits. None of those tables were ever
-- added to the `supabase_realtime` publication, so Postgres never emitted a
-- single change for them.
--
-- The failure was silent and total. A channel subscribed to a table OUTSIDE the
-- publication still reports `SUBSCRIBED` — it simply receives nothing, forever.
-- Verified against the live project with `scripts/check-realtime.mjs`: three
-- channels (filtered, unfiltered, and whole-schema) all reached SUBSCRIBED,
-- while INSERT + UPDATE + DELETE on two tables produced zero events.
--
-- Practical effect before this migration: cloud sync was PUSH-ONLY. Local edits
-- uploaded fine, but no member ever received anyone else's changes after the
-- initial join, because `pullCloudChanges()` is only ever called from the
-- realtime callback.
--
-- REPLICA IDENTITY is set deliberately per table rather than FULL everywhere.
--
-- FULL writes the ENTIRE old row into WAL on every update. `cloud_songs.song_map`
-- runs to hundreds of kilobytes per song, so FULL would roughly double the WAL
-- written per edit, forever — and buy nothing here: the subscription callback
-- ignores the payload and simply triggers a pull, INSERT/UPDATE authorization
-- reads the NEW record (which carries `cloud_project_id` for the filter), and
-- song deletions already surface through the project row.
--
-- The two small tables DO get FULL: their rows are tiny, and DELETE events
-- matter there (a member removed, a project deleted). A DELETE record contains
-- only the replica identity, so without FULL an RLS-gated subscriber cannot be
-- shown the row at all.
--
-- NOTE ON TIMING: Realtime re-reads the publication when its replication
-- connection cycles, so the first verification run within ~30s of applying this
-- can still see no events. Re-run `npm run check:realtime` before concluding it
-- failed — observed here as one FAIL followed by three consecutive PASSes.
--
-- Idempotent: safe to re-run. `pg_publication_tables` is checked first because
-- `ALTER PUBLICATION ... ADD TABLE` errors if the table is already a member.

DO $$
DECLARE
  t text;
BEGIN
  -- The publication is created by Supabase on project setup. If it is missing
  -- (self-hosted, or a fresh local stack) create it empty and then populate.
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOREACH t IN ARRAY ARRAY['cloud_projects', 'cloud_songs', 'cloud_project_members']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;

    -- See the note above on why `cloud_songs` stays on the default identity.
    IF t <> 'cloud_songs' THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    END IF;
  END LOOP;
END
$$;
