-- 012_cloud_pending_invites.sql
--
-- Pending invites for cloud projects.
--
-- The existing `POST /api/cloud/projects/:id/members` flow requires the
-- invitee to already have a Supabase auth user (looked up by email). If
-- they haven't signed in yet, the invite fails and the owner has to
-- retry later. This table holds the invite until the invitee shows up:
-- on their first sign-in, the access-gate hook calls a consume RPC that
-- promotes every pending row matching their email into a real
-- `cloud_project_members` row.
--
-- The unique index on `(cloud_project_id, lower(invited_email))` keeps
-- the inviter idempotent — re-sending an invite to the same email just
-- updates the role.

CREATE TABLE IF NOT EXISTS public.cloud_pending_invites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_project_id  uuid NOT NULL REFERENCES public.cloud_projects(id) ON DELETE CASCADE,
  invited_email     text NOT NULL,
  role              text NOT NULL CHECK (role IN ('owner','editor')),
  invited_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cloud_pending_invites_proj_email_idx
  ON public.cloud_pending_invites (cloud_project_id, lower(invited_email));

CREATE INDEX IF NOT EXISTS cloud_pending_invites_email_idx
  ON public.cloud_pending_invites (lower(invited_email));

ALTER TABLE public.cloud_pending_invites ENABLE ROW LEVEL SECURITY;

-- ── RLS ───────────────────────────────────────────────────────────────
-- Owner of the cloud project can list / create / delete invites for it.
-- Invitee (matched by email on their JWT) can list theirs but never
-- write — accepting goes through the RPC below, which is the only path
-- that creates a member row + deletes the pending row in one tx.

CREATE POLICY cloud_pending_invites_owner_select ON public.cloud_pending_invites
  FOR SELECT USING (public.is_project_owner(cloud_project_id, auth.uid()));

CREATE POLICY cloud_pending_invites_invitee_select ON public.cloud_pending_invites
  FOR SELECT USING (lower(invited_email) = lower(auth.jwt() ->> 'email'));

CREATE POLICY cloud_pending_invites_owner_insert ON public.cloud_pending_invites
  FOR INSERT WITH CHECK (
    public.is_project_owner(cloud_project_id, auth.uid())
    AND invited_by = auth.uid()
  );

CREATE POLICY cloud_pending_invites_owner_update ON public.cloud_pending_invites
  FOR UPDATE
  USING (public.is_project_owner(cloud_project_id, auth.uid()))
  WITH CHECK (public.is_project_owner(cloud_project_id, auth.uid()));

CREATE POLICY cloud_pending_invites_owner_delete ON public.cloud_pending_invites
  FOR DELETE USING (public.is_project_owner(cloud_project_id, auth.uid()));

-- ── RPC: cloud_consume_pending_invites_for_email ──────────────────────
-- Called from the access-gate after a fresh sign-in. Walks every
-- pending invite that matches the caller's email, inserts a membership
-- row (no-op if one already exists), and deletes the pending row.
-- All in one tx. Returns the count consumed.
--
-- SECURITY DEFINER because the caller (a freshly-signed-in user) is
-- not yet a project member and so can't insert into cloud_project_members
-- under its own RLS policy. The function locks identity to `auth.uid()`
-- + their email, so it can't be abused to grant arbitrary access.

CREATE OR REPLACE FUNCTION public.cloud_consume_pending_invites_for_email()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id    uuid := auth.uid();
  caller_email text := lower(auth.jwt() ->> 'email');
  consumed     integer := 0;
  inv          record;
BEGIN
  IF caller_id IS NULL OR caller_email IS NULL OR caller_email = '' THEN
    RETURN 0;
  END IF;

  FOR inv IN
    SELECT id, cloud_project_id, role
    FROM public.cloud_pending_invites
    WHERE lower(invited_email) = caller_email
  LOOP
    INSERT INTO public.cloud_project_members (cloud_project_id, user_id, role)
    VALUES (inv.cloud_project_id, caller_id, inv.role)
    ON CONFLICT (cloud_project_id, user_id) DO NOTHING;

    DELETE FROM public.cloud_pending_invites WHERE id = inv.id;
    consumed := consumed + 1;
  END LOOP;

  RETURN consumed;
END;
$$;

-- ── RPC: cloud_pending_invite_project_names ───────────────────────────
-- Returns (project_id, name) for every cloud project the caller has a
-- pending invite to. Lets the "Invited to" UI on the no-project landing
-- show the project NAME without needing the invitee to be a member of
-- `cloud_projects` (which RLS-gates the SELECT). SECURITY DEFINER is
-- safe here because the function is read-only and filtered by the
-- caller's email.

CREATE OR REPLACE FUNCTION public.cloud_pending_invite_project_names()
RETURNS TABLE(project_id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT p.id, p.name
  FROM public.cloud_projects p
  JOIN public.cloud_pending_invites i
    ON i.cloud_project_id = p.id
   AND lower(i.invited_email) = lower(auth.jwt() ->> 'email');
$$;

-- ── RPC: cloud_accept_pending_invite ──────────────────────────────────
-- Same logic as above but for a single project (called from the invitee
-- "Accept & join" button). Returns true on success, false if no matching
-- pending invite exists. Identity-locked the same way.

CREATE OR REPLACE FUNCTION public.cloud_accept_pending_invite(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id    uuid := auth.uid();
  caller_email text := lower(auth.jwt() ->> 'email');
  inv          record;
BEGIN
  IF caller_id IS NULL OR caller_email IS NULL OR caller_email = '' THEN
    RETURN false;
  END IF;

  SELECT id, role INTO inv
  FROM public.cloud_pending_invites
  WHERE cloud_project_id = p_project_id
    AND lower(invited_email) = caller_email
  LIMIT 1;

  IF inv.id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.cloud_project_members (cloud_project_id, user_id, role)
  VALUES (p_project_id, caller_id, inv.role)
  ON CONFLICT (cloud_project_id, user_id) DO NOTHING;

  DELETE FROM public.cloud_pending_invites WHERE id = inv.id;
  RETURN true;
END;
$$;
