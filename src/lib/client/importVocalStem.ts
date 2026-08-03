/**
 * Import a vocal stem from an uploaded with-vocals recording of a song whose
 * BarBro copy is instrumental (empty vocal stem). Studio mode only — it needs
 * the sidecar for alignment, separation and the file I/O.
 *
 * Pipeline (each step is a verified primitive; see align_audio.py + shift_audio.py):
 *   1. ALIGN the upload to the song's existing audio → constant offset +
 *      same-recording confidence + drift. A weak match is surfaced for the
 *      caller to confirm ("warn but let me force it") rather than hard-rejected.
 *   2. SHIFT the whole upload onto the song's timeline by that offset (sample-
 *      accurate) so anything derived from it lands on the grid.
 *   3. SEPARATE just the vocals from the aligned upload (Demucs).
 *   4. INSTALL the vocals.wav into the song's best stem set, replacing the
 *      empty one, so "Fit to song" (which prefers vocals.wav) just works.
 *
 * The same align+shift primitives back the future "swap in a better master
 * without disturbing chords/sections" flow — this module only owns the
 * vocals-specific orchestration.
 */
import {
  alignAudioFiles,
  shiftAudioFile,
  enqueueStemSeparation,
  subscribeToJobEvents,
  STEM_QUALITY_PRESETS,
  type AudioAlignment,
  type StemQualityPreset,
  type StemSeparationEvent,
} from './desktopBridge'
import { readProjectSongAsset, writeProjectSongAsset } from './desktopProjectFs'

/** Match confidence at/above which we proceed without warning. */
export const IMPORT_MIN_CONFIDENCE = 0.55
/** Offset drift (s) at/below which the offset is "constant" (same master). */
export const IMPORT_MAX_DRIFT_SEC = 0.04
/**
 * The same limit for a CHORD-level match, where the drift number means
 * something different: it is the leftover after a measured speed difference
 * has been removed, and it cannot be smaller than the chroma frame the
 * measurement is made on (~93 ms). Judging that by the waveform threshold
 * rejected correct alignments for being as accurate as they can possibly be.
 */
export const IMPORT_MAX_HARMONIC_DRIFT_SEC = 0.25
/** The aligned overlap must cover at least this fraction of the song. */
export const IMPORT_MIN_OVERLAP = 0.85

export type AlignmentVerdict = {
  alignment: AudioAlignment
  /** True ⇒ safe to proceed silently. False ⇒ show the reasons + a force option. */
  ok: boolean
  /** Human-readable risks, for the warn dialog. Empty when `ok`. */
  reasons: string[]
}

/**
 * Pure: decide whether an alignment is trustworthy enough to auto-proceed.
 * Separated out so the warn/force gating is unit-tested independently of I/O.
 */
export function classifyAlignment(a: AudioAlignment, songDurationSec: number): AlignmentVerdict {
  const reasons: string[] = []
  if (a.confidence < IMPORT_MIN_CONFIDENCE) {
    reasons.push(`Low match confidence (${Math.round(a.confidence * 100)}%) — this may be a different recording.`)
  }
  const maxDrift = a.method === 'harmonic' ? IMPORT_MAX_HARMONIC_DRIFT_SEC : IMPORT_MAX_DRIFT_SEC
  if (a.driftSec > maxDrift) {
    reasons.push(
      `The timing drifts by ${Math.round(a.driftSec * 1000)} ms across the song — likely a different speed or version, which would misalign the lyrics.`,
    )
  }
  // Overlap: how much of the song the two share once aligned. |offset| eats into
  // it, as does a shorter target. The target's length is measured AFTER the
  // speed correction — an upload played 0.8% fast covers 0.8% more of the song
  // than its raw duration suggests, and judging it raw once reported "only
  // covers 76%" for a file that in fact covers all of it.
  if (songDurationSec > 0) {
    const effectiveTargetSec = a.durationTargetSec * (a.speedRatio ?? 1)
    const overlap = Math.max(
      0,
      Math.min(songDurationSec, effectiveTargetSec - Math.max(0, -a.offsetSec)) - Math.max(0, a.offsetSec),
    )
    if (overlap / songDurationSec < IMPORT_MIN_OVERLAP) {
      reasons.push(
        `The uploaded file only covers ${Math.round((overlap / songDurationSec) * 100)}% of the song — parts would have no vocals.`,
      )
    }
  }
  return { alignment: a, ok: reasons.length === 0, reasons }
}

export type ImportVocalStemResult =
  | { status: 'needs-confirmation'; verdict: AlignmentVerdict }
  | { status: 'done'; alignment: AudioAlignment; vocalStemSubpath: string; vocalStemFileName: string }
  | { status: 'error'; error: string }

