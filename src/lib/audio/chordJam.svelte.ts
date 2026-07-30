/**
 * The CHORD JAM — keys, bass and arpeggiator as a live instrument.
 *
 * These voices started life inside the Chords tab as a "hear what you placed"
 * preview. They are good enough to perform with now, so this module lifts them
 * out of that component into a runtime singleton that any surface can drive:
 * the editor, the Overview mixer, and the live stage — where the MIDI
 * controller turns them on and off mid-song to lift a chorus or thin out a
 * verse.
 *
 * ## Engine-agnostic by construction
 *
 * The editor plays through `UnifiedTransport`; Overview and the live route play
 * through `MixerView`'s own `MixerEngine`. Rather than pick one, this module
 * takes the playhead as an INPUT: whichever surface is sounding calls
 * {@link ChordJam.setPosition} each frame. That is also why firing is an
 * explicit method rather than an `$effect` — it makes the whole schedule
 * drivable (and unit-testable) without a component, a clock, or an
 * `AudioContext`.
 *
 * ## What is derived vs. what is state
 *
 * The hit GRIDS are `$derived` from the `.smap` plus the per-voice settings, so
 * they recompute when the song or a setting changes — never per frame.
 * {@link ChordJam.setPosition} only compares indices and fires what was
 * crossed, which is cheap enough to call at rAF rate.
 *
 * Voice settings are per-device (localStorage), like the transpose overlay:
 * they are how THIS player likes to play, not part of the shared song.
 */
import { browser } from '$app/environment'
import { chordRootToPitchClass, formatChordSymbol, resolveChordAtEachBeat } from '$lib/chords'
import { sortBeatsByTime } from '$lib/songmap/normalize'
import type { ChordSymbol, SongMap } from '$lib/songmap/types'
import { voiceChordProgression } from './chordPlaybackVoicing'
import {
  playChordPlayback,
  resumeChordPlayback,
  setChordPatch,
  setChordPlaybackVolume,
  stopChordPlayback,
  getInstrumentPatch,
  DEFAULT_CHORD_PLAYBACK_INSTRUMENT,
} from './chordPlayback'
import {
  buildBassHits,
  playBassNote,
  resumeBass,
  setBassPatch,
  setBassVolume,
  stopBass,
  BASS_PATCH,
  type BassPattern,
} from './chordBass'
import {
  arpSubsPerBeat,
  buildArpHits,
  playArpNote,
  resumeArp,
  setArpPatch,
  setArpVolume,
  stopArp,
  ARP_PATCH,
  ARP_RATES,
  type ArpDirection,
  type ArpRate,
} from './chordArp'
import { structuredClonePatch, type SynthPatch } from './keysSynth'

/** Octave nudge range, shared by every pitched voice. */
export const JAM_OCT_MIN = -2
export const JAM_OCT_MAX = 2

/** Which voices exist — the things a pad can toggle. */
export type JamVoice = 'keys' | 'bass' | 'arp'
export const JAM_VOICES: readonly JamVoice[] = ['keys', 'bass', 'arp']
export const JAM_VOICE_LABELS: Record<JamVoice, string> = {
  keys: 'Chords',
  bass: 'Bass',
  arp: 'Arp',
}

/**
 * How far behind the playhead we will still "catch up" and fire notes. A seek
 * or a dropped frame must not machine-gun the whole song's worth of hits.
 */
const MAX_CATCH_UP = 3

const KEY = {
  keysOn: 'barbro:hearChords',
  keysVol: 'barbro:hearChordsVol',
  keysInstr: 'barbro:hearChordsInstr',
  keysPatch: 'barbro:hearChordsPatch',
  keysOct: 'barbro:hearChordsOct',
  bassOn: 'barbro:chordBassOn',
  bassPattern: 'barbro:chordBassPattern',
  bassVol: 'barbro:chordBassVol',
  bassOct: 'barbro:chordBassOct',
  bassPatch: 'barbro:chordBassPatch',
  arpOn: 'barbro:chordArpOn',
  arpRate: 'barbro:chordArpRate',
  arpDir: 'barbro:chordArpDir',
  arpVol: 'barbro:chordArpVol',
  arpOct: 'barbro:chordArpOct',
  arpPatch: 'barbro:chordArpPatch',
} as const

