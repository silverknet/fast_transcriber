import { isDatabaseConfigured } from '$lib/server/db/pool'
import { isValidSessionId } from '$lib/server/db/sessionRepo'

type LayoutData = {
  savedSessionId: string | null
}

export async function load({ cookies }): Promise<LayoutData> {
  const sid = cookies.get('barbro_session') ?? ''
  if (!sid || !isValidSessionId(sid) || !isDatabaseConfigured()) {
    return { savedSessionId: null }
  }

  const { getPgPool } = await import('$lib/server/db/pool')
  const pool = getPgPool()
  if (!pool) return { savedSessionId: null }

  // DB is best-effort — if Postgres is unreachable (local container down,
  // network issue, etc.) we still want the app to render. Treat any
  // failure as "no saved session" and let the user keep working.
  try {
    const r = await pool.query<{ has_song: boolean }>(
      `SELECT (song_map_json IS NOT NULL) AS has_song
       FROM editor_sessions
       WHERE id = $1::uuid`,
      [sid],
    )
    const hasSong = r.rows[0]?.has_song === true
    return { savedSessionId: hasSong ? sid : null }
  } catch (e) {
    console.warn('[layout.server] Postgres unavailable — skipping session restore:', e instanceof Error ? e.message : e)
    return { savedSessionId: null }
  }
}
