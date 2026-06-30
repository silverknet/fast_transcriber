-- 011_access_grants_privileges.sql
--
-- Supabase RLS policies only decide *which rows* a role may touch; the
-- role still needs ordinary Postgres table privileges before PostgREST
-- can reach the table at all. Earlier installs could create
-- `access_grants` without granting those privileges, which made the
-- admin access panel look empty even when Auth users existed.

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT ON public.access_grants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_grants TO service_role;