function readBool(key: string, fallback = false): boolean {
  if (!browser) return fallback
  const raw = localStorage.getItem(key)
  return raw == null ? fallback : raw === '1'
}
function readNum(key: string, fallback: number, min: number, max: number): number {
  if (!browser) return fallback
  const v = Number(localStorage.getItem(key))
  if (!Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, v))
}
function readStr<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (!browser) return fallback
  const raw = localStorage.getItem(key)
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback
}
function readPatch(key: string, fallback: () => SynthPatch): SynthPatch {
  if (!browser) return fallback()
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback()
    const parsed = JSON.parse(raw) as SynthPatch
    return parsed && typeof parsed === 'object' && parsed.env ? parsed : fallback()
  } catch {
    return fallback()
  }
}
function write(key: string, value: string): void {
  if (!browser) return
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

/** Index of the last entry at or before `t` (-1 when none). Points are sorted. */
function indexAt(points: readonly { timeSec: number }[], t: number): number {
  let idx = -1
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.timeSec <= t + 1e-6) idx = i
    else break
  }
  return idx
}

class ChordJam {
  // ── The live switches ────────────────────────────────────────────────────
  keysOn = $state(readBool(KEY.keysOn))
  bassOn = $state(readBool(KEY.bassOn))
  arpOn = $state(readBool(KEY.arpOn))

  // ── Per-voice settings ───────────────────────────────────────────────────
  keysVolume = $state(readNum(KEY.keysVol, 0.5, 0, 1))
  keysInstrument = $state(
    browser
      ? (localStorage.getItem(KEY.keysInstr) ?? DEFAULT_CHORD_PLAYBACK_INSTRUMENT)
      : DEFAULT_CHORD_PLAYBACK_INSTRUMENT,
  )
  keysOctave = $state(readNum(KEY.keysOct, 0, JAM_OCT_MIN, JAM_OCT_MAX))
  keysPatch = $state<SynthPatch>(
    readPatch(KEY.keysPatch, () =>
      getInstrumentPatch(
        browser
          ? (localStorage.getItem(KEY.keysInstr) ?? DEFAULT_CHORD_PLAYBACK_INSTRUMENT)
          : DEFAULT_CHORD_PLAYBACK_INSTRUMENT,
      ),
    ),
  )

  bassPattern = $state<BassPattern>(
    readStr(KEY.bassPattern, ['1/1', '4/4', '8/8', '16/16'] as const, '4/4'),
  )
  bassVolume = $state(readNum(KEY.bassVol, 0.6, 0, 1))
  bassOctave = $state(readNum(KEY.bassOct, 0, JAM_OCT_MIN, JAM_OCT_MAX))
  bassPatch = $state<SynthPatch>(readPatch(KEY.bassPatch, () => structuredClonePatch(BASS_PATCH)))

  arpRate = $state<ArpRate>(readStr(KEY.arpRate, ARP_RATES, '1/8'))
  arpDirection = $state<ArpDirection>(
    readStr(KEY.arpDir, ['up', 'down', 'updown', 'random'] as const, 'up'),
  )
  arpVolume = $state(readNum(KEY.arpVol, 0.5, 0, 1))
  arpOctave = $state(readNum(KEY.arpOct, 1, JAM_OCT_MIN, JAM_OCT_MAX))
  arpPatch = $state<SynthPatch>(readPatch(KEY.arpPatch, () => structuredClonePatch(ARP_PATCH)))

  // ── Runtime input (pushed by whichever surface is sounding) ──────────────
  // `$state.raw`, NOT `$state`: the song map is swapped in whole (never deep-
  // mutated here) and the `configure` guard compares it by IDENTITY. A deep
  // `$state` would proxy the assigned map, so `sm === this.#songMap` compares a
  // raw store value against its proxy — always false. That fired Svelte's
  // `state_proxy_equality_mismatch` warning AND defeated the no-op guard, so the
  // whole chord/bass/arp schedule rebuilt on every reactive tick. `$state.raw`
  // stores the value un-proxied (identity holds) while still recomputing the
  // derived schedules when a genuinely new map is assigned.
  #songMap = $state.raw<SongMap | null>(null)
  #playing = false
  /** Which surface is currently driving us (see setPosition). */
  #owner: string | null = null
  #lastKeysIdx = -1
  #lastBassIdx = -1
  #lastArpIdx = -1

