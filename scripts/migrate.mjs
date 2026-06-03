#!/usr/bin/env node
/**
 * Idempotent SQL migration runner.
 *
 * Tracks applied migrations in a `schema_migrations` table so each file
 * runs at most once per database. Safe to re-invoke — fresh installs
 * apply everything; established databases apply only what's new.
 *
 * URL precedence:
 *   1. `MIGRATE_DATABASE_URL` env var
 *   2. `MIGRATE_DATABASE_URL` from project `.env`
 *   3. `DATABASE_URL` env var
 *   4. `DATABASE_URL` from project `.env`
 *
 * Usage:
 *   # local docker
 *   npm run db:migrate
 *
 *   # prod (Supabase) — direct connection (port 5432), not the pooler
 *   MIGRATE_DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
 *     npm run db:migrate
 *
 * Each migration runs inside its own transaction with the bookkeeping
 * insert — a failing migration rolls back cleanly and never leaves the
 * tracking table out of sync with the schema state.
 *
 * Bootstrap behavior: if the tracking table is brand-new but the
 * database already contains tables from earlier migrations (because the
 * user previously ran this script in its pre-bookkeeping form), we
 * back-fill those names so we don't try to re-apply them. See
 * `bootstrapPreExistingMigrations` for the probe.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')

function envFromDotEnv(key) {
  if (!fs.existsSync(envPath)) return null
  const text = fs.readFileSync(envPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq <= 0) continue
    const k = s.slice(0, eq).trim()
    if (k !== key) continue
    const v = s.slice(eq + 1).trim()
    if (!v) return null
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1)
    }
    return v
  }
  return null
}

const url =
  process.env.MIGRATE_DATABASE_URL ??
  envFromDotEnv('MIGRATE_DATABASE_URL') ??
  process.env.DATABASE_URL ??
  envFromDotEnv('DATABASE_URL')
if (!url) {
  console.error('Set MIGRATE_DATABASE_URL or DATABASE_URL (env or .env)')
  process.exit(1)
}

function safeLogUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.password) u.password = '***'
    return u.toString()
  } catch {
    return '(unparseable URL)'
  }
}
console.log('Migrating against:', safeLogUrl(url))

const migrationsDir = path.join(__dirname, '..', 'db', 'migrations')
const allFiles = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

/**
 * For databases that pre-existed this script's bookkeeping layer (i.e.
 * already had 001-008 applied before `schema_migrations` was a thing),
 * back-fill the tracking table so we don't re-run those migrations.
 *
 * Probe rule: if `cloud_project_members` exists, treat every migration
 * numbered ≤ 008 as already applied. That table is the cleanest
 * signature of "old-world apply" — it's only ever created by 005, and
 * if we got past 005 we got past 001-004 too (the sequence is strict).
 * 009+ aren't bootstrapped — they run normally on first invocation.
 *
 * Bump `LAST_PRE_BOOKKEEPING` whenever a future migration is also
 * already-applied on legacy installs; otherwise leave it.
 */
const LAST_PRE_BOOKKEEPING = 8

async function bootstrapPreExistingMigrations(pool, files) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations')
  if (rows[0].n > 0) return

  const probe = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cloud_project_members'",
  )
  if (probe.rowCount === 0) {
    console.log('bootstrap: fresh database, all migrations will run')
    return
  }

  const toMark = files.filter((f) => {
    const num = parseInt(f.slice(0, 3), 10)
    return Number.isFinite(num) && num <= LAST_PRE_BOOKKEEPING
  })
  for (const name of toMark) {
    await pool.query(
      'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
      [name],
    )
  }
  console.log(`bootstrap: marked ${toMark.length} pre-existing migration(s) as applied`)
}

const pool = new pg.Pool({ connectionString: url })
try {
  await ensureMigrationsTable(pool)
  await bootstrapPreExistingMigrations(pool, allFiles)

  const appliedRows = await pool.query('SELECT name FROM schema_migrations')
  const applied = new Set(appliedRows.rows.map((r) => r.name))

  for (const file of allFiles) {
    if (applied.has(file)) {
      console.log('Skipped (already applied):', file)
      continue
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    // Each migration is wrapped in its own transaction so a failure
    // rolls back everything — including the bookkeeping insert.
    await pool.query('BEGIN')
    try {
      await pool.query(sql)
      await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await pool.query('COMMIT')
      console.log('Migration OK:', file)
    } catch (e) {
      await pool.query('ROLLBACK').catch(() => {})
      throw e
    }
  }
} finally {
  await pool.end()
}
