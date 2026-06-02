/**
 * Project setlist .als export orchestrator.
 *
 * Pipeline:
 *   1. For each exportable song: load song.smap → compute timings →
 *      resolve stem paths → render the song-aligned click WAV.
 *   2. Batch-query the sidecar for WAV durations/sizes/sample-rates.
 *   3. Build `ProjectSongExportInput` per song using the resolved play
 *      ranges (delegated to `timings.ts`).
 *   4. Mark the project root as an Ableton Project folder.
 *   5. Generate the .als XML, gzip, write at project root.
 *
 * Cue tracks are NOT included in V1. The architecture leaves room for
 * them: every song's `SongTimings` already has a `preRollSec` field,
 * which will gate the future cue track's leading speech window when
 * we add it.
 */

import {
  generateAbletonProjectSetXml,
  STEM_TRACKS,
  type ProjectSongExportInput,
  type StemClip,
} from '$lib/export/abletonSet'
import { gzipString } from '$lib/export/gzip'
import {
  getProjectWavInfoBatch,
  readProjectSong,
  transcodeProjectAudioToWav,
  writeProjectAsset,
  writeProjectSongAsset,
  type ProjectWavInfo,
} from '$lib/client/desktopProjectFs'
import { selectBestStemSet } from '$lib/project/commit'
import { getExportableSongs } from '$lib/project/types'
import type { ProjectFile, ProjectSongEntry } from '$lib/project/types'
import type { ProjectSongMetadataLite } from '$lib/stores/project'
import { readSmapJsonOnly } from '$lib/songmap/persist'
import type { SongMap } from '$lib/songmap/types'
import { clickPlayRange, songTimings, stemPlayRange, type SongTimings } from './timings'
import { renderClickTrackBlob, CLICK_TRACK_SUBPATH } from './clickRender'

export { CLICK_TRACK_SUBPATH } from './clickRender'

export type SetlistExportResult =
  | { ok: true; subpath: string; xmlBytes: number; alsBytes: number }
  | { ok: false; error: string }

export type SetlistExportArgs = {
  projectPath: string
  project: ProjectFile
  metadataByFolder: Record<string, ProjectSongMetadataLite | undefined>
  /** Filename to write at the project root, e.g. `"MyProject.als"`. */
  filename: string
}

/**
 * Build + gzip + write the project setlist .als. Always re-renders the
 * setlist click WAV for every song (sub-second cost; eliminates a whole
 * class of staleness bugs).
 */
