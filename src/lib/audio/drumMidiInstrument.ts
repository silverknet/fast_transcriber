/**
 * The drum machine as a live `MidiInstrument`.
 *
 * Instead of rendering the part to a WAV and decoding it, each hit is a
 * `BufferSource` scheduled against the transport. Changing the kit or the
 * pattern then costs a re-schedule rather than a render, which is the whole
 * point of the migration.
 *
 *   BufferSource(voice) → gain(velocity) → panner(per class) → drum bus → output
 *
 * The per-class panners are persistent: `voicePanGains` is constant per voice,
 * and `StereoPannerNode`'s mono-input law is exactly the constant-power pan the
 * offline mixer applies, so a mono voice buffer through a panner reproduces it
 * rather than approximating it.
 */
import { kitToAudioBuffers, DRUM_VOICE_CLASSES, type DrumKitBuffers } from './drumKitBuffers'
import { createDrumBusLive, type DrumBusLive } from './drumBusLive'
import { voicePanGains } from './drumBus'
import { DRUM_KIT_SAMPLE_RATE, type DrumKit } from './drumKits'
import type { MidiInstrument, MidiVisual } from './mixerEngine'
import type { DrumClass } from '$lib/songmap/types'
import type { DrumPart } from './drumPart'

const SCHEDULE_WINDOW_SEC = 8
const REFILL_WHEN_LESS_THAN_SEC = 4
const LATE_START_FUDGE_SEC = 0.004

export type DrumMidiInstrument = MidiInstrument & {
  /** Swap the part (pattern/settings changed) without rebuilding the graph. */
  setPart: (part: DrumPart) => void
  /** Swap the kit (sound changed) — buffers only, timing untouched. */
  setKit: (kit: DrumKit) => void
  setNormalizeGain: (g: number) => void
  dispose: () => void
}

/** `StereoPannerNode` takes −1..1; `voicePanGains` is defined by the same law. */
function panFor(cls: DrumClass): number {
  const { l, r } = voicePanGains(cls)
  // l = cos(x·π/2), r = sin(x·π/2) with x = (pan+1)/2 → recover pan.
  return (Math.atan2(r, l) / (Math.PI / 2)) * 2 - 1
}

function firstHitAtOrAfter(part: DrumPart, timeSec: number): number {
  let lo = 0
  let hi = part.hits.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (part.hits[mid]!.mixTimeSec < timeSec) lo = mid + 1
    else hi = mid
  }
  return lo
}

