/**
 * THE audio device. One hardware `AudioContext` for the whole app.
 *
 * A browser allows roughly six hardware contexts per page and throws on the
 * seventh. A single `/edit` load used to construct: the mixer engine, the
 * editor's playback controller, and one each for chord playback, chord bass,
 * chord arp and chord kick — six, before anything else asked. The seventh
 * request threw from wherever it happened to land, which is why enabling a
 * chord voice could break the cue renderer with no traceable connection, and
 * why it surfaced as a bare "paused in debugger" rather than an error anyone
 * could act on.
 *
 * Sharing one context also means one clock. Voices on separate contexts cannot
 * be sample-accurate against each other at all — they drift by construction —
 * so this is a correctness fix for live playback as much as a resource one.
 *
 * `latencyHint: 0` because the keybed plays through this: the APC Key 25 has to
 * feel immediate, and that is the tightest requirement any consumer has.
 */

let shared: AudioContext | null = null

/** Test seam: swap in a context (offline or mock) and get a restore function. */
export function __setAudioDeviceForTest(ctx: AudioContext | null): () => void {
  const prev = shared
  shared = ctx
  return () => {
    shared = prev
  }
}

/** True once a context exists — lets callers avoid creating one just to look. */
export function hasAudioDevice(): boolean {
  return shared !== null
}

/**
 * The shared context, created on first use.
 *
 * Browsers start it suspended until a user gesture; call {@link resumeAudioDevice}
 * from a gesture handler. Never `close()` this — it is process-wide, and closing
 * it silences every surface at once.
 */
export function audioDevice(): AudioContext {
  // A CLOSED context is worse than none: it accepts every call, throws nothing,
  // and produces silence forever. Treat it as absent so one bad `close()`
  // anywhere cannot brick audio for the rest of the session.
  if (shared && shared.state !== 'closed') return shared
  const Ctor: typeof AudioContext =
    (
      globalThis as unknown as {
        AudioContext?: typeof AudioContext
        webkitAudioContext?: typeof AudioContext
      }
    ).AudioContext ??
    (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  shared = new Ctor({ latencyHint: 0 })
  return shared
}

/** Resume from a user gesture. Safe to call repeatedly. */
export async function resumeAudioDevice(): Promise<AudioContext> {
  const ctx = audioDevice()
  if (ctx.state !== 'running') {
    try {
      await ctx.resume()
    } catch (e) {
      // Being blocked until a real gesture is ordinary — the caller retries on
      // the next one. A CLOSED context is not: resume() rejects with
      // InvalidStateError and no amount of retrying will help. Swallowing both
      // identically is how a dead device stayed invisible for an afternoon.
      if (ctx.state === 'closed') {
        console.error('[audio] shared device is CLOSED — something called close() on it', e)
      }
    }
  }
  return ctx
}
