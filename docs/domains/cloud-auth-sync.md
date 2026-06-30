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

Audio bytes are not the primary cloud payload. Cloud sync centers on project
metadata, song JSON, members, and revisions. Missing audio is handled by local
reconcile and hydration packages.

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