export async function createDrumMidiInstrument(
  ctx: BaseAudioContext,
  init: { part: DrumPart; kit: DrumKit; normalizeGain?: number },
): Promise<DrumMidiInstrument> {
  const bus: DrumBusLive = await createDrumBusLive(ctx)
  bus.setNormalizeGain(init.normalizeGain ?? 1)

  // One panner per class, created once and reused by every hit.
  const panners = {} as Record<DrumClass, StereoPannerNode>
  for (const cls of DRUM_VOICE_CLASSES) {
    const p = ctx.createStereoPanner()
    p.pan.value = panFor(cls)
    p.connect(bus.input)
    panners[cls] = p
  }

  let part = init.part
  let buffers: DrumKitBuffers = kitToAudioBuffers(ctx, init.kit)
  /** Sources started but not yet finished — what `allNotesOff` has to stop. */
  const live = new Set<AudioBufferSourceNode>()
  /** Longest voice, so a seek can find hits that started before it. */
  let maxVoiceSec = 0
  const recomputeMaxVoice = () => {
    maxVoiceSec = 0
    for (const cls of DRUM_VOICE_CLASSES) {
      const b = buffers[cls]
      if (b) maxVoiceSec = Math.max(maxVoiceSec, b.duration)
    }
  }
  recomputeMaxVoice()

  let anchor: { fromSec: number; atCtx: number; rate: number } | null = null
  let nextHitIndex = 0
  let scheduledToSec = -Infinity

  /**
   * Stop every sounding/pending source. `atCtxTime` defers the stop to a future
   * context time (the quantized-jump boundary); without it, stop immediately.
   *
   * Deferred stops keep their `onended` so the nodes still clean themselves up
   * when they actually end.
   */
  function stopAll(atCtxTime?: number): void {
    const deferred = atCtxTime !== undefined && atCtxTime > ctx.currentTime
    for (const src of live) {
      try {
        if (deferred) {
          src.stop(atCtxTime)
          continue
        }
        src.onended = null
        src.stop()
        src.disconnect()
      } catch {
        /* already stopped */
      }
    }
    if (!deferred) live.clear()
  }

  function scheduleSource(hit: DrumPart['hits'][number], when: number, offset: number, rate: number): void {
    const buf = buffers[hit.cls]
    if (!buf) return

    let startAt = when
    let startOffset = offset
    const lateBy = ctx.currentTime - startAt
    if (lateBy > 0) {
      // The sample plays at rate 1 (see below), so a wall-clock second of
      // lateness is a second of sample — no rate factor here.
      startOffset += lateBy
      startAt = ctx.currentTime + LATE_START_FUDGE_SEC
    }
    if (startOffset >= buf.duration) return

    const src = ctx.createBufferSource()
    src.buffer = buf
    // DRUMS ARE NEVER TRANSPOSED. Varispeed changes the transport rate, and
    // following it here would pitch the whole kit up or down with the key — a
    // transposed snare just sounds like a different, worse snare.
    //
    // Only the TIMING follows the rate (the caller already divides the hit
    // delta by it), so the groove stays locked to the song while every hit
    // keeps the kit's own sound.
    src.playbackRate.value = 1
    const g = ctx.createGain()
    g.gain.value = hit.gain
    src.connect(g)
    g.connect(panners[hit.cls])
    src.onended = () => {
      live.delete(src)
      try {
        src.disconnect()
        g.disconnect()
      } catch {
        /* already gone */
      }
    }
    try {
      src.start(startAt, startOffset)
    } catch {
      return
    }
    live.add(src)
  }

  function scheduleTailHits(fromSec: number): void {
    if (!anchor) return
    const firstTail = firstHitAtOrAfter(part, fromSec - maxVoiceSec)
    const firstFuture = firstHitAtOrAfter(part, fromSec)
    for (let i = firstTail; i < firstFuture; i++) {
      const hit = part.hits[i]!
      const offset = fromSec - hit.mixTimeSec
      if (offset >= 0) scheduleSource(hit, anchor.atCtx, offset, anchor.rate)
    }
    nextHitIndex = firstFuture
  }

  function scheduleFutureHits(untilSec: number): void {
    if (!anchor) return
    const endSec = Math.max(scheduledToSec, untilSec)
    while (nextHitIndex < part.hits.length) {
      const hit = part.hits[nextHitIndex]!
      if (hit.mixTimeSec >= endSec) break
      const delta = hit.mixTimeSec - anchor.fromSec
      scheduleSource(hit, anchor.atCtx + delta / anchor.rate, 0, anchor.rate)
      nextHitIndex++
    }
    scheduledToSec = endSec
  }

  function schedule(fromSec: number, atCtx: number, rate: number): void {
    const r = rate > 0 ? rate : 1
    bus.openTail()
    anchor = { fromSec, atCtx, rate: r }
    scheduledToSec = fromSec
    nextHitIndex = 0
    // A voice may have STARTED before the seek point and still be ringing —
    // the old WAV lane played that tail, so dropping it would punch a hole
    // when you seek into the middle of a crash.
    scheduleTailHits(fromSec)
    scheduleFutureHits(fromSec + SCHEDULE_WINDOW_SEC)
  }

  function tick(positionSec: number): void {
    if (!anchor) return
    if (positionSec + REFILL_WHEN_LESS_THAN_SEC < scheduledToSec) return
    scheduleFutureHits(positionSec + SCHEDULE_WINDOW_SEC)
  }

  return {
    output: bus.output,
    get durationSec() {
      return part.durationSec
    },
    schedule,
    tick,
    visual(): MidiVisual {
      // Row order follows DRUM_VOICE_CLASSES, and row 0 draws at the bottom —
      // so the kick sits lowest, like a drum grid.
      return {
        rows: DRUM_VOICE_CLASSES.length,
        hits: part.hits.map((h) => ({
          timeSec: h.mixTimeSec,
          row: Math.max(0, DRUM_VOICE_CLASSES.indexOf(h.cls)),
          gain: h.gain,
        })),
      }
    },
    allNotesOff(atCtxTime?: number) {
      anchor = null
      nextHitIndex = 0
      scheduledToSec = -Infinity
      stopAll(atCtxTime)
      // Ducking the tail is for STOP/SEEK, where the WAV lane went silent
      // instantly. A quantized jump is musical continuity — the room should
      // ring through the boundary, exactly as the old rendered lane's reverb
      // tail did, so don't kill it there.
      if (atCtxTime === undefined) bus.killTail()
    },
    setPart(next: DrumPart) {
      part = next
    },
    setKit(kit: DrumKit) {
      buffers = kitToAudioBuffers(ctx, kit)
      recomputeMaxVoice()
    },
    setNormalizeGain(g: number) {
      bus.setNormalizeGain(g)
    },
    dispose() {
      stopAll()
      for (const cls of DRUM_VOICE_CLASSES) {
        try {
          panners[cls].disconnect()
        } catch {
          /* already gone */
        }
      }
      try {
        bus.output.disconnect()
      } catch {
        /* already gone */
      }
    },
  }
}

/** Kit voices are 44.1 kHz regardless of the context — exposed for tests. */
export { DRUM_KIT_SAMPLE_RATE }
