-- 010_cloud_rpcs.sql
--
-- Atomic write helpers for the cloud sync engine. Everything that bumps
-- `cloud_projects.revision` lives in a Postgres function so the revision,
-- the content write, and the audit-log row are committed in the same
-- transaction. Lets the client trust that "revision N" exists in the log
-- and reflects a concrete content change.
--
-- All helpers are `SECURITY INVOKER` — RLS still applies to writes
-- inside the function, so a non-member can't push to a project they
-- don't belong to even if they discover the project id. The functions
-- are named `cloud_*` and live in `public` so they're reachable via
-- PostgREST's `rpc()` interface (callable from the @supabase/ssr
-- client without any extra grants beyond execute).
--
-- Error contract: conflict errors raise SQLSTATE `P0001` with message
-- 'conflict'; the route handler catches this and turns it into HTTP 409.

-- ── cloud_create_project ──────────────────────────────────────────────
-- Insert a project row with the caller as owner, plus an arbitrary
-- number of songs. The owner→member trigger from migration 005 takes
-- care of the membership row. Returns the new revision (always 0).
--
-- `p_songs` is a JSONB array of `{ id, song_map, expected_audio?, hidden?, sort_order }`.

CREATE OR REPLACE FUNCTION public.cloud_create_project(
  p_project_id uuid,
  p_name       text,
  p_songs      jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  song jsonb;
BEGIN
  INSERT INTO public.cloud_projects (id, owner_user_id, name)
  VALUES (p_project_id, auth.uid(), p_name);

  IF jsonb_typeof(p_songs) = 'array' THEN
    FOR song IN SELECT * FROM jsonb_array_elements(p_songs)
    LOOP
      INSERT INTO public.cloud_songs (
        id, cloud_project_id, song_map, expected_audio, hidden, sort_order,
        revision, updated_at, updated_by
      ) VALUES (
        (song->>'id')::uuid,
        p_project_id,
        song->'song_map',
        song->'expected_audio',
        COALESCE((song->>'hidden')::boolean, false),
        (song->>'sort_order')::integer,
        0,
        now(),
        auth.uid()
      );
    END LOOP;
  END IF;

  INSERT INTO public.cloud_project_revisions (cloud_project_id, revision, kind, actor, payload)
  VALUES (p_project_id, 0, 'manifest', auth.uid(), jsonb_build_object('op','create','name',p_name));

  RETURN 0;
END;
$$;

-- ── cloud_push_song ───────────────────────────────────────────────────
-- Upsert one song's collaborative payload. Conflict-checks
-- `clientBaseRevision` against the row's current `revision`; if remote
-- moved past it, raises `P0001 conflict`. On success bumps the
-- project's revision and writes a `cloud_project_revisions` row.
--
-- `p_sort_order` is optional — pass NULL to keep the existing order
-- (or append to the end for brand-new songs).

CREATE OR REPLACE FUNCTION public.cloud_push_song(
  p_project_id            uuid,
  p_song_id               uuid,
  p_song_map              jsonb,
  p_expected_audio        jsonb,
  p_sort_order            integer,
  p_hidden                boolean,
  p_client_base_revision  bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_song_rev bigint;
  new_rev          bigint;
  effective_order  integer;
BEGIN
  -- Lock the project row so concurrent pushes serialize cleanly. RLS
  -- enforces membership on this SELECT.
  PERFORM 1 FROM public.cloud_projects WHERE id = p_project_id FOR UPDATE;

  SELECT revision INTO current_song_rev
  FROM public.cloud_songs WHERE id = p_song_id;

  IF current_song_rev IS NOT NULL AND current_song_rev > p_client_base_revision THEN
    RAISE EXCEPTION 'conflict'
      USING ERRCODE = 'P0001',
            DETAIL  = format('remote song revision %s > client base %s', current_song_rev, p_client_base_revision);
  END IF;

  UPDATE public.cloud_projects
  SET revision = revision + 1, updated_at = now()
  WHERE id = p_project_id
  RETURNING revision INTO new_rev;

  effective_order := COALESCE(
    p_sort_order,
    (SELECT sort_order FROM public.cloud_songs WHERE id = p_song_id),
    (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM public.cloud_songs WHERE cloud_project_id = p_project_id)
  );

  INSERT INTO public.cloud_songs (
    id, cloud_project_id, song_map, expected_audio, hidden, sort_order,
    revision, updated_at, updated_by
  ) VALUES (
    p_song_id, p_project_id, p_song_map, p_expected_audio,
    COALESCE(p_hidden, false), effective_order,
    new_rev, now(), auth.uid()
  )
  ON CONFLICT (id) DO UPDATE SET
    song_map      = EXCLUDED.song_map,
    expected_audio= EXCLUDED.expected_audio,
    hidden        = EXCLUDED.hidden,
    sort_order    = EXCLUDED.sort_order,
    revision      = EXCLUDED.revision,
    updated_at    = EXCLUDED.updated_at,
    updated_by    = EXCLUDED.updated_by;

  INSERT INTO public.cloud_project_revisions (
    cloud_project_id, revision, kind, entity_id, actor
  ) VALUES (
    p_project_id, new_rev, 'song', p_song_id, auth.uid()
  );

  RETURN new_rev;
END;
$$;

-- ── cloud_patch_manifest ──────────────────────────────────────────────
-- Rename, reorder, hide/remove songs. Operates on the project's
-- `cloud_songs` row order + the project's `name`. Returns the new
-- revision.
--
-- `p_ordered_song_ids` (uuid array) — full ordered list. When non-null,
-- rewrites every song's sort_order to its array index. When null,
-- ordering is left untouched.
--
-- `p_hidden_map` (jsonb {<song_id>: boolean}) — sparse map of hidden
-- flags. When null, hidden flags untouched. Otherwise every listed
-- song's hidden flag is set to the map's value.
--
-- `p_name` — new project name (or NULL = unchanged).

CREATE OR REPLACE FUNCTION public.cloud_patch_manifest(
  p_project_id            uuid,
  p_name                  text,
  p_ordered_song_ids      uuid[],
  p_hidden_map            jsonb,
  p_client_base_revision  bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_proj_rev bigint;
  new_rev          bigint;
  i                integer;
  song_id          uuid;
  hidden_key       text;
  hidden_val       boolean;
BEGIN
  SELECT revision INTO current_proj_rev
  FROM public.cloud_projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF current_proj_rev IS NULL THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF current_proj_rev > p_client_base_revision THEN
    RAISE EXCEPTION 'conflict'
      USING ERRCODE = 'P0001',
            DETAIL  = format('remote project revision %s > client base %s', current_proj_rev, p_client_base_revision);
  END IF;

  IF p_name IS NOT NULL THEN
    UPDATE public.cloud_projects SET name = p_name WHERE id = p_project_id;
  END IF;

  IF p_ordered_song_ids IS NOT NULL THEN
    FOR i IN 1..array_length(p_ordered_song_ids, 1)
    LOOP
      UPDATE public.cloud_songs
      SET sort_order = i - 1
      WHERE id = p_ordered_song_ids[i] AND cloud_project_id = p_project_id;
    END LOOP;
  END IF;

  IF p_hidden_map IS NOT NULL THEN
    FOR hidden_key, hidden_val IN
      SELECT k.key, (k.value)::boolean
      FROM jsonb_each(p_hidden_map) k
    LOOP
      UPDATE public.cloud_songs
      SET hidden = hidden_val
      WHERE id = hidden_key::uuid AND cloud_project_id = p_project_id;
    END LOOP;
  END IF;

  UPDATE public.cloud_projects
  SET revision = revision + 1, updated_at = now()
  WHERE id = p_project_id
  RETURNING revision INTO new_rev;

  INSERT INTO public.cloud_project_revisions (
    cloud_project_id, revision, kind, actor, payload
  ) VALUES (
    p_project_id, new_rev, 'manifest', auth.uid(),
    jsonb_build_object(
      'name', p_name,
      'order', to_jsonb(p_ordered_song_ids),
      'hidden', p_hidden_map
    )
  );

  RETURN new_rev;
END;
$$;
