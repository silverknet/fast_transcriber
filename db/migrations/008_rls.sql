-- 008_rls.sql
--
-- Row-Level Security policies for the cloud collab tables.
--
-- The naive policy "user can see members where they appear" recurses on
-- itself when checked — Postgres has anti-recursion guards but it's a
-- foot-gun. We extract two SECURITY DEFINER helpers (`is_project_member`,
-- `is_project_owner`) that bypass RLS for the duration of the lookup.
-- This is the standard Supabase pattern for membership-style policies.
--
-- `STABLE` lets Postgres cache the result within a single query. `SET
-- search_path = public, pg_temp` is the recommended hardening — a
-- SECURITY DEFINER function with an attacker-controllable search_path
-- can be tricked into resolving a name to a table the caller controls.
--
-- All four tables get RLS enabled here even if the project-level
-- "Enable automatic RLS" toggle is on — explicit is better, and makes
-- this migration idempotent against fresh installs that don't have the
-- toggle set yet.

-- ── Helper functions ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cloud_project_members
    WHERE cloud_project_id = p_project_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cloud_project_members
    WHERE cloud_project_id = p_project_id
      AND user_id = p_user_id
      AND role = 'owner'
  );
$$;

-- ── Enable RLS ────────────────────────────────────────────────────────

ALTER TABLE cloud_projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_project_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_songs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_project_revisions  ENABLE ROW LEVEL SECURITY;

-- ── cloud_projects ────────────────────────────────────────────────────

CREATE POLICY cloud_projects_member_select ON cloud_projects
  FOR SELECT USING (public.is_project_member(id, auth.uid()));

-- INSERT: any signed-in user can create a project, as long as they're
-- the owner of the row they're creating. The trigger then adds them as
-- a member.
CREATE POLICY cloud_projects_self_owner_insert ON cloud_projects
  FOR INSERT WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY cloud_projects_owner_update ON cloud_projects
  FOR UPDATE
  USING (public.is_project_owner(id, auth.uid()))
  WITH CHECK (public.is_project_owner(id, auth.uid()));

CREATE POLICY cloud_projects_owner_delete ON cloud_projects
  FOR DELETE USING (public.is_project_owner(id, auth.uid()));

-- ── cloud_project_members ─────────────────────────────────────────────

CREATE POLICY cloud_members_member_select ON cloud_project_members
  FOR SELECT USING (public.is_project_member(cloud_project_id, auth.uid()));

CREATE POLICY cloud_members_owner_insert ON cloud_project_members
  FOR INSERT WITH CHECK (public.is_project_owner(cloud_project_id, auth.uid()));

CREATE POLICY cloud_members_owner_update ON cloud_project_members
  FOR UPDATE
  USING (public.is_project_owner(cloud_project_id, auth.uid()))
  WITH CHECK (public.is_project_owner(cloud_project_id, auth.uid()));

CREATE POLICY cloud_members_owner_delete ON cloud_project_members
  FOR DELETE USING (public.is_project_owner(cloud_project_id, auth.uid()));

-- ── cloud_songs ───────────────────────────────────────────────────────

CREATE POLICY cloud_songs_member_select ON cloud_songs
  FOR SELECT USING (public.is_project_member(cloud_project_id, auth.uid()));

-- Both owner and editor can write songs. We don't differentiate by role
-- on insert/update — the role distinction is enforced at the
-- project/member level only (owners gate membership; editors edit
-- content). Tighten later if we add a 'viewer' role.
CREATE POLICY cloud_songs_member_insert ON cloud_songs
  FOR INSERT WITH CHECK (public.is_project_member(cloud_project_id, auth.uid()));

CREATE POLICY cloud_songs_member_update ON cloud_songs
  FOR UPDATE
  USING (public.is_project_member(cloud_project_id, auth.uid()))
  WITH CHECK (public.is_project_member(cloud_project_id, auth.uid()));

-- DELETE is owner-only — removing a song is destructive enough that we
-- don't let editors do it without an owner's blessing.
CREATE POLICY cloud_songs_owner_delete ON cloud_songs
  FOR DELETE USING (public.is_project_owner(cloud_project_id, auth.uid()));

-- ── cloud_project_revisions (append-only) ─────────────────────────────

CREATE POLICY cloud_revisions_member_select ON cloud_project_revisions
  FOR SELECT USING (public.is_project_member(cloud_project_id, auth.uid()));

-- Inserts come from server endpoints running as the user via the SSR
-- client. `actor = auth.uid()` prevents forging the actor field.
CREATE POLICY cloud_revisions_member_insert ON cloud_project_revisions
  FOR INSERT WITH CHECK (
    public.is_project_member(cloud_project_id, auth.uid())
    AND actor = auth.uid()
  );

-- No UPDATE/DELETE policies → RLS default-deny makes the table
-- append-only by construction.
