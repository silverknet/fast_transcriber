/**
 * PROJECT HEALTH — is any song carrying damage a load would hide?
 *
 * ## Why this exists
 *
 * Every past data bug in this repo had the same shape: the file was fine, the
 * app was wrong, and nobody could SEE it. Parser whitelists ate `performers`,
 * then `performerId`, then `spokenCountIn` — saved perfectly, vanished on
 * load. A re-analysis wrote chords pointing at bars that no longer existed.
 * Live click states silently tracked editing history. Each was invisible
 * until it bit, on a stage, at volume.
 *
 * The tests added since then guard the code going FORWARD. This module asks
 * the complementary question about the DATA AT REST: does any song in this
 * project, today, carry state that the current app would lose, reject, or
 * mis-play? Read-only, evidence-based, per song, in user language.
 *
 * ## The checks
 *
 *  - decodes: the `.smap` container opens and its JSON parses at all
 *  - valid: `validateSongMap` reports no errors (catches the stale-barId class)
 *  - LOSSLESS ROUND-TRIP: parse → serialize → the same top-level content
 *    survives. A key present in the raw file but absent after a round trip is
 *    data the app is ABOUT to lose — the whitelist class, detected live
 *  - playable: an analysed song derives a playback plan (the click guarantee)
 *  - cue links: performer-linked cue tracks point at performers that exist
 */
import { smapRawJsonText } from '$lib/songmap/smapFile'
import { parseSongMap } from '$lib/songmap/parse'
import { serializeSongMap } from '$lib/songmap/serialize'
import { validateSongMap } from '$lib/songmap/validate'
import { songPlaybackPlan } from '$lib/songmap/playbackPlan'
import type { Performer } from '$lib/project/types'
import type { SongMap } from '$lib/songmap/types'

export type HealthSeverity = 'broken' | 'warning' | 'info'

export type HealthFinding = {
  severity: HealthSeverity
  /** Stable machine code, for grouping. */
  code:
    | 'unreadable'
    | 'invalid'
    | 'lossy-load'
    | 'no-plan'
    | 'suspect-start-anchor'
    | 'orphan-performer-link'
    | 'validation-warning'
  /** One sentence, in the words of the thing that is wrong. */
  message: string
}

export type SongHealth = {
  folder: string
  title: string
  findings: HealthFinding[]
}

/**
 * Keys the round-trip check ignores: serialization DELIBERATELY rewrites or
 * drops these (legacy blocks migrated on read, the version stamp). Everything
 * else that goes missing is a real loss.
 */
const EXPECTED_DROPPED_KEYS = new Set(['cues', 'cueTrackExport', 'clickTrackExport', 'formatVersion'])

/**
 * The pure per-song check. Takes the raw `.smap` JSON text so it can compare
 * what is IN THE FILE against what survives a load — the loss detector cannot
 * work from an already-parsed map, because the parse is the thing being tested.
 */