export type ImportVocalStemOptions = {
  /** Absolute OS path of the song's existing (instrumental) audio — the ref. */
  refAudioAbs: string
  /** Absolute OS path of the uploaded with-vocals file — the target. */
  uploadAbs: string
  /** Project root (absolute). */
  osPath: string
  /** The song's folder name under the project. */
  songFolder: string
  /** Best stem set's relative prefix, e.g. `stems/best/` (from selectBestStemSet). */
  bestStemPrefix: string
  /** Song duration (s), for the overlap check + tail-matching the shifted upload. */
  songDurationSec: number
  /** Web-side song id, persisted with the separation job. */
  songId?: string | null
  /** Skip the same-recording gate (the user chose "use it anyway"). */
  force?: boolean
  /** Separation quality; defaults to balanced (plenty for ASR, far faster than best). */
  preset?: StemQualityPreset
  onProgress?: (msg: string) => void
}

const TMP_DIR = '.barbro-tmp'

/** Await a stem-separation job to completion, forwarding progress. */
function awaitStemJob(
  jobId: string,
  onProgress?: (msg: string) => void,
): Promise<{ outputDir: string; files: string[] }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const unsub = subscribeToJobEvents<StemSeparationEvent>(
      jobId,
      (ev) => {
        if (settled) return
        if (ev.type === 'progress') onProgress?.(ev.label)
        else if (ev.type === 'done') {
          settled = true
          unsub()
          resolve({ outputDir: ev.outputDir, files: ev.files })
        } else if (ev.type === 'error') {
          settled = true
          unsub()
          reject(new Error(ev.msg || 'Stem separation failed'))
        } else if (ev.type === 'state' && (ev.state === 'cancelled' || ev.state === 'error')) {
          settled = true
          unsub()
          reject(new Error(`Stem separation ${ev.state}`))
        }
      },
      (err) => {
        if (settled) return
        settled = true
        reject(err)
      },
    )
  })
}

export async function importVocalStem(opts: ImportVocalStemOptions): Promise<ImportVocalStemResult> {
  const {
    refAudioAbs,
    uploadAbs,
    osPath,
    songFolder,
    bestStemPrefix,
    songDurationSec,
    songId,
    force,
    onProgress,
  } = opts
  const preset = opts.preset ?? STEM_QUALITY_PRESETS[1]! // balanced

  try {
    // 1 — Align.
    onProgress?.('Checking this is the same recording…')
    const aligned = await alignAudioFiles(refAudioAbs, uploadAbs)
    if (!aligned.ok) return { status: 'error', error: aligned.error }
    const verdict = classifyAlignment(aligned.data, songDurationSec)
    if (!verdict.ok && !force) return { status: 'needs-confirmation', verdict }

    const songDirAbs = `${osPath}/${songFolder}`
    const alignedUploadAbs = `${songDirAbs}/${TMP_DIR}/aligned-upload.wav`
    const sepDirAbs = `${songDirAbs}/${TMP_DIR}/vocsep`

    // 2 — Shift the upload onto the song timeline (match the song's length too).
    onProgress?.('Lining the vocals up with your song…')
    const shifted = await shiftAudioFile({
      srcAbsPath: uploadAbs,
      dstAbsPath: alignedUploadAbs,
      offsetSec: aligned.data.offsetSec,
      targetDurationSec: songDurationSec,
      // Without this the vocals start right and end a second-and-a-half late.
      speedRatio: aligned.data.speedRatio ?? 1,
    })
    if (!shifted.ok) return { status: 'error', error: shifted.error }

    // 3 — Separate just the vocals from the aligned upload.
    onProgress?.('Separating the vocals…')
    const job = await enqueueStemSeparation({
      inputPath: alignedUploadAbs,
      outputDir: sepDirAbs,
      stems: ['vocals'],
      preset,
      songId: songId ?? null,
    })
    if (!job.ok) return { status: 'error', error: job.error }
    const done = await awaitStemJob(job.jobId, onProgress)

    // Locate the produced vocals file (absolute path in `files`).
    const vocalsAbs = done.files.find((f) => /vocals\.wav$/i.test(f))
    if (!vocalsAbs) return { status: 'error', error: 'Separation finished but produced no vocals track.' }
    const vocalsName = vocalsAbs.split('/').pop() ?? 'vocals.wav'

    // 4 — Install into the best stem set (relative subpaths for the asset API).
    onProgress?.('Installing the vocal stem…')
    const read = await readProjectSongAsset(osPath, songFolder, `${TMP_DIR}/vocsep/${vocalsName}`)
    if (!read.ok) return { status: 'error', error: read.error }
    const bytes = new Uint8Array(await read.blob.arrayBuffer())
    const dstSubpath = `${bestStemPrefix}vocals.wav`
    const write = await writeProjectSongAsset(osPath, songFolder, dstSubpath, bytes)
    if (!write.ok) return { status: 'error', error: write.error }

    return {
      status: 'done',
      alignment: aligned.data,
      vocalStemSubpath: dstSubpath,
      vocalStemFileName: 'vocals.wav',
    }
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}
