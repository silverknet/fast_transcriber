/**
 * WHICH OUTPUT CHANNEL DOES EACH LANE LEAVE ON?
 *
 * ## Why this exists
 *
 * Everything BarBro plays currently leaves as ONE stereo pair. The song, the
 * click and the spoken cues are already mixed together by the time they reach
 * the sound card, so on the XR18 they all arrive on the same two channels.
 *
 * That makes the central promise of a live rig impossible to keep. Click must be
 * in the performers' ears and NEVER in the house — but if it is riding inside
 * the same two channels as the song, taking it off the main bus takes the song
 * off too. The front-of-house safety check was, quite literally, protecting two
 * channels that carried the click it was supposed to exclude.
 *
 * Separating them at the SOURCE is the only fix. One USB cable can carry 18
 * channels; the desk then treats click as its own strip, which can be sent to
 * every in-ear and assigned off the house.
 *
 * ## Why it degrades instead of demanding hardware
 *
 * The same code runs on a laptop with two outputs. If a 4-channel layout were
 * forced there, the click would be placed on a channel that does not exist and
 * simply vanish — silence, no error, on the machine most people use most of the
 * time. So the split is applied ONLY when the device genuinely has the outputs,
 * and otherwise everything folds back into the ordinary stereo mix.
 */

/** Lanes that get their own output channel when the hardware allows it. */
export type LiveOutputLane = 'song' | 'click' | 'cue'

export type LiveOutputMap = {
  /** True when lanes are genuinely separated across output channels. */
  split: boolean
  /** How many channels the destination should be opened with. */
  channelCount: number
  /**
   * Lane → destination channel indices (ZERO-based, as Web Audio wants).
   * In stereo fallback every lane maps to [0, 1] — i.e. the normal mix.
   */
  channels: Record<LiveOutputLane, number[]>
  /** Said plainly, for the rig page. */
  summary: string
}

/**
 * The layout, given what the sound card can actually do.
 *
 * `maxChannelCount` comes from `AudioContext.destination.maxChannelCount` — 18
 * on the XR18, 2 on built-in speakers.
 *
 * FOUR is the threshold, not eighteen: song (2) + click (1) + cue (1). Anything
 * that can do four can run the full rig, which keeps this working on small
 * interfaces rather than only on the one desk it was written for.
 */
export const MIN_SPLIT_CHANNELS = 4

/**
 * Is separating the lanes switched ON for this machine?
 *
 * DEFAULT OFF, and that default is not timidity — it is that the split path was
 * verified only in an `OfflineAudioContext`. Put in front of a real sound card
 * it silenced playback completely, which is a far worse failure than click and
 * song sharing a pair of channels. Sound that works beats separation that might.
 *
 * Turned on from the rig page once it has been proven against the actual
 * device. Per-machine, because it describes what the sound card in front of you
 * can do, not anything about the band.
 */
export const MULTICHANNEL_KEY = 'barbro::rig::multichannel'

export function multichannelEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(MULTICHANNEL_KEY) === '1'
  } catch {
    return false
  }
}

export function liveOutputMap(
  maxChannelCount: number,
  opts: { enabled?: boolean } = {},
): LiveOutputMap {
  const max = Number.isFinite(maxChannelCount) ? Math.floor(maxChannelCount) : 2
  const enabled = opts.enabled ?? multichannelEnabled()

  if (!enabled) {
    return {
      split: false,
      channelCount: Math.max(1, Math.min(2, max)),
      channels: { song: [0, 1], click: [0, 1], cue: [0, 1] },
      summary:
        'Everything leaves on one stereo pair. Separate channels for the click and the cues are switched off — turn them on once they are proven on this sound card.',
    }
  }

  if (max < MIN_SPLIT_CHANNELS) {
    return {
      split: false,
      channelCount: Math.max(1, Math.min(2, max)),
      // Everything shares the stereo pair — exactly today's behaviour.
      channels: { song: [0, 1], click: [0, 1], cue: [0, 1] },
      summary:
        'This output has only two channels, so the click and the cues travel mixed in with the song. They cannot be kept out of the front of house.',
    }
  }

  return {
    split: true,
    // Open every channel the device has. Unused ones stay silent, and a desk
    // that later wants per-stem channels needs them already open.
    channelCount: max,
    channels: { song: [0, 1], click: [2], cue: [3] },
    summary:
      'The song, the click and the cues each leave on their own channel, so the desk can put the click in the ears and keep it out of the house.',
  }
}

/**
 * The desk channel each lane arrives on, given where BarBro's stereo pair lands.
 *
 * The XR18 maps USB channel N to a mixer strip via `rtnsrc`, so if the song
 * occupies strips 9/10 then click and cue follow on 11 and 12. Returned as a
 * suggestion for the routing table — never written without the user seeing it,
 * because it moves real channels on a real desk.
 */
export function suggestedDeskChannels(
  songLeftChannel: number,
  map: LiveOutputMap,
): { song: number[]; click: number[]; cue: number[] } | null {
  if (!map.split) return null
  if (!Number.isInteger(songLeftChannel) || songLeftChannel < 1) return null
  const song = [songLeftChannel, songLeftChannel + 1]
  const click = [songLeftChannel + 2]
  const cue = [songLeftChannel + 3]
  // The XR18 has sixteen strips; a layout that runs off the end is not offered
  // rather than silently truncated.
  if (cue[0]! > 16) return null
  return { song, click, cue }
}

/**
 * The USB source index (zero-based) each lane should be read from on the desk.
 *
 * Mirrors `liveOutputMap` exactly: whatever channel BarBro puts a lane on is the
 * USB channel the desk must be pointed at. Kept as one function so the two sides
 * cannot drift — a mismatch here is silence with everything apparently correct.
 */
export function usbSourcesForLanes(map: LiveOutputMap): Record<LiveOutputLane, number[]> {
  return map.channels
}