export async function exportProjectSetAls(args: SetlistExportArgs): Promise<SetlistExportResult> {
  const { projectPath, project, metadataByFolder, filename } = args

  const exportable = getExportableSongs(project)
  if (exportable.length === 0) {
    return { ok: false, error: 'No songs to export (project has none, or all are hidden).' }
  }

  // -- Phase 1: plan + render clicks --------------------------------------
  type Planned = {
    entry: ProjectSongEntry
    meta: ProjectSongMetadataLite
    sm: SongMap
    timings: SongTimings
    /** stem-track-name → song-folder-relative subpath. */
    stemSubpaths: Map<string, string>
    /** `preludeSec + prependSec` of the rendered click WAV. */
    clickPreludeOffsetSec: number
  }
  const planned: Planned[] = []
  const wavRequests: Array<{ songFolder: string; subpath: string }> = []

  for (const entry of exportable) {
    const meta = metadataByFolder[entry.folder]
    if (!meta) {
      return { ok: false, error: `Missing metadata for "${entry.folder}". Refresh the project.` }
    }
    const sm = await loadSongMap(projectPath, entry, meta.title)
    if ('error' in sm) return { ok: false, error: sm.error }

    const timings = (() => {
      try {
        return songTimings(sm.songMap)
      } catch (e) {
        return { error: `Could not compute timings for "${meta.title}": ${msg(e)}` }
      }
    })()
    if ('error' in timings) return { ok: false, error: timings.error }

    const stemSubpaths = resolveStemSubpaths(meta)
    if (stemSubpaths.size === 0) {
      return { ok: false, error: `"${meta.title}" has no stems on disk. Split stems first.` }
    }
    // Transcode any MP3 stems to WAV (sample-accurate, no encoder priming).
    // ffmpeg runs in the sidecar; result is cached by mtime, so repeated
    // exports are cheap.
    for (const [trackName, sub] of stemSubpaths) {
      if (!sub.toLowerCase().endsWith('.mp3')) continue
      const wavSub = sub.replace(/\.mp3$/i, '.wav')
      const tres = await transcodeProjectAudioToWav(projectPath, entry.folder, sub, wavSub)
      if (!tres.ok) {
        return {
          ok: false,
          error: `Could not transcode ${sub} for "${meta.title}": ${tres.error}`,
        }
      }
      stemSubpaths.set(trackName, wavSub)
    }
    for (const sub of stemSubpaths.values()) {
      wavRequests.push({ songFolder: entry.folder, subpath: sub })
    }

    // Always re-render the click — derived state, cheap (~1 s/song) and
    // eliminates a whole class of staleness bugs. Same render as the mixer
    // uses (`cue/click-track.wav`), so the two stay in lockstep by design.
    const clickRes = await renderAndWriteClick(projectPath, entry.folder, sm.songMap, meta.title)
    if ('error' in clickRes) return { ok: false, error: clickRes.error }
    wavRequests.push({ songFolder: entry.folder, subpath: CLICK_TRACK_SUBPATH })

    planned.push({
      entry,
      meta,
      sm: sm.songMap,
      timings,
      stemSubpaths,
      clickPreludeOffsetSec: clickRes.preludeOffsetSec,
    })
  }

  // -- Phase 2: batch fetch WAV info from disk ---------------------------
  const batchRes = await getProjectWavInfoBatch(projectPath, wavRequests)
  if (!batchRes.ok) return { ok: false, error: batchRes.error }
  const infoByKey = new Map<string, ProjectWavInfo>()
  for (const item of batchRes.items) {
    infoByKey.set(`${item.songFolder}::${item.subpath}`, item)
  }
  const lookup = (songFolder: string, subpath: string) =>
    infoByKey.get(`${songFolder}::${subpath}`)

  // -- Phase 3: build the per-song export model -------------------------
  const songs: ProjectSongExportInput[] = []
  for (const p of planned) {
    // The BarBro mixer stores per-song volume / mute keyed by:
    //   - "stem:<basename>"  for stem WAVs (basename of the on-disk file)
    //   - "click"            for the click WAV
    // We pass the user's mix straight through as per-clip SampleVolume in
    // the .als so the exported scene plays exactly what they were hearing.
    const mixByKey = new Map(
      (p.sm.mixState?.tracks ?? []).map((t) => [t.key, t]),
    )

    const stems = new Map<string, StemClip>()
    for (const [trackName, sub] of p.stemSubpaths) {
      const info = lookup(p.entry.folder, sub)
      if (!info || 'error' in info) {
        return {
          ok: false,
          error: `Missing WAV info for ${p.entry.folder}/${sub}: ${info && 'error' in info ? info.error : 'not found'}`,
        }
      }
      const range = stemPlayRange(p.timings, info.durationSec)
      const mix = mixByKey.get(`stem:${basename(sub)}`)
      stems.set(trackName, {
        fileName: basename(sub),
        relativePath: `${p.entry.folder}/${sub}`,
        absolutePath: `${projectPath}/${p.entry.folder}/${sub}`,
        durationSec: info.durationSec,
        sampleRate: info.sampleRate,
        fileSize: info.fileSize,
        playStartSec: range.playStartSec,
        playEndSec: range.playEndSec,
        volume: mix?.volume,
        muted: mix?.muted,
      })
    }

    const clickInfo = lookup(p.entry.folder, CLICK_TRACK_SUBPATH)
    if (!clickInfo || 'error' in clickInfo) {
      return {
        ok: false,
        error: `Missing WAV info for ${p.entry.folder}/${CLICK_TRACK_SUBPATH}`,
      }
    }
    const clickRange = clickPlayRange(p.timings, clickInfo.durationSec, p.clickPreludeOffsetSec)
    const clickMix = mixByKey.get('click')
    const click: StemClip = {
      fileName: basename(CLICK_TRACK_SUBPATH),
      relativePath: `${p.entry.folder}/${CLICK_TRACK_SUBPATH}`,
      absolutePath: `${projectPath}/${p.entry.folder}/${CLICK_TRACK_SUBPATH}`,
      durationSec: clickInfo.durationSec,
      sampleRate: clickInfo.sampleRate,
      fileSize: clickInfo.fileSize,
      playStartSec: clickRange.playStartSec,
      playEndSec: clickRange.playEndSec,
      volume: clickMix?.volume,
      muted: clickMix?.muted,
    }

    songs.push({
      title: p.meta.title,
      bpm: p.timings.bpm,
      stems,
      click,
    })
  }

  // -- Phase 4: mark project folder + write .als ------------------------
  const markerRes = await writeProjectAsset(
    projectPath,
    'Ableton Project Info/.barbro-marker',
    new TextEncoder().encode('BarBro Ableton project marker\n'),
  )
  if (!markerRes.ok) {
    return { ok: false, error: `Could not create Ableton Project Info marker: ${markerRes.error}` }
  }

  const xml = generateAbletonProjectSetXml({ projectTitle: project.name, songs })
  const blob = await gzipString(xml)
  const buf = new Uint8Array(await blob.arrayBuffer())
  const writeRes = await writeProjectAsset(projectPath, filename, buf)
  if (!writeRes.ok) return { ok: false, error: writeRes.error }
  return { ok: true, subpath: filename, xmlBytes: xml.length, alsBytes: buf.byteLength }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadSongMap(
  projectPath: string,
  entry: ProjectSongEntry,
  title: string,
): Promise<{ songMap: SongMap } | { error: string }> {
  const res = await readProjectSong(projectPath, entry.folder)
  if (!res.ok) return { error: `Could not read song.smap for "${title}": ${res.error}` }
  try {
    const blob = new Blob([new Uint8Array(res.bytes).buffer as ArrayBuffer])
    const parsed = await readSmapJsonOnly(blob)
    return { songMap: parsed.songMap }
  } catch (e) {
    return { error: `Could not parse song.smap for "${title}": ${msg(e)}` }
  }
}

async function renderAndWriteClick(
  projectPath: string,
  songFolder: string,
  sm: SongMap,
  title: string,
): Promise<{ ok: true; preludeOffsetSec: number } | { error: string }> {
  let blob: Blob
  let preludeOffsetSec: number
  try {
    const result = await renderClickTrackBlob(sm)
    blob = result.blob
    preludeOffsetSec = result.preludeOffsetSec
  } catch (e) {
    return { error: `Could not render click track for "${title}": ${msg(e)}` }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const writeRes = await writeProjectSongAsset(projectPath, songFolder, CLICK_TRACK_SUBPATH, bytes)
  if (!writeRes.ok) {
    return { error: `Could not write click track for "${title}": ${writeRes.error}` }
  }
  return { ok: true, preludeOffsetSec }
}

/** Map a song's stemRefs (or scanned stem files) into track-name → subpath. */
function resolveStemSubpaths(meta: ProjectSongMetadataLite): Map<string, string> {
  const out = new Map<string, string>()
  const stemRefs = meta.stemRefs ?? {}
  for (const track of STEM_TRACKS) {
    const sub = stemRefs[track.name]
    if (sub) out.set(track.name, sub)
  }
  if (out.size > 0) return out

  // Fall back to scanning the highest-quality stem set on disk and
  // mapping canonical filenames (drums.wav, vocals.wav, …) to slots.
  const best = selectBestStemSet(meta)
  if (!best) return out
  for (const fname of best.files) {
    const slot = stemNameFromFilename(fname)
    if (!slot || out.has(slot)) continue
    out.set(slot, `${best.pathPrefix}${fname}`)
  }
  return out
}

function stemNameFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase()
  const map: Record<string, string> = {
    drums: 'Drums',
    bass: 'Bass',
    vocals: 'Vocals',
    guitar: 'Guitar',
    other: 'Guitar', // Demucs 4-stem: "other" is melodic/harmonic
    fx: 'FX',
  }
  return map[base] ?? null
}

function basename(p: string): string {
  const ix = p.lastIndexOf('/')
  return ix === -1 ? p : p.slice(ix + 1)
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