export function checkSongMapHealth(
  rawJson: string,
  opts: { performers?: readonly Performer[]; title?: string } = {},
): HealthFinding[] {
  const findings: HealthFinding[] = []

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(rawJson) as Record<string, unknown>
  } catch (e) {
    return [
      {
        severity: 'broken',
        code: 'unreadable',
        message: `The song file is not readable JSON: ${e instanceof Error ? e.message : 'parse error'}.`,
      },
    ]
  }

  let sm: SongMap
  try {
    // validate: false — validation runs separately below so the FULL error
    // list is reported, not the first error as a thrown parse failure.
    sm = parseSongMap(rawJson, { validate: false })
  } catch (e) {
    return [
      {
        severity: 'broken',
        code: 'unreadable',
        message: `The song cannot be loaded: ${e instanceof Error ? e.message : 'unknown parse failure'}.`,
      },
    ]
  }

  // ── Lossless load: what is in the file must survive parse → serialize ──
  try {
    const rebuilt = JSON.parse(serializeSongMap(sm)) as Record<string, unknown>
    for (const key of Object.keys(raw)) {
      if (EXPECTED_DROPPED_KEYS.has(key)) continue
      if (!(key in rebuilt)) {
        findings.push({
          severity: 'broken',
          code: 'lossy-load',
          message: `The file carries “${key}” but the app drops it on load — saving this song would silently delete it. This is the bug class that once ate performer links; report it.`,
        })
      }
    }
    // One level deeper for the two structures the whitelist class has bitten:
    // cue tracks and their per-field survival.
    const rawTracks = Array.isArray(raw.cueTracks) ? (raw.cueTracks as Record<string, unknown>[]) : []
    const rebuiltTracks = Array.isArray(rebuilt.cueTracks)
      ? (rebuilt.cueTracks as Record<string, unknown>[])
      : []
    for (let i = 0; i < rawTracks.length; i++) {
      const rawKeys = Object.keys(rawTracks[i] ?? {})
      const gotKeys = new Set(Object.keys(rebuiltTracks[i] ?? {}))
      for (const k of rawKeys) {
        if (k === 'renderExport') continue // legitimately cleared by regeneration
        if (!gotKeys.has(k)) {
          findings.push({
            severity: 'broken',
            code: 'lossy-load',
            message: `Cue track ${i + 1} carries “${k}” that a load would drop.`,
          })
        }
      }
    }
  } catch {
    /* serialization failing is caught by validity below */
  }

  // ── Structural validity (the stale-barId class) ──
  const v = validateSongMap(sm)
  for (const err of v.errors.slice(0, 5)) {
    findings.push({ severity: 'broken', code: 'invalid', message: err })
  }
  if (v.errors.length > 5) {
    findings.push({
      severity: 'broken',
      code: 'invalid',
      message: `…and ${v.errors.length - 5} more errors of the same kind.`,
    })
  }
  for (const warn of v.warnings.slice(0, 3)) {
    findings.push({ severity: 'warning', code: 'validation-warning', message: warn })
  }

  // ── The click guarantee: analysed songs must derive a plan ──
  if (sm.timeline.beats.length > 0 && !songPlaybackPlan(sm)) {
    findings.push({
      severity: 'broken',
      code: 'no-plan',
      message:
        'This song is analysed but no playback timing can be derived — click and live playback will not work. Usually a broken audio trim.',
    })
  }

  // ── Duplicated grid: a re-analysis APPENDED instead of replacing ──
  // Found on a real song: 494 bars where bar 248 restarts at index 0 and
  // 1.57 s — TWO full grids concatenated. Every beat clicks twice, offset by
  // a second-and-a-half, and chords anchor to both copies. The old check saw
  // only "bar index not strictly increasing" (a warning); this names it.
  {
    const bars = sm.timeline.bars
    let resets = 0
    for (let i = 1; i < bars.length; i++) {
      if ((bars[i]?.index ?? 0) < (bars[i - 1]?.index ?? 0)) resets++
    }
    if (resets > 0) {
      findings.push({
        severity: 'broken',
        code: 'invalid',
        message: `The beat grid restarts ${resets === 1 ? 'once' : `${resets} times`} mid-song — two analyses are stacked in one file, so every beat clicks twice. Repairable: the duplicate copy can be removed without touching your edits.`,
      })
    }
  }

  // ── The song-start anchor: count-in and EVERY click begin there ──
  // Found live, the hard way: one song's anchor sat at 70% (2:51 in), so its
  // click track was silent for the first three minutes — reported as "no
  // clicks", passed every structural check, and cost a band its trust. The
  // anchor is valid data; an anchor DEEP in the song is almost never intended.
  if (sm.startBeatId && sm.timeline.beats.length > 0) {
    const anchor = sm.timeline.beats.find((b) => b.id === sm.startBeatId)
    const trim = sm.audio?.trim
    if (!anchor) {
      findings.push({
        severity: 'broken',
        code: 'suspect-start-anchor',
        message:
          'The song start points at a beat that no longer exists — count-in and clicks fall back to the first beat, but this should be re-set in the grid.',
      })
    } else if (trim && trim.endSec > trim.startSec) {
      const frac = (anchor.timeSec - trim.startSec) / (trim.endSec - trim.startSec)
      if (frac > 0.25) {
        const min = Math.floor(anchor.timeSec / 60)
        const sec = Math.round(anchor.timeSec % 60)
        findings.push({
          severity: 'warning',
          code: 'suspect-start-anchor',
          message: `The song start is set ${Math.round(frac * 100)}% into the song (${min}:${String(sec).padStart(2, '0')}) — the count-in and every click begin THERE, not at the top. If that is not intended, move the song start to the first beat in the grid.`,
        })
      }
    }
  }

  // ── Cue → performer links point at people who exist ──
  const roster = new Set((opts.performers ?? []).map((p) => p.id))
  for (const track of sm.cueTracks) {
    if (track.performerId && !roster.has(track.performerId)) {
      findings.push({
        severity: 'warning',
        code: 'orphan-performer-link',
        message: `Cue track “${track.name}” is linked to a performer who is no longer in the project.`,
      })
    }
  }

  return findings
}

export type ProjectHealthReport = {
  checkedSongs: number
  healthySongs: number
  songs: SongHealth[] // only songs WITH findings
  /** Songs that could not even be read from disk. */
  unreadableFolders: string[]
}

/**
 * Walk every song file and report. READ-ONLY by construction: this module
 * imports no writer, so a health check structurally cannot "fix" anything —
 * repair is a separate, deliberate act after a person has read the findings.
 */
export async function runProjectHealthCheck(deps: {
  songs: readonly { folder: string; hidden?: boolean }[]
  performers: readonly Performer[]
  readSong: (folder: string) => Promise<{ ok: true; bytes: ArrayBuffer | Uint8Array } | { ok: false }>
}): Promise<ProjectHealthReport> {
  const report: ProjectHealthReport = { checkedSongs: 0, healthySongs: 0, songs: [], unreadableFolders: [] }
  for (const entry of deps.songs) {
    if (entry.hidden) continue
    const r = await deps.readSong(entry.folder)
    if (!r.ok) {
      report.unreadableFolders.push(entry.folder)
      continue
    }
    report.checkedSongs++
    let rawJson: string
    try {
      // RAW text from the container — decodeSmapFile would hand back the
      // ALREADY-PARSED project, blinding the loss detector to exactly the
      // losses it exists to find.
      rawJson = smapRawJsonText(new Uint8Array(r.bytes))
    } catch {
      report.songs.push({
        folder: entry.folder,
        title: entry.folder,
        findings: [
          { severity: 'broken', code: 'unreadable', message: 'The .smap container cannot be opened.' },
        ],
      })
      continue
    }
    // The container wraps { songMap }. The title comes from the file itself —
    // the manifest does not carry titles.
    let songJson = rawJson
    let title = entry.folder
    try {
      const proj = JSON.parse(rawJson) as { songMap?: { metadata?: { title?: string } } }
      if (proj.songMap) {
        songJson = JSON.stringify(proj.songMap)
        if (proj.songMap.metadata?.title) title = proj.songMap.metadata.title
      }
    } catch {
      /* checked below as unreadable */
    }
    const findings = checkSongMapHealth(songJson, { performers: deps.performers, title })
    if (findings.length === 0) report.healthySongs++
    else report.songs.push({ folder: entry.folder, title, findings })
  }
  return report
}
