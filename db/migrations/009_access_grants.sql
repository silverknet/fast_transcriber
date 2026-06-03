-- 009_access_grants.sql
--
-- Invite-only access gate. Every BarBro user falls into one of:
--   - granted : can use the app
--   - pending : signed in but waiting for admin approval
--   - denied  : admin explicitly refused; sign-in still works but no app access
--
-- Two on-ramps to "granted":
--   1. Admin pre-invites by email — row inserted server-side with
--      status='granted' before that user has signed up. When the user
--      eventually signs in, `user_id` is linked on the next visit.
--   2. User signs in cold — a pending row is auto-created on first
--      navigation through the gate. Admin reviews + flips to granted.
--
-- The row is keyed on `email` (unique) rather than user_id so the
-- pre-invite case works before any auth.users row exists. `user_id`
-- gets stamped lazily.
--
-- Admin identity lives OUTSIDE this table — `ADMIN_USER_IDS` env var
-- on the server picks admins by Supabase user UUID. Keeps the schema
-- simple and avoids the "who can grant admin to whom" recursion.
-- Admin writes hit this table via the service-role client (bypasses RLS).

CREATE TABLE access_grants (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL UNIQUE,
  user_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  status       text        NOT NULL CHECK (status IN ('pending','granted','denied')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  note         text
);

CREATE INDEX access_grants_status_idx ON access_grants (status, requested_at);
CREATE INDEX access_grants_user_idx   ON access_grants (user_id);

-- Lowercase emails for canonical matching (auth.users.email is already
-- normalized; we mirror that here so admin invites in any casing match).
CREATE OR REPLACE FUNCTION public.access_grants_normalize_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER access_grants_normalize_email_trg
BEFORE INSERT OR UPDATE OF email ON access_grants
FOR EACH ROW
EXECUTE FUNCTION public.access_grants_normalize_email();

-- RLS: users see their own row only (by user_id, or — for unlinked
-- pre-invites — by matching email on auth.users). NO user-facing
-- INSERT/UPDATE/DELETE policies — every mutation goes through the
-- service-role client in server endpoints, which RLS doesn't apply to.
ALTER TABLE access_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_grants_self_select ON access_grants
  FOR SELECT USING (
    user_id = auth.uid()
    OR email = (SELECT lower(email) FROM auth.users WHERE id = auth.uid())
  );
