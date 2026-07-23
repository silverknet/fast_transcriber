/**
 * End-to-end check of the SHARING data path, against the real database.
 *
 *   npx vite-node scripts/check-cloud-sync.ts
 *
 * Unit tests prove the merge algebra; this proves the parts they cannot reach:
 * that a SongMap survives a real jsonb round-trip (float re-serialisation, key
 * order, undefined-vs-missing), that the read-boundary migration produces a
 * fingerprint identical to the writer's, and that two clients editing the same
 * song converge instead of clobbering each other.
 *
 * Everything happens inside a throwaway project that is deleted in `finally`
 * (ON DELETE CASCADE takes the song with it). Real project data is never read
 * or written. Writes go straight to the table with the service role: the goal
 * is to exercise the PAYLOAD path (`toCollabSongMap` → jsonb → parse → merge),
 * not the HTTP auth layer.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { collabContentFingerprint, toCollabSongMap } from '../src/lib/songmap/collab'
import { planRemoteApplication } from '../src/lib/project/songSession'
import { addDraftAndActivate, ensureActiveDraftIdentity, switchToDraft } from '../src/lib/songmap/drafts'
import { createEmptySongMap } from '../src/lib/songmap/factory'
import { parseSongMap } from '../src/lib/songmap/parse'
import type { HarmonyEvent, SongMap } from '../src/lib/songmap/types'

function env(k: string): string {
  const raw = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
  for (const line of raw.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    const i = l.indexOf('=')
    if (i < 0) continue
    if (l.slice(0, i).trim() === k) return l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  throw new Error(`missing ${k}`)
}

const supa = createClient(env('PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** Deliberately awkward beat times: what a real analysis produces, and what
 *  jsonb has to hand back bit-for-bit. */
const BEAT_TIMES = [0, 0.4583333333333333, 0.9166666666666666, 1.375]

/** Chord anchored to a beat. Each needs a DISTINCT beat — one chord per beat. */
function chord(id: string, displayRaw: string, beat: number): HarmonyEvent {
  const startSec = BEAT_TIMES[beat]!
  return {
    id,
    barId: 'bar-0',
    beatId: `beat-${beat}`,
    startSec,
    endSec: startSec + 0.4583333333333333,
    chord: { root: 'B', quality: 'min7', alterations: ['b5'], displayRaw },
  }
}

/** A song exercising every v6 addition: drafts, chord colour, recording identity. */
function buildSong(): SongMap {
  const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
  const withTimeline: SongMap = {
    ...base,
    metadata: { ...base.metadata, title: 'e2e probe', bpm: 128.33333333333334, analyzed: true },
    timeline: {
      bars: [
        {
          id: 'bar-0',
          index: 0,
          startSec: 0,
          endSec: 1.8333333333333333,
          meter: { numerator: 4, denominator: 4 },
          beatCount: 4,
          beatIds: ['beat-0', 'beat-1', 'beat-2', 'beat-3'],
        },
      ],
      beats: BEAT_TIMES.map((timeSec, i) => ({
        id: `beat-${i}`,
        barId: 'bar-0',
        indexInBar: i,
        timeSec,
      })),
    },
    sections: [
      { id: 'sec-0', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 0 } },
    ],
    harmony: [chord('h-1', 'Bm7b5', 1)],
    audio: {
      fileName: 'probe.wav',
      trim: { startSec: 0, endSec: 1.8333333333333333 },
      source: 'upload',
      sha256: 'a'.repeat(64),
      fingerprint: {
        version: 1,
        durationSec: 222.017,
        envelope: Array.from({ length: 64 }, (_, i) => (i * 7) % 256),
      },
    },
    lyrics: { words: [], sourceText: 'probe lyrics' },
  }
  // `createEmptySongMap` already stamps a draft identity, so this is a no-op
  // here — kept because a map arriving from elsewhere may lack one.
  return ensureActiveDraftIdentity(withTimeline, () => 'draft-a')
}

async function pushToCloud(songId: string, sm: SongMap): Promise<void> {
  const { error } = await supa
    .from('cloud_songs')
    .update({ song_map: toCollabSongMap(sm) as unknown as object })
    .eq('id', songId)
  if (error) throw new Error('push: ' + error.message)
}

async function fetchFromCloud(songId: string): Promise<SongMap> {
  const { data, error } = await supa.from('cloud_songs').select('song_map').eq('id', songId).single()
  if (error) throw new Error('fetch: ' + error.message)
  // Exactly what `normalizeCloudSongMap` does at the read boundary.
  return parseSongMap(JSON.stringify(data.song_map))
}

