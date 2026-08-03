/**
 * "Your kit" — the user's own drum one-shots, read from the PROJECT folder
 * (project-level, not per-song: one band, one gig, one kit).
 *
 * Contract: `<project>/kits/drums/{kick,snare,hihat,tom,cymbal}.wav`.
 * Any audio the browser can decode works (WAV/MP3 bytes; the file name
 * decides the voice). Missing voices fall back to built-in sounds inside
 * `buildCustomKit`, so a partial kit still plays complete.
 *
 * Loaded through the sidecar's project file reader — the samples never
 * leave the user's machine and are never bundled with the app.
 */
import { buildCustomKit, decodeToKitVoice, type DrumKit } from '$lib/audio/drumKits'
import { readProjectSongAsset } from './desktopProjectFs'
import type { DrumClass } from '$lib/songmap/types'

export const PROJECT_DRUM_KIT_DIR = 'kits/drums'

const CLASSES: DrumClass[] = ['kick', 'snare', 'hihat', 'tom', 'cymbal', 'ride']

export type ProjectDrumKit = {
  kit: DrumKit
  /** Voices that actually came from the user's files (for the honesty line). */
  found: DrumClass[]
}

const cache = new Map<string, Promise<ProjectDrumKit | null>>()

/** Forget cached kits — call after the user changed files on disk. */
export function clearProjectDrumKitCache(): void {
  cache.clear()
}

/**
 * Load the project kit, or null when no sample files exist at all.
 * Results are cached per project path; `fresh: true` re-reads from disk.
 */
export function loadProjectDrumKit(
  projectPath: string,
  opts: { fresh?: boolean } = {},
): Promise<ProjectDrumKit | null> {
  if (opts.fresh) cache.delete(projectPath)
  const cached = cache.get(projectPath)
  if (cached) return cached
  const p = (async (): Promise<ProjectDrumKit | null> => {
    const samples: Partial<Record<DrumClass, Float32Array>> = {}
    const found: DrumClass[] = []
    await Promise.all(
      CLASSES.map(async (cls) => {
        const r = await readProjectSongAsset(projectPath, PROJECT_DRUM_KIT_DIR, `${cls}.wav`)
        if (!r.ok) return
        const voice = await decodeToKitVoice(await r.blob.arrayBuffer())
        if (voice && voice.length > 0) {
          samples[cls] = voice
          found.push(cls)
        }
      }),
    )
    if (found.length === 0) return null
    return { kit: buildCustomKit(samples), found }
  })()
  cache.set(projectPath, p)
  return p
}
