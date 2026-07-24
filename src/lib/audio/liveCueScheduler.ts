/**
 * Live-rig cue scheduler: when a performer launches a section, a short
 * spoken-name + count-in `AudioBuffer` needs to become audible at a precise
 * `AudioContext` time, on the same clock as the rest of the audio engine.
 *
 * Only one cue is ever in flight — launching a new section (or cancelling)
 * stops whatever cue was pending/playing before scheduling the next one.
 * This class owns the `AudioBufferSourceNode` lifecycle so callers never
 * have to think about node teardown.
 */
export class LiveCueScheduler {
  #ctx: AudioContext
  #gainNode: GainNode
  #currentSource: AudioBufferSourceNode | null = null

  /** `destination` is an already-connected node in the host graph (e.g. a mixer bus or ctx.destination). */
  constructor(ctx: AudioContext, destination: AudioNode, opts?: { gain?: number }) {
    this.#ctx = ctx
    this.#gainNode = ctx.createGain()
    this.#gainNode.gain.value = opts?.gain ?? 1
    this.#gainNode.connect(destination)
  }

  /**
   * Make `buffer` audible at `atCtxTime` (AudioContext clock seconds).
   * - Cancels/stops any previously scheduled-but-not-finished cue first (only one cue at a time).
   * - If `atCtxTime` is in the future: start exactly then.
   * - If `atCtxTime` is already in the past (we were called a little late): start immediately
   *   but with a buffer offset of (now - atCtxTime) so the audible content stays TIME-ALIGNED
   *   (we skip the part that should already have played) rather than dragging late. If the whole
   *   buffer is already past, play nothing.
   */
  scheduleAt(buffer: AudioBuffer, atCtxTime: number): void {
    this.cancelPending()

    if (buffer.length === 0 || buffer.duration <= 0) return

    const now = this.#ctx.currentTime
    let when = atCtxTime
    let offsetSec = 0

    if (atCtxTime <= now) {
      offsetSec = now - atCtxTime
      if (offsetSec >= buffer.duration) return // whole buffer already past; play nothing
      when = 0 // start as soon as possible
    }

    const source = this.#ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.#gainNode)
    source.onended = () => {
      // Guard: an older cue's `onended` can fire after a newer cue has
      // already replaced it (e.g. it was stopped and the browser still
      // dispatches the event). Only clear the tracked reference if it's
      // still THIS source.
      if (this.#currentSource === source) {
        this.#currentSource = null
      }
      try {
        source.disconnect()
      } catch {
        // already disconnected
      }
    }

    this.#currentSource = source
    source.start(when, offsetSec)
  }

  /** Stop + tear down any pending/playing cue. Safe to call when nothing is scheduled. */
  cancelPending(): void {
    const source = this.#currentSource
    if (!source) return
    this.#currentSource = null
    source.onended = null
    try {
      source.stop()
    } catch {
      // stop() can throw if the node was never started
    }
    try {
      source.disconnect()
    } catch {
      // already disconnected
    }
  }

  /** Set the output gain (0..1+). Applies to current and future cues. */
  setVolume(gain: number): void {
    this.#gainNode.gain.value = gain
  }

  /** Permanent teardown: cancel, disconnect the internal gain node. */
  dispose(): void {
    this.cancelPending()
    try {
      this.#gainNode.disconnect()
    } catch {
      // already disconnected
    }
  }
}