let projectId: string | null = null
try {
  const { data: members } = await supa.from('cloud_project_members').select('user_id').limit(1)
  const owner = members?.[0]?.user_id
  if (!owner) throw new Error('no user available to own the throwaway project')

  const { data: proj, error: pErr } = await supa
    .from('cloud_projects')
    .insert({ owner_user_id: owner, name: 'cloud-sync probe (auto-deleted)' })
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
  const songId = song.id as string

  // ── 1. Round-trip fidelity ────────────────────────────────────────────────
  console.log('\n1. a SongMap survives a real jsonb round trip')
  const clientA = buildSong()
  await pushToCloud(songId, clientA)
  const returned = await fetchFromCloud(songId)

  check(
    'content fingerprint is unchanged',
    collabContentFingerprint(returned) === collabContentFingerprint(clientA),
    'a mismatch here makes every client think the others are dirty — the push loop',
  )
  check('chord colour survives', returned.harmony[0]?.chord.alterations?.[0] === 'b5')
  check(
    'awkward floats survive',
    returned.harmony[0]?.startSec === clientA.harmony[0]!.startSec,
    `${returned.harmony[0]?.startSec} vs ${clientA.harmony[0]!.startSec}`,
  )
  check('recording fingerprint survives', returned.audio?.fingerprint?.envelope.length === 64)
  check(
    'draft identity survives',
    returned.activeDraftId === clientA.activeDraftId && returned.activeDraftId !== undefined,
    `${returned.activeDraftId} vs ${clientA.activeDraftId}`,
  )
  check('lyrics survive', returned.lyrics?.sourceText === 'probe lyrics')

  // ── 2. Two clients, same draft, non-colliding edits ───────────────────────
  console.log('\n2. two clients editing the same draft both keep their work')
  const aEdits: SongMap = {
    ...clientA,
    harmony: [...clientA.harmony, chord('h-a', 'Cmaj7', 2)],
  }
  const bEdits: SongMap = {
    ...clientA,
    harmony: [...clientA.harmony, chord('h-b', 'E7b9', 3)],
  }
  // B pushes first; A pulls with unpushed local work.
  await pushToCloud(songId, bEdits)
  const fromCloud = await fetchFromCloud(songId)
  const merged = planRemoteApplication({
    incoming: fromCloud,
    memory: aEdits,
    disk: clientA,
    lastSyncedContentHash: collabContentFingerprint(clientA),
  })
  const ids = merged.merged.harmony.map((h) => h.id)
  check('local unpushed edit survives the pull', ids.includes('h-a'))
  check('remote edit arrives', ids.includes('h-b'))
  check('the shared original is still there', ids.includes('h-1'))
  check('editor is told its copy was dirty', merged.localState === 'dirty')

  // ── 3. Two clients on DIFFERENT drafts ────────────────────────────────────
  console.log('\n3. two clients on different drafts do not blend arrangements')
  const withSecond = addDraftAndActivate(
    clientA,
    { sections: [], harmony: [chord('h-d2', 'Am7', 0)], lyrics: undefined },
    'Sheet import',
    (() => {
      let n = 0
      return () => `gen-${++n}`
    })(),
  )
  // Switch back to the ORIGINAL draft — its id comes from the map, not a literal.
  const switched = switchToDraft(withSecond, clientA.activeDraftId!, () => 'gen-x')
  if (!switched.ok) throw new Error('fixture: switch failed')
  await pushToCloud(songId, withSecond)
  const remoteDraft = await fetchFromCloud(songId)
  const draftMerge = planRemoteApplication({
    incoming: remoteDraft,
    memory: switched.map,
    disk: switched.map,
    lastSyncedContentHash: collabContentFingerprint(switched.map),
  })
  const activeIds = draftMerge.merged.harmony.map((h) => h.id)
  check(
    'the two drafts are not unioned together',
    !(activeIds.includes('h-d2') && activeIds.includes('h-1')),
    `got ${activeIds.join(',')}`,
  )
  check(
    'the losing draft is preserved, not dropped',
    (draftMerge.merged.drafts ?? []).length > 0,
  )

  // ── 4. Migration determinism across devices ───────────────────────────────
  console.log('\n4. a legacy row migrates identically on two devices')
  const legacy = {
    ...createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' }),
    formatVersion: 5,
    activeDraftId: undefined,
    activeDraftName: undefined,
    chordLayers: [{ id: 'cl1', name: 'Sheet import', harmony: [] }],
    activeChordLayerName: 'My chords',
  }
  await supa.from('cloud_songs').update({ song_map: legacy as unknown as object }).eq('id', songId)
  const deviceA = await fetchFromCloud(songId)
  const deviceB = await fetchFromCloud(songId)
  check('byte-identical migration', JSON.stringify(deviceA) === JSON.stringify(deviceB))
  check(
    'identical fingerprints (no phantom-conflict loop)',
    collabContentFingerprint(deviceA) === collabContentFingerprint(deviceB),
  )
  check('legacy layers became drafts', (deviceA.drafts ?? []).length === 1)
} catch (e) {
  console.error('\nprobe failed:', e instanceof Error ? e.message : e)
  failures++
} finally {
  if (projectId) {
    const { error } = await supa.from('cloud_projects').delete().eq('id', projectId)
    if (error) console.error('CLEANUP FAILED — delete project', projectId, 'by hand:', error.message)
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}
