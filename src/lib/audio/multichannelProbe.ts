/**
 * CAN THIS MACHINE ACTUALLY SEND MORE THAN TWO CHANNELS?
 *
 * ## The one question the live rig stands on
 *
 * Keeping the click out of the house needs it on its own desk channel, which
 * needs its own OUTPUT channel. Everything else in the rig is downstream of
 * whether that works, and it has never been established:
 *
 *  - The DEVICE carries 18 channels — `afplay` with a 4-channel WAV lit desk
 *    channels 9/10/11/12 at exactly the levels sent.
 *  - The GRAPH is correct — `mixerEngine.split.browser.test.ts` proves in an
 *    `OfflineAudioContext` that click lands on channel 2 and the song stays on
 *    0/1, separably.
 *  - But switched on in the real app, playback went SILENT.
 *
 * So the fault is somewhere between Chromium and CoreAudio, and no amount of
 * reasoning settles it. This measures it.
 *
 * ## Two rules learned the hard way
 *
 * **Never probe on the shared context.** `audioDevice()` is process-wide and
 * documented never-close; `destination.channelCount` is global and sticky. A
 * failed probe there silences every surface in the app at once. This uses a
 * throwaway context and closes it.
 *
 * **Ask for exactly what is needed.** The old code opened `channelCount: max`
 * — all 18 — to use four. Asking CoreAudio for an 18-channel stream is the
 * prime suspect for the silence, and it is free to not do that.
 */

/** What each probe channel is for, and how loud, so the desk can identify it. */
export type ProbeTone = { channel: number; label: string; levelDb: number }

/**
 * Distinct levels per channel — the whole point.
 *
 * Four channels at the same level prove only "something arrived". Different
 * levels prove WHICH channel arrived where, so a desk wired to the wrong USB
 * source is caught rather than passed.
 */
export const PROBE_TONES: readonly ProbeTone[] = [
  { channel: 0, label: 'song L', levelDb: -12 },
  { channel: 1, label: 'song R', levelDb: -12 },
  { channel: 2, label: 'click', levelDb: -18 },
  { channel: 3, label: 'cue', levelDb: -24 },
]

/** Channels the probe needs open. Exactly four — never `maxChannelCount`. */
export const PROBE_CHANNELS = PROBE_TONES.length

/** A desk meter must rise at least this far above its resting level to count. */
export const PROBE_RISE_DB = 20

export type ProbeChannelResult = {
  /** Zero-based output channel BarBro played on. */
  outputChannel: number
  label: string
  /** One-based desk channel it should have arrived on. */
  deskChannel: number
  restingDb: number | null
  activeDb: number | null
  arrived: boolean
}

export type ProbeVerdict = {
  /** True only when EVERY channel arrived on its own desk strip. */
  proven: boolean
  channels: ProbeChannelResult[]
  /** Said plainly, for someone standing at a desk. */
  reason: string
}

/**
 * Did each tone land on its own desk channel?
 *
 * Compares the desk's meters while the probe played against the same meters
 * while it was silent, so a noisy input or a channel already carrying signal
 * cannot be mistaken for the probe arriving.
 */
export function probeVerdict(opts: {
  firstDeskChannel: number
  /** Desk channel (1-based) → dB, measured before the tones started. */
  resting: Record<number, number | null>
  /** Desk channel (1-based) → dB, measured while the tones played. */
  active: Record<number, number | null>
}): ProbeVerdict {
  const { firstDeskChannel, resting, active } = opts
  const channels: ProbeChannelResult[] = PROBE_TONES.map((t) => {
    const deskChannel = firstDeskChannel + t.channel
    const r = resting[deskChannel] ?? null
    const a = active[deskChannel] ?? null
    return {
      outputChannel: t.channel,
      label: t.label,
      deskChannel,
      restingDb: r,
      activeDb: a,
      // A missing reading is NOT an arrival. UDP drops on this link, and
      // treating silence as success is how the rig lied about itself before.
      arrived: r !== null && a !== null && a - r >= PROBE_RISE_DB,
    }
  })

  const missed = channels.filter((c) => !c.arrived)
  if (missed.length === 0) {
    return {
      proven: true,
      channels,
      reason: `All four channels arrived on their own strip (${firstDeskChannel}-${firstDeskChannel + 3}). The click and the cues can be kept out of the house.`,
    }
  }
  if (missed.length === channels.length) {
    return {
      proven: false,
      channels,
      reason:
        'Nothing reached the desk at all. Check that BarBro is playing to the XR18 and that these channels are switched to USB.',
    }
  }
  // The interesting failure: stereo works, the extra channels do not. That is
  // this machine refusing to send more than two, which is the whole question.
  const names = missed.map((c) => `${c.label} (desk ${c.deskChannel})`).join(', ')
  return {
    proven: false,
    channels,
    reason: `Only some channels arrived — ${names} did not. This machine will not send more than two channels, so the click has to travel mixed in with the song.`,
  }
}

export type ProbeRun = { stop: () => void }

/**
 * Play the probe tones on a THROWAWAY context, and return a stopper.
 *
 * Returns null when the device cannot open enough channels — which is itself an
 * answer, and a cleaner one than silence.
 */
export function startMultichannelProbe(): { run: ProbeRun; ctx: AudioContext } | null {
  const ctx = new AudioContext()
  const max = ctx.destination.maxChannelCount ?? 2
  if (max < PROBE_CHANNELS) {
    void ctx.close()
    return null
  }
  try {
    // EXACTLY what is needed. Opening all 18 to use four is the suspected cause
    // of the silence this probe exists to explain.
    ctx.destination.channelCount = PROBE_CHANNELS
    ctx.destination.channelCountMode = 'explicit'
    // Without 'discrete' a 4-channel destination applies a SURROUND layout and
    // sprays each signal across speakers instead of placing it.
    ctx.destination.channelInterpretation = 'discrete'
  } catch {
    void ctx.close()
    return null
  }

  const merger = ctx.createChannelMerger(PROBE_CHANNELS)
  merger.connect(ctx.destination)
  const nodes: OscillatorNode[] = []
  for (const t of PROBE_TONES) {
    const osc = ctx.createOscillator()
    // A different pitch per channel so a person can hear the difference too,
    // not only the meters.
    osc.frequency.value = 300 + t.channel * 220
    const gain = ctx.createGain()
    gain.gain.value = 10 ** (t.levelDb / 20)
    osc.connect(gain)
    gain.connect(merger, 0, t.channel)
    osc.start()
    nodes.push(osc)
  }

  return {
    ctx,
    run: {
      stop() {
        for (const n of nodes) {
          try {
            n.stop()
          } catch {
            /* already stopped */
          }
        }
        // Closing matters as much as opening: this context asked the device for
        // a 4-channel stream and must give it back.
        void ctx.close()
      },
    },
  }
}
