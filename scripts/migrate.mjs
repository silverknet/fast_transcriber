#!/usr/bin/env node
/**
 * Apply SQL migrations.
 *
 * Local docker init only runs on first volume creation, so this is the
 * right tool for "I added a new migration after the DB was already
 * provisioned". Also the prod story: same script, just point it at
 * Supabase.
 *
 * URL precedence:
 *   1. `MIGRATE_DATABASE_URL` env (use this for prod — point at the
 *      **direct** Supabase URL `db.<ref>.supabase.co:5432`, NOT the
 *      pgbouncer pooler — DDL inside transactions misbehaves through
 *      pgbouncer transaction mode).
 *   2. `DATABASE_URL` env.
 *   3. `DATABASE_URL` from the project's `.env` file.
 *
 * Usage:
 *   # local docker
 *   npm run db:migrate
 *
 *   # prod (Supabase) — direct connection, NOT the pooler
 *   MIGRATE_DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
 *     npm run db:migrate
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')

function databaseUrlFromDotEnv() {
  if (!fs.existsSync(envPath)) return null
  const text = fs.readFileSync(envPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq <= 0) continue
    const k = s.slice(0, eq).trim()
    if (k !== 'DATABASE_URL') continue
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
  process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? databaseUrlFromDotEnv()
if (!url) {
  console.error('Set MIGRATE_DATABASE_URL or DATABASE_URL (env or .env)')
  process.exit(1)
}

// Mask the password before logging so prod URLs don't leak into CI logs.
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
const sqlFiles = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const pool = new pg.Pool({ connectionString: url })
try {
  for (const file of sqlFiles) {
    const sqlPath = path.join(migrationsDir, file)
    const sql = fs.readFileSync(sqlPath, 'utf8')
    await pool.query(sql)
    console.log('Migration OK:', file)
  }
} finally {
  await pool.end()
}
