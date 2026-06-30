-- 013_cloud_table_privileges.sql
--
-- Supabase RLS policies decide which rows a role may touch, but PostgREST
-- roles still need ordinary table privileges before they can reach the
-- relation at all. Migrations 005-008 created the cloud collaboration
-- tables/RLS; this grants the table-level privileges required by the
-- SECURITY INVOKER RPCs and by the server routes that read through the
-- per-request authenticated client.

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cloud_projects
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cloud_project_members
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cloud_songs
  TO authenticated;

-- Revisions are append-only for authenticated users: RLS still has no
-- UPDATE/DELETE policies, and ordinary privileges match that contract.
GRANT SELECT, INSERT
  ON public.cloud_project_revisions
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cloud_pending_invites
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cloud_projects,
     public.cloud_project_members,
     public.cloud_songs,
     public.cloud_project_revisions,
     public.cloud_pending_invites
  TO service_role;
