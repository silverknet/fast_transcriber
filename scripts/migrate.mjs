#!/usr/bin/env node
/**
 * Apply SQL migrations when Postgres already has data (docker init only runs on first volume).
 * Usage: DATABASE_URL=postgresql://... node scripts/migrate.mjs
 * Fallback: if DATABASE_URL is missing in env, read it from project `.env`.
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

const url = process.env.DATABASE_URL ?? databaseUrlFromDotEnv()
if (!url) {
  console.error('Set DATABASE_URL (env or .env)')
  process.exit(1)
}

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
