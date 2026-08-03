/**
 * Fetch the active song's separated stems as blobs, for the edit-song stems
 * dock. Mirrors the stem half of `MixerView`'s track loader but WITHOUT its
 * engine / cue / click concerns — it only returns `{ key, label, blob }` so the
 * shared transport can decode + register them.
 *
 * Two sources, same as the mixer:
 *   - Studio (local project on disk): the best on-disk stem set via the sidecar.
 *   - Collab (no local folder): the compressed cloud stems (`project-audio`).
 *
 * Returns `[]` when the song has no stems — the transport then just plays the
 * original mix. Browser-only (reads stores + fetches); safe to import on the
 * server since nothing runs until it's called.
 */
import { get } from 'svelte/store'
import { project as projectStore } from '$lib/stores/project'
import { selectBestStemSet } from '$lib/project/commit'
import { readProjectSongAsset } from '$lib/client/desktopProjectFs'

export type StemBlob = { key: string; label: string; blob: Blob }

/** Pretty label for a stem filename — Vocals/Drums/Bass/Other/etc. */
function labelForStem(name: string): string {
  const m: Record<string, string> = {
    'vocals.wav': 'Vocals',
    'drums.wav': 'Drums',
    'bass.wav': 'Bass',
    'other.wav': 'Other',
    'guitar.wav': 'Guitar',
    'fx.wav': 'FX',
  }
  const key = name.toLowerCase()
  return m[key] ?? name.replace(/\.[^.]+$/, '').replace(/^\w/, (c) => c.toUpperCase())
}

/** The ACTIVE song's stems. */
export async function loadSongStemBlobs(): Promise<StemBlob[]> {
  const ps = get(projectStore)
  return loadSongStemBlobsFor({ osPath: ps.osPath, folder: ps.activeSongFolder, songId: ps.activeSongId })
}

/**
 * A GIVEN song's stems as blobs — by folder (disk) or songId (cloud) — so the
 * live prefetcher can warm an UPCOMING song without activating it. Studio stems
 * (disk) come from that folder's best stem set; collab stems come from the
 * cloud copy (already IndexedDB-cached by `fetchCloudAudioBlob`). Returns `[]`
 * for a song with no stems.
 */
export async function loadSongStemBlobsFor(
  target: {
    osPath: string | null
    folder: string | null
    songId: string | null
  },
  opts: {
    /**
     * Also fetch the ORIGINAL full mix (`key: 'original'`). Opt-in: the
     * prefetcher wants it — a "ready" song used to re-decode its biggest file
     * on switch because only stems were warmed — but other callers (vocals
     * import, cloud byte warm-up) genuinely mean stems.
     */
    includeOriginal?: boolean
  } = {},
): Promise<StemBlob[]> {
  const out: StemBlob[] = []

  // ── Studio: highest-quality stem set on disk (via the sidecar) ──
  if (target.osPath && target.folder) {
    const folderMeta = get(projectStore).metadataByFolder[target.folder]
    const best = selectBestStemSet(folderMeta)
    if (best) {
      for (const filename of best.files) {
        const subpath = `${best.pathPrefix}${filename}`
        const r = await readProjectSongAsset(target.osPath, target.folder, subpath).catch(() => null)
        if (r?.ok) out.push({ key: `stem:${filename}`, label: labelForStem(filename), blob: r.blob })
      }
    }
    if (opts.includeOriginal && folderMeta?.audioSubpath) {
      const r = await readProjectSongAsset(target.osPath, target.folder, folderMeta.audioSubpath).catch(
        () => null,
      )
      if (r?.ok) out.push({ key: 'original', label: 'Original', blob: r.blob })
    }
    return out
  }

  // ── Collab: compressed cloud stems (no local folder) ──
  if (target.songId) {
    const songId = target.songId
    const { getBrowserCloudAudio } = await import('$lib/client/browserCloudProject')
    const ca = getBrowserCloudAudio(songId)
    if (ca?.stems && Object.keys(ca.stems).length > 0) {
      const { fetchCloudAudioBlob, cloudAudioCacheKey } = await import('$lib/client/cloudAudio')
      const { desktopCompanionStatus } = await import('$lib/stores/desktopCompanionStatus')
      const reachable = get(desktopCompanionStatus).reachable
      for (const [stemName, obj] of Object.entries(ca.stems)) {
        const blob = await fetchCloudAudioBlob({
          sidecarReachable: reachable,
          localProjectPresent: false,
          path: obj.path,
          cacheKey: cloudAudioCacheKey({ songId, sourceSha256: ca.sourceSha256, kind: `stem:${stemName}` }),
        }).catch(() => null)
        if (blob) out.push({ key: `stem:${stemName}`, label: labelForStem(stemName), blob })
      }
    }
  }

  return out
}
