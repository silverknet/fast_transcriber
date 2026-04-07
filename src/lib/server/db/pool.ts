import { env } from '$env/dynamic/private'
import pg from 'pg'

let pool: pg.Pool | null | undefined

/** `undefined` = not checked yet; `null` = no `DATABASE_URL`. */
export function getPgPool(): pg.Pool | null {
  if (pool !== undefined) return pool

  const url = env.DATABASE_URL ?? process.env.DATABASE_URL
  if (!url?.trim()) {
    pool = null
    return null
  }

  pool = new pg.Pool({
    connectionString: url,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
  return pool
}

export function isDatabaseConfigured(): boolean {
  return getPgPool() !== null
}
