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
 *  - `projectFolder`              — display hint scoped to the local disk
 *  - `cueTrackExport.relativePath`,
 *    `clickTrackExport.relativePath` — local render outputs (the
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
import type { SongMap, CueTrackExport, ClickTrackExport } from './types'

/** Local-only top-level field names — never written to the cloud. */
const LOCAL_ONLY_TOP_LEVEL = [
  'projectFolder',
  'stemRefs',
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
function stripExport<T extends CueTrackExport | ClickTrackExport>(
  exp: T | undefined,
): T | undefined {
  if (!exp) return undefined
  const { relativePath: _relativePath, ...rest } = exp
  return rest as T
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

  out.cueTrackExport = stripExport(sm.cueTrackExport)
  out.clickTrackExport = stripExport(sm.clickTrackExport)

  return out
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
  if (merged.cueTrackExport && local.cueTrackExport?.relativePath) {
    merged.cueTrackExport = {
      ...merged.cueTrackExport,
      relativePath: local.cueTrackExport.relativePath,
    }
  }
  if (merged.clickTrackExport && local.clickTrackExport?.relativePath) {
    merged.clickTrackExport = {
      ...merged.clickTrackExport,
      relativePath: local.clickTrackExport.relativePath,
    }
  }

  return merged
}
