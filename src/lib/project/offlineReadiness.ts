/**
 * "Can I play this set with no internet?"
 *
 * The question people actually ask before leaving for a venue, answered as a
 * list rather than a feeling. Pure: it decides WHAT a song needs on disk; the
 * caller checks whether those files are there.
 *
 * ## What counts as required
 *
 * Only what makes a song *playable*. Offline the app can still render clicks,
 * cue speech and the generated band locally, so a missing cue WAV is a warning,
 * not a blocker. Audio it cannot conjure — a song with no reachable audio is
 * simply silent, and finding that out on stage is the failure this exists to
 * prevent.
 *
 * A song is playable with EITHER the original file OR a usable set of stems.
 * Both is better (the mixer prefers stems); either is enough.
 */
import type { SongMap } from '$lib/songmap/types'

export type AssetKind = 'original' | 'stem' | 'cue' | 'click' | 'generated'

export type RequiredAsset = {
  /** Path relative to the SONG folder, as stored in the `.smap`. */
  subpath: string
  kind: AssetKind
  /** A human name for the report, e.g. "Drums" or "Original audio". */
  label: string
  /**
   * False for things the app can regenerate locally (clicks, cue speech, the
   * generated band). Their absence is worth showing but does not stop a show.
   */
  required: boolean
}

export type AssetStatus = RequiredAsset & { present: boolean }

export type SongReadiness = {
  songId: string
  title: string
  assets: AssetStatus[]
  /** Enough audio to make sound. */
  playable: boolean
  /** Playable, and nothing at all is missing. */
  complete: boolean
  /** One sentence for the report — the reason, when it is not playable. */
  summary: string
}

/** Everything this song references on disk, whether or not it is essential. */
export function requiredAssetsForSong(sm: SongMap): RequiredAsset[] {
  const out: RequiredAsset[] = []

  const original = sm.audio?.fileName
  if (original) {
    out.push({ subpath: original, kind: 'original', label: 'Original audio', required: true })
  }

  for (const [name, path] of Object.entries(sm.stemRefs ?? {})) {
    if (typeof path === 'string' && path) {
      out.push({ subpath: path, kind: 'stem', label: `${name} stem`, required: true })
    }
  }

  for (const track of sm.cueTracks ?? []) {
    const rel = track.renderExport?.relativePath
    if (rel) {
      out.push({
        subpath: rel,
        kind: 'cue',
        label: `Cue track${track.name ? ` (${track.name})` : ''}`,
        required: false, // re-renderable locally, TTS included
      })
    }
  }

  const click = sm.clickExport?.relativePath
  if (click) out.push({ subpath: click, kind: 'click', label: 'Click track', required: false })

  for (const [field, label] of [
    ['drumMidi', 'BarBro Drums'],
    ['bassMidi', 'BarBro Bass'],
  ] as const) {
    const rel = (sm as Record<string, unknown>)[field] as
      | { renderExport?: { relativePath?: string } }
      | undefined
    const path = rel?.renderExport?.relativePath
    if (path) out.push({ subpath: path, kind: 'generated', label, required: false })
  }

  return out
}

/**
 * Turn presence facts into a verdict.
 *
 * `present` comes from the caller — this module never touches the disk, so the
 * rules stay testable without a project on hand.
 */
export function songReadiness(
  songId: string,
  sm: SongMap,
  present: (asset: RequiredAsset) => boolean,
): SongReadiness {
  const assets: AssetStatus[] = requiredAssetsForSong(sm).map((a) => ({
    ...a,
    present: present(a),
  }))

  const originals = assets.filter((a) => a.kind === 'original')
  const stems = assets.filter((a) => a.kind === 'stem')
  const haveOriginal = originals.some((a) => a.present)
  const haveAnyStem = stems.some((a) => a.present)
  const missingStems = stems.filter((a) => !a.present)

  const playable = haveOriginal || haveAnyStem
  const complete = playable && assets.every((a) => a.present)

  let summary: string
  if (!assets.length) {
    summary = 'No audio linked to this song yet.'
  } else if (!playable) {
    summary = 'No audio on this machine — this song will be silent.'
  } else if (!haveOriginal && missingStems.length > 0) {
    summary = `Playing from stems; ${missingStems.length} stem${missingStems.length > 1 ? 's are' : ' is'} missing.`
  } else if (!complete) {
    const missing = assets.filter((a) => !a.present)
    summary = `Ready. ${missing.length} optional file${missing.length > 1 ? 's' : ''} will be regenerated as needed.`
  } else {
    summary = 'Ready.'
  }

  return { songId, title: sm.metadata?.title?.trim() || 'Untitled song', assets, playable, complete, summary }
}

export type SetReadiness = {
  songs: SongReadiness[]
  /** Every song can make sound. The bar for leaving the house. */
  ready: boolean
  /** Songs that would be silent — the list to act on. */
  blockers: SongReadiness[]
  summary: string
}

export function setReadiness(songs: SongReadiness[]): SetReadiness {
  const blockers = songs.filter((s) => !s.playable)
  const ready = songs.length > 0 && blockers.length === 0
  const incomplete = songs.filter((s) => s.playable && !s.complete).length
  let summary: string
  if (songs.length === 0) summary = 'No songs in this project.'
  else if (blockers.length > 0) {
    summary = `${blockers.length} of ${songs.length} song${songs.length > 1 ? 's' : ''} would be silent offline.`
  } else if (incomplete > 0) {
    summary = `All ${songs.length} playable offline. ${incomplete} will regenerate some files on load.`
  } else {
    summary = `All ${songs.length} song${songs.length > 1 ? 's' : ''} ready offline.`
  }
  return { songs, ready, blockers, summary }
}
