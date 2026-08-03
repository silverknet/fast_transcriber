/**
 * Collaboration strip / merge primitives.
 *
 * The cloud project mirrors the COLLABORATIVE subset of a local SongMap.
 * Local-only fields (file paths, render outputs, cached analysis hints,
 * per-user mix) never leave the device.
 *
 * Single source of truth for what's collaborative vs local. Phase 4
 * wires these into the cloud push (`toCollabSongMap`) and pull
 * (`mergeLocalIntoCollab`) paths; the rules live here so the diff is
 * never accidentally redefined in a sync handler.
 *
 * Decision rationale (per the roadmap in
 * /Users/martin/.claude/plans/write-the-more-long-snoopy-crown.md):
 *
 *  - `audio.originalPath`         — local path (per-machine)
 *  - `stemRefs`                   — local paths (per-machine)
 *  - `liveStemRefs`               — stable stem id -> local path (per-machine)
 *  - `projectFolder`              — display hint scoped to the local disk
 *  - `cueTracks[].renderExport.relativePath`,
 *    `clickExport.relativePath` — local render outputs (the
 *    `fingerprint/durationSec/sampleRate/preludeOffsetSec` fields next
 *    to them DO sync — that's how another device knows the render is
 *    still valid for its local audio)
 *  - `sectionBorderHints`,
 *    `chordHints`                 — local analysis cache (each device
 *    re-derives from its own audio)
 *  - `mixState`                   — per-user DAW mix (Cubase-style),
 *    explicitly locked-in as local-only
 *
 * Everything else syncs.
 */
import type { CueTrack, RenderedCueExport, SongMap } from './types'

/** Local-only top-level field names — never written to the cloud. */
const LOCAL_ONLY_TOP_LEVEL = [
  'projectFolder',
  'stemRefs',
  'liveStemRefs',
  'sectionBorderHints',
  'chordHints',
  'mixState',
] as const

/**
 * Strip a CueTrackExport / ClickTrackExport down to the collaborative
 * subset: the rendered file's `relativePath` is local-only (different
 * device = different disk), but the rest (fingerprint, duration,
 * sampleRate, preludeOffsetSec, generatedAt) describes the render's
 * validity and SHOULD sync — that's what lets a fresh device decide
 * "no, this render doesn't match my current audio, regenerate".
 */
function stripExport<T extends RenderedCueExport>(
  exp: T | undefined,
): T | undefined {
  if (!exp) return undefined
  const { relativePath: _relativePath, ...rest } = exp
  return rest as T
}

function stripCueTrackLocalRender(track: CueTrack): CueTrack {
  if (!track.renderExport) return track
  return {
    ...track,
    renderExport: stripExport(track.renderExport),
  }
}

/**
 * Project a local SongMap into its collaborative shape for upload.
 * Always returns a new object — never mutates `sm`. Safe to JSON.stringify
 * the result and POST.
 */
export function toCollabSongMap(sm: SongMap): SongMap {
  // Shallow clone, then null out the local-only top-level fields.
  const out: SongMap = { ...sm }
  for (const key of LOCAL_ONLY_TOP_LEVEL) {
    delete (out as Record<string, unknown>)[key]
  }

  // `audio.originalPath` is local; the rest of AudioReference (identity
  // fields like sha256, durationSec, sampleRate, channels, fileSize,
  // fileName, mimeType, trim, source) is collaborative — that's the
  // cloud's claim about which file belongs here.
  if (sm.audio) {
    const { originalPath: _originalPath, ...audioRest } = sm.audio
    out.audio = audioRest
  }

  // `sm.cueTracks` is non-optional on the type, but this is a defensive
  // BACKSTOP: cloud sync should migrate raw `song_map` rows to current
  // shape first (`normalizeCloudSongMap` in `client/cloudSync.ts`), yet a
  // legacy `formatVersion: 1` map has no `cueTracks` at all, and this must
  // not crash if it's ever reached without that normalization. Tolerate
  // the missing field rather than throwing a cryptic TypeError.
  out.cueTracks = (sm.cueTracks ?? []).map(stripCueTrackLocalRender)
  out.clickExport = stripExport(sm.clickExport)
  if (sm.drumMidi) {
    out.drumMidi = { ...sm.drumMidi, renderExport: stripExport(sm.drumMidi.renderExport) }
  }
  if (sm.bassMidi) {
    out.bassMidi = { ...sm.bassMidi, renderExport: stripExport(sm.bassMidi.renderExport) }
  }
  if (sm.drumMachine) {
    out.drumMachine = {
      ...sm.drumMachine,
      renderExport: stripExport(sm.drumMachine.renderExport),
    }
  }
  if (sm.bassMachine) {
    out.bassMachine = {
      ...sm.bassMachine,
      renderExport: stripExport(sm.bassMachine.renderExport),
    }
  }

  return out
}

/**
 * Deterministic stringify with recursively-sorted keys, mirroring JSON's
 * "omit undefined object properties" rule so two machines that built the
 * same SongMap produce byte-identical output regardless of field insertion
 * order.
 */
