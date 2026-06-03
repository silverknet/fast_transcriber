-- 005_cloud_projects.sql
--
-- Cloud project + membership tables. A `cloud_projects` row is the
-- shared identity of a BarBro project; the matching local project on
-- each user's disk references it via `ProjectFile.cloud.projectId`.
--
-- `revision` is a monotonic counter bumped server-side on every accepted
-- write (song push or manifest change). Clients hold the last value they
-- successfully pulled and use `?since=<rev>` for delta sync (see
-- Phase 4).
--
-- The owner→member trigger writes the owner into `cloud_project_members`
-- atomically with the project insert. The function is SECURITY DEFINER
-- so it bypasses RLS for the duration of the trigger — required because
-- at that instant the owner is not yet a member, so the user-facing
-- INSERT policy on cloud_project_members (which requires owner role) would
-- block it.

CREATE TABLE cloud_projects (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  revision      bigint      NOT NULL DEFAULT 0
);

CREATE INDEX cloud_projects_owner_idx ON cloud_projects (owner_user_id);

CREATE TABLE cloud_project_members (
  cloud_project_id uuid        NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             text        NOT NULL CHECK (role IN ('owner','editor')),
  added_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cloud_project_id, user_id)
);

CREATE INDEX cloud_project_members_user_idx ON cloud_project_members (user_id);

CREATE OR REPLACE FUNCTION public.cloud_projects_add_owner_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.cloud_project_members (cloud_project_id, user_id, role)
  VALUES (NEW.id, NEW.owner_user_id, 'owner');
  RETURN NEW;
END;
$$;

CREATE TRIGGER cloud_projects_owner_member_trg
AFTER INSERT ON cloud_projects
FOR EACH ROW
EXECUTE FUNCTION public.cloud_projects_add_owner_as_member();