  /** Point the jam at a song. Safe to call every render — same map is a no-op. */
  configure(sm: SongMap | null): void {
    if (sm === this.#songMap) return
    this.#songMap = sm
    this.#resetFiring()
  }

  /** Is any voice switched on? Hosts use this to skip work entirely. */
  get anyOn(): boolean {
    return this.keysOn || this.bassOn || this.arpOn
  }

  // ── Derived schedules (recompute on song/setting change, never per frame) ─

  /**
   * Chord CHANGE points, voiced to MIDI. Stored chords are voiced, NOT the
   * display transpose: the audio is in its original key, so the jam must be too.
   */
  #chordChanges = $derived.by<{ timeSec: number; chord: ChordSymbol | null }[]>(() => {
    const sm = this.#songMap
    if (!sm) return []
    const resolved = resolveChordAtEachBeat(sm)
    const changes: { timeSec: number; chord: ChordSymbol | null }[] = []
    let prevKey: string | null = '--init--'
    for (const b of sortBeatsByTime(sm.timeline.beats)) {
      const chord = resolved.get(b.id) ?? null
      const key = chord ? formatChordSymbol(chord) : 'none'
      if (key === prevKey) continue // carried forward → no re-attack
      prevKey = key
      changes.push({ timeSec: b.timeSec, chord })
    }
    return changes
  })

  #keysPoints = $derived.by<{ timeSec: number; notes: number[] }[]>(() => {
    const voiced = voiceChordProgression(
      this.#chordChanges.map((c) => c.chord),
      this.keysOctave,
    )
    return this.#chordChanges.map((c, i) => ({ timeSec: c.timeSec, notes: voiced[i] ?? [] }))
  })

  #bassHits = $derived.by<{ timeSec: number; midi: number }[]>(() => {
    const sm = this.#songMap
    if (!sm) return []
    const resolved = resolveChordAtEachBeat(sm)
    const beats = sortBeatsByTime(sm.timeline.beats).map((b) => {
      const chord = resolved.get(b.id) ?? null
      const bassPc =
        chord && !chord.noChord
          ? chord.bass
            ? chordRootToPitchClass(chord.bass, chord.bassAccidental)
            : chordRootToPitchClass(chord.root, chord.accidental)
          : null
      return { timeSec: b.timeSec, barId: b.barId, bassPc }
    })
    return buildBassHits(beats, this.bassPattern, this.bassOctave)
  })

  #arpHits = $derived.by<{ timeSec: number; midi: number }[]>(() => {
    const sm = this.#songMap
    if (!sm) return []
    const voiced = voiceChordProgression(
      this.#chordChanges.map((c) => c.chord),
      this.arpOctave,
    )
    const pts = this.#chordChanges.map((c, i) => ({ timeSec: c.timeSec, notes: voiced[i] ?? [] }))
    const beats = sortBeatsByTime(sm.timeline.beats).map((b) => {
      let notes: number[] = []
      for (const p of pts) {
        if (p.timeSec <= b.timeSec + 1e-6) notes = p.notes
        else break
      }
      return { timeSec: b.timeSec, notes }
    })
    return buildArpHits(beats, arpSubsPerBeat(this.arpRate), this.arpDirection)
  })

  // ── The clock input ──────────────────────────────────────────────────────

  /**
   * Advance the jam to `positionSec` (ORIGINAL audio time — the same base as
   * `Beat.timeSec`). Call once per frame from whichever surface is sounding.
   * Fires whatever was crossed since the previous call.
   */
  setPosition(positionSec: number, playing: boolean, owner = 'default'): void {
    // Two surfaces can be mounted at once (the editor timeline and the mixer),
    // but only one is ever sounding. The one that reports PLAYING takes
    // ownership; a stop from anyone else is ignored, so an idle surface can't
    // silence the one that's actually playing.
    if (playing) this.#owner = owner
    else if (this.#owner !== null && this.#owner !== owner) return

    if (!playing) {
      if (this.#playing) this.releaseAll()
      this.#playing = false
      this.#owner = null
      return
    }
    this.#playing = true

    // Keys: retrigger on chord CHANGE only (a held chord must not re-attack).
    if (this.keysOn) {
      const idx = indexAt(this.#keysPoints, positionSec)
      if (idx !== this.#lastKeysIdx) {
        this.#lastKeysIdx = idx
        playChordPlayback(idx >= 0 ? (this.#keysPoints[idx]?.notes ?? []) : [])
      }
    } else if (this.#lastKeysIdx !== -1) {
      this.#lastKeysIdx = -1
      stopChordPlayback()
    }

    this.#lastBassIdx = this.#fireHits(
      this.bassOn,
      this.#bassHits,
      positionSec,
      this.#lastBassIdx,
      playBassNote,
      stopBass,
    )
    this.#lastArpIdx = this.#fireHits(
      this.arpOn,
      this.#arpHits,
      positionSec,
      this.#lastArpIdx,
      playArpNote,
      stopArp,
    )
  }

  /** Shared "fire everything crossed, but don't machine-gun after a seek". */
  #fireHits(
    on: boolean,
    hits: readonly { timeSec: number; midi: number }[],
    positionSec: number,
    lastIdx: number,
    play: (midi: number) => void,
    release: () => void,
  ): number {
    if (!on) {
      if (lastIdx !== -1) release()
      return -1
    }
    const idx = indexAt(hits, positionSec)
    if (idx < 0) return -1
    if (idx > lastIdx) {
      const from = idx - lastIdx <= MAX_CATCH_UP ? lastIdx + 1 : idx
      for (let i = from; i <= idx; i++) play(hits[i]!.midi)
    }
    return idx
  }

  /** Silence every voice (pause/stop/seek away). Safe to call repeatedly. */
  releaseAll(): void {
    stopChordPlayback()
    stopBass()
    stopArp()
    this.#resetFiring()
  }

  #resetFiring(): void {
    this.#lastKeysIdx = -1
    this.#lastBassIdx = -1
    this.#lastArpIdx = -1
  }

  // ── Live control surface (MIDI + UI both call these) ─────────────────────

  isOn(voice: JamVoice): boolean {
    return voice === 'keys' ? this.keysOn : voice === 'bass' ? this.bassOn : this.arpOn
  }

  setVoice(voice: JamVoice, on: boolean): void {
    if (voice === 'keys') this.keysOn = on
    else if (voice === 'bass') this.bassOn = on
    else this.arpOn = on
    if (!on) {
      // Release immediately — waiting for the next frame leaves a note hanging
      // when you switch a voice off between hits.
      if (voice === 'keys') stopChordPlayback()
      else if (voice === 'bass') stopBass()
      else stopArp()
    }
    void this.warmUp()
  }

  toggleVoice(voice: JamVoice): void {
    this.setVoice(voice, !this.isOn(voice))
  }

  /** Step the arp rate 1/4 → 1/8 → 1/16 → 1/4. One pad, three feels. */
  cycleArpRate(): ArpRate {
    const i = ARP_RATES.indexOf(this.arpRate)
    this.arpRate = ARP_RATES[(i + 1) % ARP_RATES.length]!
    return this.arpRate
  }

  setArpRate(rate: ArpRate): void {
    if (ARP_RATES.includes(rate)) this.arpRate = rate
  }

  /**
   * Warm the audio contexts for whichever voices are on. Must be reached from a
   * user gesture (a pad press counts) or the browser blocks the contexts.
   */
  async warmUp(): Promise<void> {
    if (!browser) return
    const jobs: Promise<void>[] = []
    if (this.keysOn) jobs.push(resumeChordPlayback())
    if (this.bassOn) jobs.push(resumeBass())
    if (this.arpOn) jobs.push(resumeArp())
    await Promise.all(jobs).catch(() => {})
  }

  /**
   * Push settings into the synths and persist them. Hosts call this from one
   * `$effect`; it is the ONLY place that writes to the non-reactive audio sinks.
   */
  syncSettings(): void {
    setChordPlaybackVolume(this.keysVolume)
    setChordPatch(this.keysPatch)
    setBassVolume(this.bassVolume)
    setBassPatch(this.bassPatch)
    setArpVolume(this.arpVolume)
    setArpPatch(this.arpPatch)

    write(KEY.keysOn, this.keysOn ? '1' : '0')
    write(KEY.keysVol, String(this.keysVolume))
    write(KEY.keysInstr, this.keysInstrument)
    write(KEY.keysOct, String(this.keysOctave))
    write(KEY.keysPatch, JSON.stringify(this.keysPatch))
    write(KEY.bassOn, this.bassOn ? '1' : '0')
    write(KEY.bassPattern, this.bassPattern)
    write(KEY.bassVol, String(this.bassVolume))
    write(KEY.bassOct, String(this.bassOctave))
    write(KEY.bassPatch, JSON.stringify(this.bassPatch))
    write(KEY.arpOn, this.arpOn ? '1' : '0')
    write(KEY.arpRate, this.arpRate)
    write(KEY.arpDir, this.arpDirection)
    write(KEY.arpVol, String(this.arpVolume))
    write(KEY.arpOct, String(this.arpOctave))
    write(KEY.arpPatch, JSON.stringify(this.arpPatch))
  }

  /** Load a preset into the keys voice (the instrument picker's onchange). */
  selectKeysInstrument(name: string): void {
    this.keysInstrument = name
    this.keysPatch = getInstrumentPatch(name)
  }

  // Test/debug observers.
  get keysPointsForTest(): readonly { timeSec: number; notes: number[] }[] {
    return this.#keysPoints
  }
  get bassHitsForTest(): readonly { timeSec: number; midi: number }[] {
    return this.#bassHits
  }
  get arpHitsForTest(): readonly { timeSec: number; midi: number }[] {
    return this.#arpHits
  }
}

export const chordJam = new ChordJam()
