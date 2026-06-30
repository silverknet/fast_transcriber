-- 014_cloud_pending_invite_conflict.sql
--
-- `cloud_pending_invites` originally enforced idempotence with a unique
-- expression index on `(cloud_project_id, lower(invited_email))`. That blocks
-- case-variant duplicates, but Supabase/PostgREST upsert needs a concrete
-- conflict target expressed as column names. Normalize stored emails and add a
-- real unique key on `(cloud_project_id, invited_email)` so
-- `onConflict: 'cloud_project_id,invited_email'` is honest.

UPDATE public.cloud_pending_invites
SET invited_email = lower(trim(invited_email))
WHERE invited_email <> lower(trim(invited_email));

CREATE OR REPLACE FUNCTION public.cloud_pending_invites_normalize_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.invited_email := lower(trim(NEW.invited_email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cloud_pending_invites_normalize_email_trg
  ON public.cloud_pending_invites;

CREATE TRIGGER cloud_pending_invites_normalize_email_trg
BEFORE INSERT OR UPDATE OF invited_email ON public.cloud_pending_invites
FOR EACH ROW
EXECUTE FUNCTION public.cloud_pending_invites_normalize_email();

CREATE UNIQUE INDEX IF NOT EXISTS cloud_pending_invites_project_email_key
  ON public.cloud_pending_invites (cloud_project_id, invited_email);
