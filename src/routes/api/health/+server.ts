import { json } from '@sveltejs/kit'
import { getPgPool } from '$lib/server/db/pool'

export async function GET() {
  const pool = getPgPool()
  let database: 'ok' | 'off' | 'error' = 'off'
  if (pool) {
    try {
      await pool.query('SELECT 1')
      database = 'ok'
    } catch {
      database = 'error'
    }
  }

  return json({
    ok: true,
    ts: new Date().toISOString(),
    database,
  })
}
