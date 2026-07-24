-- 017_cloud_push_member_write.sql
--
-- DATA-LOSS FIX. `cloud_push_song` and `cloud_patch_manifest` (010_cloud_rpcs)
-- ran SECURITY INVOKER and bumped `cloud_projects.revision` with a plain
-- UPDATE. But the update policy on cloud_projects (`cloud_projects_owner_update`,
-- 008_rls.sql) is OWNER-ONLY. So for any NON-OWNER editor/collaborator:
--
--   UPDATE cloud_projects SET revision = revision + 1 ... RETURNING ... INTO new_rev;
--
-- matched ZERO rows under RLS (silently — non-STRICT INTO), leaving new_rev
-- NULL. The following INSERT then wrote cloud_songs.revision = NULL, violating
-- its NOT NULL constraint (23502) and aborting the whole transaction as a 500 —
-- which the client's push swallows with a silent .catch(). Net effect: a
-- collaborator's edits (chords AND draft rename both funnel through
-- cloud_push_song) NEVER persisted, with no error surfaced. Owners passed the
-- RLS check, which is why own-project testing looked fine.
--
-- Fix: run both RPCs SECURITY DEFINER so the revision bump bypasses the
-- owner-only RLS, but gate them with an EXPLICIT is_project_member() check
-- (owner OR editor). Because DEFINER also bypasses cloud_songs RLS, add a guard
-- so a supplied song id can't be hijacked into a project the caller isn't
-- writing (the per-song UPDATEs in the manifest RPC already scope by project).

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
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_song_rev     bigint;
  current_song_project uuid;
  new_rev              bigint;
  effective_order      integer;
BEGIN
  -- SECURITY DEFINER bypasses RLS, so enforce membership explicitly here.
  IF auth.uid() IS NULL OR NOT public.is_project_member(p_project_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a project member' USING ERRCODE = '42501';
  END IF;

  -- Lock the project row so concurrent pushes serialize cleanly.
  PERFORM 1 FROM public.cloud_projects WHERE id = p_project_id FOR UPDATE;

  SELECT revision, cloud_project_id
    INTO current_song_rev, current_song_project
    FROM public.cloud_songs WHERE id = p_song_id;

  -- Never overwrite a song that lives in a different project.
  IF current_song_project IS NOT NULL AND current_song_project <> p_project_id THEN
    RAISE EXCEPTION 'song belongs to another project' USING ERRCODE = '42501';
  END IF;

  IF current_song_rev IS NOT NULL AND current_song_rev > p_client_base_revision THEN
    RAISE EXCEPTION 'conflict'
      USING ERRCODE = 'P0001',
            DETAIL  = format('remote song revision %s > client base %s', current_song_rev, p_client_base_revision);
  END IF;

  UPDATE public.cloud_projects
  SET revision = revision + 1, updated_at = now()
  WHERE id = p_project_id
  RETURNING revision INTO new_rev;

  IF new_rev IS NULL THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

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
    song_map       = EXCLUDED.song_map,
    expected_audio = EXCLUDED.expected_audio,
    hidden         = EXCLUDED.hidden,
    sort_order     = EXCLUDED.sort_order,
    revision       = EXCLUDED.revision,
    updated_at     = EXCLUDED.updated_at,
    updated_by     = EXCLUDED.updated_by;

  INSERT INTO public.cloud_project_revisions (
    cloud_project_id, revision, kind, entity_id, actor
  ) VALUES (
    p_project_id, new_rev, 'song', p_song_id, auth.uid()
  );

  RETURN new_rev;
END;
$$;

CREATE OR REPLACE FUNCTION public.cloud_patch_manifest(
  p_project_id            uuid,
  p_name                  text,
  p_ordered_song_ids      uuid[],
  p_hidden_map            jsonb,
  p_client_base_revision  bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_proj_rev bigint;
  new_rev          bigint;
  i                integer;
  hidden_key       text;
  hidden_val       boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_project_member(p_project_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a project member' USING ERRCODE = '42501';
  END IF;

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
