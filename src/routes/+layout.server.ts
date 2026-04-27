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

  const r = await pool.query<{ has_song: boolean }>(
    `SELECT (song_map_json IS NOT NULL) AS has_song
     FROM editor_sessions
     WHERE id = $1::uuid`,
    [sid],
  )
  const hasSong = r.rows[0]?.has_song === true
  return { savedSessionId: hasSong ? sid : null }
}
