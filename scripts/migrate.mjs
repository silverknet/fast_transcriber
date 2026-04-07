#!/usr/bin/env node
/**
 * Apply SQL migrations when Postgres already has data (docker init only runs on first volume).
 * Usage: DATABASE_URL=postgresql://... node scripts/migrate.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const url = process.env.DATABASE_URL
if (!url) {
  console.error('Set DATABASE_URL')
  process.exit(1)
}

const sqlPath = path.join(__dirname, '..', 'db', 'migrations', '001_editor_sessions.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const pool = new pg.Pool({ connectionString: url })
try {
  await pool.query(sql)
  console.log('Migration OK:', path.basename(sqlPath))
} finally {
  await pool.end()
}
