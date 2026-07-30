/**
 * LIVE pitch shifter — one Signalsmith Stretch worklet on the master bus.
 *
 * This is the "hold the tempo" half of the naive transpose. Resampling
 * (`playbackRate`) moves pitch and tempo together for free; this node buys back
 * as much of the tempo as you asked for, by shifting the pitch the other way
 * without changing duration. See `varispeedPlan` in `varispeed.ts` for the split.
 *
 * Two things make this cheap enough to run live:
 *
 *   - It sits on the MASTER BUS, after every track has been summed, so a song
 *     with four stems plus click and cue lanes still costs exactly one worklet.
 *   - It only ever shifts the RESIDUAL (`n·h`), not the whole transpose. At half
 *     hold on a +2 transpose that is one semitone of work, and artifacts scale
 *     with how much you ask it to do.
 *
 * `clientPitchShift.ts` drives the same package in an `OfflineAudioContext` to
 * pre-render a whole file. This module is the streaming counterpart: no render
 * pass, no wait, no file on disk — the node is inserted into the running graph
 * and re-tuned while playing.
 *
 * ## Latency
 *
 * The worklet has a fixed processing latency. The offline path trims it off the
 * head of the rendered buffer; live, there is nothing to trim — the audio simply
 * comes out late. Anything NOT routed through this node (the transport's
 * metronome oscillators go straight to `destination`) must be delayed to match,
 * or the clicks run ahead of the song. {@link LivePitchShifter.latencySec}
 * exposes the figure for exactly that.
 */
import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch'

export interface LivePitchShifter {
  /** Insert this into the graph: it is both the input and the output node. */
  readonly node: AudioNode
  /** Fixed processing delay this node adds. Compensate un-routed paths by it. */
  readonly latencySec: number
  /** Re-tune while playing. 0 = passthrough (but still latent — see above). */
  setSemitones(semitones: number): void
  dispose(): void
}

/**
 * Build a live shifter on `ctx`. Returns null if the worklet can't be created
 * (older browser, blocked module fetch) — callers treat that as "no tempo hold
 * available" and fall back to pure varispeed rather than failing playback.
 */
export async function createLivePitchShifter(
  ctx: BaseAudioContext,
  channels = 2,
): Promise<LivePitchShifter | null> {
  let node: StretchNode
  try {
    node = await SignalsmithStretch(ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels],
    })
  } catch {
    return null
  }

  let latencySec = 0
  try {
    const reported = await node.latency()
    if (Number.isFinite(reported) && reported > 0) latencySec = reported
  } catch {
    /* leave at 0 — worst case the clicks sit slightly early */
  }

  let current = Number.NaN
  const setSemitones = (semitones: number): void => {
    const n = Number.isFinite(semitones) ? semitones : 0
    if (n === current) return
    current = n
    // Fire-and-forget: `schedule` posts to the worklet; awaiting it from a
    // reactive setter would serialise UI updates behind the audio thread.
    void node.schedule({ output: 0, active: true, semitones: n }).catch(() => {})
  }
  setSemitones(0)

  return {
    node,
    latencySec,
    setSemitones,
    dispose() {
      try {
        void node.stop().catch(() => {})
        node.disconnect()
      } catch {
        /* already torn down */
      }
    },
  }
}
