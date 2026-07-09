/**
 * Background chord-analysis pass for the project view.
 *
 * Chord-chroma analysis normally only runs when a song's Chords tab is
 * opened, so old projects sit with missing keys AND stale chroma (older
 * analyzer versions had the bass-weighting bug — their chord suggestions are
 * confidently wrong, and the matcher now refuses them). This quietly
 * re-analyzes, straight off disk (no file upload — the sidecar reads the
 * audio by path), and writes back fresh `chordHints` + keys so cards fill in
 * and suggestions are ready before the song is even opened.
 *
 *  - Serial, best-effort, gated on the desktop app + sections venv being ready.
 *  - Processes songs that are missing a key OR carry stale/absent chordHints.
 *  - Skips the song currently open in the editor (its own chords tab handles
 *    it — avoids racing the editor's autosave on the same .smap).
 *  - Auto-commits `keyDetail` only when detection is confident; otherwise the
 *    key is stored as `detectedKey` and shown muted on the card.
 *  - Session `attempted` set so it never re-loops a song.
 */
import { get } from 'svelte/store'
import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
import { project as projectStore, patchMetadataForFolder } from '$lib/stores/project'
import { readProjectSong, writeProjectSong } from '$lib/client/desktopProjectFs'
import { decodeSmapFile, encodeSmapFile } from '$lib/songmap/smapFile'
import {
  getSectionsSetupStatus,
  setupSectionsDeps,
  analyzeChordChromaViaDesktopWithStem,
} from '$lib/client/desktopBridge'
import { tonicIntToNote } from '$lib/chords/keyDetect'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import { selectBestStemSet } from '$lib/project/commit'
import type { SongKey, SongMap } from '$lib/songmap/types'

import { CHORD_ANALYZER_VERSION } from '$lib/chords/suggestFromChroma'

/** Commit the key only when at least this confident (mirrors the editor auto-fill). */
const AUTO_SET_CONFIDENCE = 0.15

let running = false
const attempted = new Set<string>()

function audioFingerprint(sm: SongMap): string {
  if (sm.audio?.sha256) return sm.audio.sha256
  if (sm.audio?.fileName) return `${sm.audio.fileName}:${Math.round(sm.audio.durationSec ?? 0)}`
  return 'backfill'
}

/**
 * Detect keys for every analyzed, keyless song in the currently-open project.
 * Idempotent and safe to call repeatedly (e.g. on project load / refresh).
 */
export async function runKeyBackfill(): Promise<void> {
  if (running) return
  const snap = get(projectStore)
  const osPath = snap.osPath
  const proj = snap.data
  if (!osPath || !proj) return
  if (!get(desktopCompanionStatus).reachable) return

  running = true
  try {
    // Ensure the sections venv (numpy/librosa) is ready — bail quietly if not.
    const setup = await getSectionsSetupStatus()
    if (!setup) return
    if (!setup.ready) {
      const installed = await setupSectionsDeps(() => {})
      if (!installed.ok) return
    }

    for (const entry of proj.songs) {
      if (entry.hidden) continue
      const key = `${osPath}::${entry.folder}`
      if (attempted.has(key)) continue
      // The editor owns the actively-open song (its chords tab re-analyzes);
      // don't race its autosave on the same .smap. Not marked attempted so a
      // later pass picks it up once it's closed.
      const cur = get(projectStore)
      if (cur.editingMode === 'project-song' && cur.activeSongId === entry.id) continue
      attempted.add(key)
      try {
        await detectForSong(osPath, entry.folder)
      } catch {
        /* best-effort per song */
      }
      // Stop if the project changed/closed under us.
      if (get(projectStore).osPath !== osPath) break
    }
  } catch {
    /* best-effort */
  } finally {
    running = false
  }
}

async function detectForSong(osPath: string, folder: string): Promise<void> {
  const r = await readProjectSong(osPath, folder)
  if (!r.ok) return
  const blob = new Blob([r.bytes as BlobPart], { type: 'application/octet-stream' })
  const data = await decodeSmapFile(blob)
  const sm = data.project.songMap
  // Only analyzed songs with audio.
  if (sm.timeline.bars.length === 0) return
  const rel = sm.audio?.originalPath
  if (!rel) return
  // Fresh hints + a key (committed or detected) = nothing to do. Stale or
  // missing hints re-analyze even when a key exists — old-analyzer chroma
  // gives confidently wrong chord suggestions and the matcher refuses it.
  const h = sm.chordHints
  const hintsFresh =
    !!h &&
    h.analyzerVersion === CHORD_ANALYZER_VERSION &&
    h.beatChroma.length === sm.timeline.beats.length &&
    h.audioFingerprint === audioFingerprint(sm)
  if (hintsFresh && (sm.metadata.keyDetail || h.detectedKey)) return

  // Prefer the demucs "other" stem (cleaner harmony); else the original audio.
  const meta = get(projectStore).metadataByFolder[folder]
  const best = selectBestStemSet(meta)
  const otherFile = best?.files.find((f) => /^other\.(wav|mp3)$/i.test(f))
  const absPath = otherFile
    ? `${osPath}/${folder}/${best!.pathPrefix}${otherFile}`
    : `${osPath}/${folder}/${rel}`

  const trimOffset = sm.audio?.trim?.startSec ?? 0
  const beats = sortBeatsByTime(sm.timeline.beats).map((b) => ({ startSec: b.timeSec + trimOffset }))
  if (beats.length === 0) return

  const out = await analyzeChordChromaViaDesktopWithStem(absPath, beats)
  if (!out.ok) return
  const dk = out.detectedKey
  const note = dk ? tonicIntToNote(dk.tonic, dk.mode) : null
  const detected: SongKey | null =
    dk && note
      ? {
          root: note.root,
          ...(note.accidental ? { accidental: note.accidental } : {}),
          mode: dk.mode,
        }
      : null
  // Only auto-commit onto a KEYLESS song; never overwrite a user's key.
  const confident = !!dk && dk.confidence >= AUTO_SET_CONFIDENCE && !sm.metadata.keyDetail

  // Fresh chroma is written even when no key was detected — that's what makes
  // chord suggestions work; the key is a bonus.
  const nextMap: SongMap = {
    ...sm,
    metadata: confident && detected ? { ...sm.metadata, keyDetail: detected } : sm.metadata,
    chordHints: {
      beatChroma: out.beatChroma,
      detectedKey: detected && dk ? { ...detected, confidence: dk.confidence } : null,
      audioFingerprint: audioFingerprint(sm),
      generatedAt: new Date().toISOString(),
      analyzerVersion: CHORD_ANALYZER_VERSION,
      analyzerSource: otherFile ? 'stems-other' : 'mix',
    },
  }
  const enc = await encodeSmapFile({ project: { ...data.project, songMap: nextMap } })
  const w = await writeProjectSong(osPath, folder, new Uint8Array(await enc.arrayBuffer()))
  if (!w.ok) return

  patchMetadataForFolder(folder, {
    analyzed: true,
    ...(detected ? { detectedKey: detected, keyIsDetected: !confident && !sm.metadata.keyDetail } : {}),
    ...(confident && detected ? { keyDetail: detected } : {}),
  })
}
