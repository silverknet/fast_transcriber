# Cloud, Auth, And Access

BarBro uses Supabase for sign-in, invite-only access, and optional cloud
project collaboration.

## Environment

Local dev uses whatever Supabase project is configured in `.env`:

```txt
PUBLIC_SUPABASE_URL=...
PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_USER_IDS=...
```

Do not assume `localhost:5173` means local Supabase. The frontend can be local
while Auth/PostgREST point at hosted Supabase.

## Auth And Access Gate

| Concern | Source |
|---|---|
| Signed-in identity | Supabase Auth (`auth.users`) |
| App access status | `public.access_grants` |
| Admin identity | `ADMIN_USER_IDS` env var |
| Route gate | [`../../src/lib/server/access.ts`](../../src/lib/server/access.ts) |
| Admin UI | [`../../src/routes/admin/access/`](../../src/routes/admin/access/) |

Admins are not granted through `access_grants`; they bypass the gate by user id
from `ADMIN_USER_IDS`.

The admin access page lists:

- existing `access_grants` rows
- Supabase Auth users that do not yet have access rows

When synthesizing Auth-only pending rows, env-admin users are excluded so admins
do not approve themselves.

## Invite Flow

Cold signup:

1. User signs in through Google or magic link.
2. The access gate creates or discovers a pending row.
3. Admin reviews `/admin/access`.
4. Approve updates or creates `access_grants.status = 'granted'`.

Pre-invite:

1. Admin enters email in `/admin/access`.
2. App writes `access_grants.status = 'granted'` with `user_id = null`.
3. When that user signs in later, the access helper links `user_id`.

## Service Role

Use service-role Supabase clients only in trusted server code. Current trusted
uses:

- admin access reads/mutations
- access gate creation/linking of `access_grants`
- server-side cloud project endpoints when RLS cannot express the operation

The `access_grants` table requires both RLS policies and ordinary table grants.
See migration [`011_access_grants_privileges.sql`](../../db/migrations/011_access_grants_privileges.sql).

## Cloud Project Sync

Core files:

- [`../../src/lib/client/cloudSync.ts`](../../src/lib/client/cloudSync.ts)
- [`../../src/routes/api/cloud/`](../../src/routes/api/cloud/)
- [`../../src/lib/server/db/cloudRepo.ts`](../../src/lib/server/db/cloudRepo.ts)
- migrations [`../../db/migrations/005_cloud_projects.sql`](../../db/migrations/005_cloud_projects.sql) through [`../../db/migrations/010_cloud_rpcs.sql`](../../db/migrations/010_cloud_rpcs.sql)

> **Realtime requires a publication entry, and the failure is silent.** A
> channel subscribed to a table that is not in `supabase_realtime` still reports
> `SUBSCRIBED` and simply never receives anything. `cloud_songs`,
> `cloud_projects` and `cloud_project_members` were missing from it, so
> auto-pull never fired and sync was effectively **push-only** — members
> uploaded their edits but received nobody else's after the initial join.
> Fixed by [`015_realtime_publication.sql`](../../db/migrations/015_realtime_publication.sql);
> verify with `npm run check:realtime`, which creates a throwaway project,
> writes to it, waits for the event, and deletes it. Run it after any change to
> RLS, replica identity, or the publication.

> **`cloud_push_song` / `cloud_patch_manifest` MUST stay `SECURITY DEFINER`, and
> the failure was silent, total data loss for non-owners.** These RPCs bump
> `cloud_projects.revision` with a plain UPDATE, but the update policy on
> `cloud_projects` (`cloud_projects_owner_update`, `008_rls.sql`) is **owner-only**.
> While they ran `SECURITY INVOKER` (the caller's RLS), a non-owner editor's
> revision UPDATE matched **zero rows** → `new_rev` NULL → the `cloud_songs`
> INSERT violated `revision NOT NULL` (23502) → HTTP 500, which
> `cloudRepo.rpcPushSong` classifies as `conflict: false` and the client's push
> `.catch()` swallows. Net: **collaborators' chord/draft edits never persisted,
> no error shown** (owners passed the RLS check, so own-project testing looked
> fine). Fixed by [`017_cloud_push_member_write.sql`](../../db/migrations/017_cloud_push_member_write.sql):
> both RPCs are now `SECURITY DEFINER` with an explicit `is_project_member`
> gate (+ a cross-project song-id guard, since DEFINER also bypasses
> `cloud_songs` RLS). **Do not revert them to `SECURITY INVOKER`.** There is no
> unit coverage for this (RLS needs a live DB with auth roles) — verify by
> pushing as a non-owner member.

Audio bytes are not the primary cloud payload. Cloud sync centers on project
metadata, song JSON, members, and revisions. Missing audio is handled by local
reconcile and hydration packages.

> **Direction of travel:** the last-write-wins merge described below is being
> replaced by a CRDT (Yjs) so simultaneous edits converge without prompting.
> See [`collab-sync-architecture.md`](collab-sync-architecture.md). Everything
> in this section is current behaviour until Phase 4 of that plan lands.

### Song drafts and conflict merging

A song's `sections` / `harmony` / `lyrics` are the content of its **active
draft** (see [`../smap-format.md`](../smap-format.md) §3.6.1). That makes draft
identity load-bearing for merging, in
[`../../src/lib/songmap/collabMerge.ts`](../../src/lib/songmap/collabMerge.ts):

- **Same `activeDraftId` on both sides** — the two people are editing the same
  arrangement. Chords and sections merge per id, so concurrent edits both land.
- **Different `activeDraftId`** — one collaborator switched drafts or ran a
  sheet import. Per-id merging is meaningless here: unioning them yields an
  arrangement neither person made (my 15 sections plus their 13). The merge
  instead resolves at draft level — one draft wins the root wholesale, the
  other is preserved in `drafts[]` — and raises a single `activeDraft`
  conflict rather than a pile of per-chord rows. Choosing "keep mine" swaps
  which draft sits at the root; nothing is dropped either way.

`drafts[]` merges **by id**, not last-write-wins, so a draft each collaborator
created between syncs both survive.

Two determinism rules the merge and the v5→v6 migration must both keep, because
their output is hashed by `collabContentFingerprint()` and pushed:

- no randomly-minted ids,
- no wall-clock timestamps.

Break either and two devices produce different bytes for the same input, each
reads the other as dirty, and they push in a loop — the failure mode commit
`174610c` fixed for legacy cue tracks.

## Migrations

```bash
npm run db:migrate
```

For hosted Supabase, direct `db.<ref>.supabase.co` DNS may not work from every
network. The Supabase CLI can query a linked project through the Management API:

```bash
supabase link --project-ref <ref>
supabase db query --linked --file db/migrations/<file>.sql
```

When applying a migration manually, also record it in `schema_migrations` if the
repo migration runner should skip it later.
