/**
 * THE transpose. One owner, read by every surface that plays or draws a song.
 *
 * Before this existed the offset lived as component state in `/edit` and was
 * hand-carried to the mixer by props. Two things went wrong, both silently:
 * the prop was never passed, so Overview ignored transpose entirely; and the
 * live stage mounts the mixer with no props at all, so **it was permanently
 * untransposed** — you set −2 in the editor, walked to the stage, and it played
 * in the original key.
 *
 * The fix is not a third prop. It is that no surface should KNOW the transpose:
 * it should ask. This store derives its own song identity from the same
 * `projectStore` + `songMap` every surface already has, so a new surface gets
 * transpose by importing it and nothing else.
 *
 * ## What is personal and what is shared
 *
 * The offset is a PERSONAL, per-device, per-song overlay. It never syncs and
 * never rewrites stored chords — the shared truth is the chords as stored, at
 * transpose 0. That is deliberate: two players can read the same song in
 * different keys. See docs/domains for the wider rule.
 *
 * The varispeed switch and the artifacts dial are per-device but NOT per-song —
 * they are how this player's machine handles transposed audio, not a property
 * of any one song.
 */
import { browser } from '$app/environment'
import { get } from 'svelte/store'
import { project as projectStore } from '$lib/stores/project'
import { songMap } from '$lib/stores/songMap'
import { clampTransposeSemitones } from '$lib/songmap/transposition'
import { varispeedPlan, type VarispeedPlan } from '$lib/audio/varispeed'

/** Per-song offset. Key format is load-bearing — it carries existing settings. */
function offsetKey(songId: string, title: string): string {
  return `barbro::xpose::${songId}::${title}`
}
const VARISPEED_KEY = 'barbro:transposeVarispeed'
const TEMPO_HOLD_KEY = 'barbro:transposeTempoHold'

function readNum(key: string, fallback: number, min: number, max: number): number {
  if (!browser) return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw === null || raw.trim() === '') return fallback
    const v = Number(raw)
    if (!Number.isFinite(v)) return fallback
    return Math.max(min, Math.min(max, v))
  } catch {
    return fallback
  }
}
function write(key: string, value: string | null): void {
  if (!browser) return
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode — remembering is best-effort */
  }
}

class TransposeSettings {
  /** Semitones the listener has dialled in for the CURRENT song. */
  semitones = $state(0)
  /** Apply the offset to audio at all, or leave it as a display-only relabel. */
  varispeedAudio = $state(browser && localStorage.getItem(VARISPEED_KEY) === '1')
  /**
   * 0…1 — how much of the tempo change to cancel. 0 = pure varispeed (perfect
   * audio, the song speeds up or slows down); 1 = original tempo with a live
   * stretch worklet doing all the pitch work. In between the worklet only
   * shifts the residual, so artifacts scale with the dial.
   */
  tempoHold = $state(readNum(TEMPO_HOLD_KEY, 0, 0, 1))

  /** Which song the loaded offset belongs to, so a song change reloads it. */
  #loadedFor: string | null = null

  /**
   * The whole downstream decision, derived ONCE.
   *
   * `rate` drives recorded audio, `shiftSemitones` the residual pitch worklet,
   * and `noteSemitones` the MIDI lanes — which move their notes rather than
   * being re-pitched. Consumers must not re-derive any of these.
   */
  plan = $derived<VarispeedPlan & { noteSemitones: number }>(
    this.varispeedAudio
      ? { ...varispeedPlan(this.semitones, this.tempoHold), noteSemitones: this.semitones }
      : { rate: 1, shiftSemitones: 0, noteSemitones: this.semitones },
  )

  /**
   * The same derivation for EXPLICIT values, for a host that forces an override
   * (tests, previews). Kept here so there is still only one place that knows
   * how a semitone offset becomes a rate, a residual shift and a note offset.
   */
  planFor(
    semitones: number,
    varispeedAudio: boolean,
    tempoHold: number,
  ): VarispeedPlan & { noteSemitones: number } {
    return varispeedAudio
      ? { ...varispeedPlan(semitones, tempoHold), noteSemitones: semitones }
      : { rate: 1, shiftSemitones: 0, noteSemitones: semitones }
  }

  /** Identity of the song currently loaded, from the stores every surface has. */
  #songIdentity(): { songId: string; title: string } {
    const songId = get(projectStore).activeSongId ?? 'standalone'
    const title = get(songMap)?.metadata.title ?? ''
    return { songId, title }
  }

  /**
   * Load this song's offset. Idempotent, so a surface may call it freely —
   * typically from an `$effect` that tracks the active song id.
   *
   * Seeds once from any legacy `transpose.baseSemitones` in the `.smap` for
   * back-compat; after that the offset lives purely locally.
   */
  loadForCurrentSong(): void {
    const { songId, title } = this.#songIdentity()
    const id = `${songId}::${title}`
    if (id === this.#loadedFor) return
    this.#loadedFor = id
    const legacy = get(songMap)?.transpose?.baseSemitones ?? 0
    this.semitones = clampTransposeSemitones(readNum(offsetKey(songId, title), legacy, -12, 12))
  }

  /** Set the offset for the current song and remember it. */
  setSemitones(next: number): void {
    const n = clampTransposeSemitones(next)
    if (n === this.semitones) return
    this.semitones = n
    const { songId, title } = this.#songIdentity()
    write(offsetKey(songId, title), n === 0 ? null : String(n))
  }

  setVarispeedAudio(on: boolean): void {
    this.varispeedAudio = on
    write(VARISPEED_KEY, on ? '1' : '0')
  }

  setTempoHold(v: number): void {
    this.tempoHold = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
    write(TEMPO_HOLD_KEY, String(this.tempoHold))
  }

  /** Tests only: forget what was loaded so the next call re-reads storage. */
  resetForTest(): void {
    this.#loadedFor = null
    this.semitones = 0
  }
}

export const transposeSettings = new TransposeSettings()
