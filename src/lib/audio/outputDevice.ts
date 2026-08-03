/**
 * WHICH SOUND CARD IS BARBRO ACTUALLY PLAYING TO?
 *
 * ## Why this exists
 *
 * The single most expensive failure in this rig is invisible: the computer's
 * output device is set to its built-in speakers while everyone is looking at the
 * mixer. The desk answers OSC perfectly (that runs over the network, not the
 * USB cable), every channel reads back exactly as configured, every green light
 * in the app is honest — and no audio arrives, because BarBro is playing to a
 * laptop.
 *
 * That was measured, not imagined. With the XR18 selected, Chromium reports
 * `maxChannelCount: 18`; with the built-in speakers selected it reports 2 and
 * throws `IndexSizeError` on any attempt to open four channels. Same code, same
 * machine, same desk — opposite answers, and nothing in the app said why.
 *
 * ## What it can and cannot know
 *
 * The browser will not name the output device without permission, and the
 * permission it wants is for the MICROPHONE — which is an absurd thing to ask a
 * musician for at load-in. So the name is offered when it is already available
 * and never demanded.
 *
 * The channel COUNT needs no permission and is the more useful signal anyway:
 * two channels means this device cannot carry a separate click, whatever it is
 * called.
 */

export type OutputDeviceInfo = {
  /** What the device is called, when the browser will say. Null otherwise. */
  label: string | null
  /** Channels the device offers. 2 = a stereo card; 4+ = a rig-capable one. */
  maxChannelCount: number
  /** Can this device carry song + click + cue on separate channels? */
  canSeparate: boolean
  /** True when this is plainly a computer's own speakers rather than an interface. */
  looksBuiltIn: boolean
  /** Said plainly, for someone standing at a desk. */
  summary: string
}

/** Names macOS and Windows give a machine's own speakers. */
const BUILT_IN = /built-?in|macbook|imac|internal speaker|speakers \(realtek|headphone/i

export function describeOutputDevice(opts: {
  maxChannelCount: number
  label?: string | null
}): OutputDeviceInfo {
  const max = Number.isFinite(opts.maxChannelCount) ? Math.floor(opts.maxChannelCount) : 2
  const label = opts.label?.trim() || null
  const canSeparate = max >= 4
  const looksBuiltIn = label !== null && BUILT_IN.test(label)

  let summary: string
  if (canSeparate) {
    summary = label
      ? `Playing to ${label} — ${max} channels, enough to keep the click off the house.`
      : `This output has ${max} channels, enough to keep the click off the house.`
  } else if (looksBuiltIn) {
    // The expensive one. Name the fix, not the fault.
    summary = `BarBro is playing to ${label}, not the mixer. Choose the XR18 as the computer's sound output, then test again.`
  } else if (label) {
    summary = `Playing to ${label}, which offers ${max} channels. The click cannot be kept out of the house on this output.`
  } else {
    summary = `This output offers ${max} channels. If the mixer is connected by USB, choose it as the computer's sound output.`
  }
  return { label, maxChannelCount: max, canSeparate, looksBuiltIn, summary }
}

/**
 * Ask the browser what it is playing to.
 *
 * Uses a THROWAWAY context: `maxChannelCount` is read from a destination, and
 * the shared one is process-wide and must not be poked at for a question.
 *
 * The label comes from `enumerateDevices`, which returns empty strings until
 * some permission has been granted — so a missing name is normal and never
 * treated as an error.
 */
export async function readOutputDevice(): Promise<OutputDeviceInfo> {
  let maxChannelCount = 2
  let ctx: AudioContext | null = null
  try {
    ctx = new AudioContext()
    maxChannelCount = ctx.destination.maxChannelCount ?? 2
  } catch {
    /* no audio at all — reported as a stereo device, which is the safe read */
  } finally {
    try {
      await ctx?.close()
    } catch {
      /* already closed */
    }
  }

  let label: string | null = null
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.()
    const out = devices?.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default')
    label = out?.label?.trim() || null
  } catch {
    /* naming the device is a bonus, never a requirement */
  }

  return describeOutputDevice({ maxChannelCount, label })
}
