import { env } from '$env/dynamic/private'
import pg from 'pg'

let pool: pg.Pool | null | undefined

/**
 * Lazy pg pool. `undefined` = not checked yet; `null` = no `DATABASE_URL`
 * (the app falls back to "DB not configured" responses in route handlers).
 *
 * Prod target = Supabase via the **Transaction pooler** (host
 * `aws-…-pooler.supabase.com`, port `6543`). Reasons it matters:
 *
 *  - **`max: 1`** — every Netlify Function invocation runs in its own
 *    Lambda container with its own `pg.Pool`. Hundreds of concurrent
 *    invocations × `max: 8` would blow past Supabase's connection ceiling
 *    instantly. With the pgbouncer in front we only need one socket per
 *    Function; pgbouncer multiplexes them onto the real Postgres.
 *  - **No named prepared statements** — pgbouncer transaction mode breaks
 *    them. All call sites in `*.repo.ts` use `pool.query(text, values)`
 *    (unnamed), so we're already compatible. Don't introduce
 *    `pool.query({ name, text, values })` without re-evaluating this.
 *  - **SSL is honored from the URL** — Supabase URLs include
 *    `?sslmode=require`; `pg` reads that and enables TLS with the system
 *    trust store. We don't need to pass an explicit `ssl: {...}` option.
 */
export function getPgPool(): pg.Pool | null {
  if (pool !== undefined) return pool

  const url = env.DATABASE_URL ?? process.env.DATABASE_URL
  if (!url?.trim()) {
    pool = null
    return null
  }

  pool = new pg.Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  return pool
}

export function isDatabaseConfigured(): boolean {
  return getPgPool() !== null
}
