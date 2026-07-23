#!/usr/bin/env node
/**
 * Does Supabase Realtime actually deliver changes for the cloud tables?
 *
 *   node scripts/check-realtime.mjs
 *
 * WHY THIS SCRIPT EXISTS
 *
 * A channel subscribed to a table that is NOT in the `supabase_realtime`
 * publication still reports `SUBSCRIBED`. It just never receives anything. That
 * makes the failure invisible to every other kind of test: the client code is
 * correct, the subscription "succeeds", and auto-pull silently never fires.
 *
 * This exact misconfiguration shipped undetected — cloud sync was push-only,
 * with members receiving no one else's edits after the initial join. See
 * `db/migrations/015_realtime_publication.sql`.
 *
 * WHAT IT DOES
 *
 * Creates a throwaway project + song, subscribes, writes, and waits for the
 * event. Nothing touches real project data, and the throwaway is removed in a
 * `finally` block (ON DELETE CASCADE takes the song and member rows with it).
 *
 * TIMING: right after applying the publication migration, the first run can
 * still fail — Realtime picks the change up when its replication connection
 * cycles (~30s). Re-run before concluding anything.
 *
 * Requires `PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env`.
 * Service role deliberately bypasses RLS, so a failure here is a publication
 * problem rather than a policy problem.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')

function envFromDotEnv(key) {
  if (process.env[key]) return process.env[key]
  if (!fs.existsSync(envPath)) return null
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    const i = l.indexOf('=')
    if (i < 0) continue
    if (l.slice(0, i).trim() === key) return l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return null
}

const url = envFromDotEnv('PUBLIC_SUPABASE_URL')
const key = envFromDotEnv('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !key) {
  console.error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env)')
  process.exit(1)
}

const supa = createClient(url, key, { auth: { persistSession: false } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let projectId = null
let channel = null
let ok = false

try {
  const { data: members, error: mErr } = await supa
    .from('cloud_project_members')
    .select('user_id')
    .limit(1)
  if (mErr) throw new Error('read members: ' + mErr.message)
  const owner = members?.[0]?.user_id
  if (!owner) throw new Error('no existing user to own the throwaway project')

  const { data: proj, error: pErr } = await supa
    .from('cloud_projects')
    .insert({ owner_user_id: owner, name: 'realtime probe (auto-deleted)' })
    .select('id')
    .single()
  if (pErr) throw new Error('create project: ' + pErr.message)
  projectId = proj.id

  const { data: song, error: sErr } = await supa
    .from('cloud_songs')
    .insert({ cloud_project_id: projectId, song_map: { formatVersion: 6 }, sort_order: 0 })
    .select('id')
    .single()
  if (sErr) throw new Error('create song: ' + sErr.message)

  const events = []
  channel = supa
    .channel(`realtime-probe:${projectId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cloud_songs', filter: `cloud_project_id=eq.${projectId}` },
      (payload) => events.push(payload.eventType),
    )

  const status = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('TIMEOUT'), 15000)
    channel.subscribe((s) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) {
        clearTimeout(t)
        resolve(s)
      }
    })
  })
  if (status !== 'SUBSCRIBED') throw new Error(`channel status: ${status}`)
  await sleep(1000)

  const { error: uErr } = await supa
    .from('cloud_songs')
    .update({ song_map: { formatVersion: 6, probe: true } })
    .eq('id', song.id)
  if (uErr) throw new Error('update: ' + uErr.message)

  for (let i = 0; i < 30 && events.length === 0; i++) await sleep(500)
  ok = events.length > 0

  if (ok) {
    console.log(`PASS — realtime delivered [${events.join(', ')}]. Auto-pull will fire.`)
  } else {
    console.error('FAIL — subscribed successfully but no event arrived within 15s.')
    console.error('       cloud_songs is not in the supabase_realtime publication.')
    console.error('       Apply db/migrations/015_realtime_publication.sql.')
  }
} catch (e) {
  console.error('FAIL —', e.message)
} finally {
  if (channel) await supa.removeChannel(channel).catch(() => {})
  if (projectId) {
    const { error } = await supa.from('cloud_projects').delete().eq('id', projectId)
    if (error) console.error('CLEANUP FAILED — remove project', projectId, 'by hand:', error.message)
  }
  process.exit(ok ? 0 : 1)
}