function stableStringify(v: unknown): string {
  if (v === undefined) return 'null'
  // Round non-integer numbers to 6 decimals so a value that survives a
  // JSON round-trip through the server (JSONB re-normalization, float repr)
  // still fingerprints identically — otherwise the sync would loop forever
  // seeing "changes" that are just re-serialization noise.
  if (typeof v === 'number') {
    return JSON.stringify(Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6)
  }
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

/**
 * Canonical equality for two shared-content values — the merge-time counterpart
 * of `collabContentFingerprint`. Uses the same `stableStringify` normalization
 * (6-decimal float rounding, `undefined`/missing-key coalescing, key sorting),
 * so a value that only differs by JSON round-trip noise from the server compares
 * EQUAL. This is what keeps the conflict merge from surfacing phantom rows for
 * chords/beats whose `startSec`/`endSec` floats were re-serialized by JSONB.
 */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function djb2Hex(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * Stable fingerprint of the MEANINGFUL shared content of a song — the thing
 * that decides "did the user actually change something worth syncing?".
 *
 * It is deliberately blind to fields that differ per-machine or per-render and
 * must never count as a conflict:
 *   - `metadata.updatedAt` (bumped on every save)
 *   - `clickExport` / per-track `renderExport` (local render artifacts; each
 *     device regenerates its own — the historical source of phantom conflicts)
 *   - everything `toCollabSongMap` already strips (local paths, mixState,
 *     analysis-hint caches)
 *
 * Two devices with the same bars/beats/chords/sections/cue-tracks/count-in
 * therefore fingerprint identically even if one just re-rendered a cue WAV.
 * Used by the autosave dirty-check (skip no-op pushes) and by 409 handling
 * (adopt/fast-forward instead of prompting) — see `projectAutosave.ts`.
 */
export function collabContentFingerprint(sm: SongMap): string {
  const c = toCollabSongMap(sm) as Record<string, unknown>
  const meta = { ...(c.metadata as Record<string, unknown>) }
  delete meta.updatedAt
  const normalized: Record<string, unknown> = { ...c, metadata: meta }
  delete normalized.clickExport
  // `expectedAudio` is a cloud-reconciliation artifact stamped onto the
  // joiner's copy, not user content — the owner's map doesn't carry it, so
  // including it would make owner and joiner fingerprints disagree forever.
  delete normalized.expectedAudio
  if (normalized.drumMidi && typeof normalized.drumMidi === 'object') {
    const { renderExport: _re, ...dmRest } = normalized.drumMidi as Record<string, unknown>
    normalized.drumMidi = dmRest
  }
  if (normalized.drumMachine && typeof normalized.drumMachine === 'object') {
    const { renderExport: _re, ...machRest } = normalized.drumMachine as Record<string, unknown>
    normalized.drumMachine = machRest
  }
  if (normalized.bassMachine && typeof normalized.bassMachine === 'object') {
    const { renderExport: _re, ...bMachRest } = normalized.bassMachine as Record<string, unknown>
    normalized.bassMachine = bMachRest
  }
  if (normalized.bassMidi && typeof normalized.bassMidi === 'object') {
    const { renderExport: _re, ...bmRest } = normalized.bassMidi as Record<string, unknown>
    normalized.bassMidi = bmRest
  }
  if (Array.isArray(normalized.cueTracks)) {
    normalized.cueTracks = (normalized.cueTracks as Array<Record<string, unknown>>).map((t) => {
      const { renderExport: _renderExport, ...rest } = t
      return rest
    })
  }
  return djb2Hex(stableStringify(normalized))
}

/**
 * Merge a cloud SongMap (from a pull) into the local SongMap, preserving
 * every local-only field. Collaborative fields take their values from
 * the cloud copy.
 *
 * Conflict resolution beyond "cloud wins for collab fields" happens in
 * Phase 8 (`collabMerge.ts`) — this function is the simpler "I trust
 * what the server sent" path used during pull / initial join.
 */
export function mergeLocalIntoCollab(local: SongMap, cloud: SongMap): SongMap {
  const merged: SongMap = { ...cloud }

  // Bring local-only top-level fields back.
  for (const key of LOCAL_ONLY_TOP_LEVEL) {
    const v = (local as Record<string, unknown>)[key]
    if (v !== undefined) {
      ;(merged as Record<string, unknown>)[key] = v
    }
  }

  // Audio: cloud carries the identity claim; local owns the path to
  // wherever that audio is on this disk (which may or may not match —
  // Phase 5 reconciliation reads `expectedAudio` and decides).
  if (cloud.audio) {
    merged.audio = {
      ...cloud.audio,
      originalPath: local.audio?.originalPath,
    }
  } else if (local.audio) {
    merged.audio = local.audio
  }

  // Render-output paths come back from the local copy if present.
  const localTrackById = new Map(local.cueTracks.map((track) => [track.id, track]))
  merged.cueTracks = merged.cueTracks.map((track) => {
    const localTrack = localTrackById.get(track.id)
    if (!track.renderExport || !localTrack?.renderExport?.relativePath) return track
    return {
      ...track,
      renderExport: {
        ...track.renderExport,
        relativePath: localTrack.renderExport.relativePath,
      },
    }
  })
  if (merged.clickExport && local.clickExport?.relativePath) {
    merged.clickExport = {
      ...merged.clickExport,
      relativePath: local.clickExport.relativePath,
    }
  }
  if (merged.drumMidi?.renderExport && local.drumMidi?.renderExport?.relativePath) {
    merged.drumMidi = {
      ...merged.drumMidi,
      renderExport: {
        ...merged.drumMidi.renderExport,
        relativePath: local.drumMidi.renderExport.relativePath,
      },
    }
  }
  if (merged.bassMidi?.renderExport && local.bassMidi?.renderExport?.relativePath) {
    merged.bassMidi = {
      ...merged.bassMidi,
      renderExport: {
        ...merged.bassMidi.renderExport,
        relativePath: local.bassMidi.renderExport.relativePath,
      },
    }
  }

  return merged
}
