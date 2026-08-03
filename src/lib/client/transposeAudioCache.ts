import {
  ensureProjectPitchShiftCache,
  readProjectSongAsset,
  type PitchShiftCacheResult,
} from './desktopProjectFs'
import { clampTransposeSemitones } from '$lib/songmap/transposition'

export type ProjectTransposeAudioBlobResult =
  | {
      ok: true
      blob: Blob
      cached: boolean
      relPath: string
      cache: Extract<PitchShiftCacheResult, { ok: true }>
    }
  | { ok: false; error: string }

/**
 * Return a tempo-preserved transposed audio blob for a local project asset.
 *
 * Semitone 0 intentionally bypasses this helper; callers should play the source
 * asset directly so reset-to-zero is instant and bit-identical.
 */
export async function readProjectTransposedAudioBlob(
  projectPath: string,
  songFolder: string,
  sourceSubpath: string,
  semitones: number,
): Promise<ProjectTransposeAudioBlobResult> {
  const n = clampTransposeSemitones(semitones)
  if (n === 0) return { ok: false, error: 'Transpose cache is only used for nonzero semitones.' }

  const cache = await ensureProjectPitchShiftCache(projectPath, songFolder, sourceSubpath, n)
  if (!cache.ok) return cache

  const asset = await readProjectSongAsset(projectPath, songFolder, cache.relPath)
  if (!asset.ok) {
    return {
      ok: false,
      error: `Could not read transposed audio cache: ${asset.error}`,
    }
  }

  return {
    ok: true,
    blob: asset.blob,
    cached: cache.cached,
    relPath: cache.relPath,
    cache,
  }
}
