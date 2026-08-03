/**
 * What the rig page remembers between sessions.
 *
 * The desk's address and which channels carry BarBro do not change between
 * soundcheck and the show, and re-typing them at load-in is both slow and a
 * chance to get them wrong. So they persist.
 *
 * ## What is deliberately NOT persisted
 *
 * The CHECK RESULTS. A green tick from last week says nothing about tonight's
 * cables, and a checklist that starts already-passed is worse than no checklist
 * — it invites you to skip the one job it exists to make you do. Every session
 * starts unproven.
 *
 * Per-device, like the transpose overlay: this describes the rig in front of
 * you, not a property of the songs.
 */

export type RigSetup = {
  /** Desk address. */
  host: string
  port: number
  /** The channels carrying BarBro's stereo output. */
  leftCh: number
  rightCh: number
  /** Channels that must never reach the house — click and cues. */
  monitorOnly: string
  /**
   * Which output layout THIS machine uses (per-machine on purpose — it is a
   * property of this computer's sound device, not of the project).
   *
   * 'auto' — the default — DERIVES it from evidence instead of asking anyone
   * to remember a switch: multichannel when the sound device offers enough
   * channels AND a desk address is configured on this machine; stereo
   * otherwise. Channel count alone is not enough — an HDMI television reports
   * 6–8 channels, and auto-splitting there sends the click to a speaker that
   * does not exist. The explicit values remain as overrides for debugging.
   */
  profileRequest: 'auto' | 'stereo-passthrough' | 'stereo-sum' | 'multichannel'
  /**
   * THE one human step, remembered: strips for click/cue may be switched to
   * USB (which silences whatever sits on their analog jacks) only after a
   * person at the desk has confirmed the jacks are free — once. From then on
   * the routing applies itself on every connect.
   */
  splitStripsClaimed: boolean
}

export const RIG_SETUP_KEY = 'barbro::rig::setup'

export const DEFAULT_RIG_SETUP: RigSetup = {
  host: '',
  port: 10024,
  // BarBro sends plain stereo, so it lands on the first two USB returns of
  // whichever input block is switched to USB. 9/10 matches the lane map's
  // default for the full mix (see `defaultXAirChannelsForLane`).
  leftCh: 9,
  rightCh: 10,
  // Click and cue. Channels 15/16 — the XR18 has no 17/18 (that is the aux
  // return), so the old default pointed at addresses the desk ignores.
  monitorOnly: '15, 16',
  profileRequest: 'auto',
  splitStripsClaimed: false,
}

const PROFILES = ['auto', 'stereo-passthrough', 'stereo-sum', 'multichannel'] as const
function parseProfile(v: unknown): RigSetup['profileRequest'] {
  return (PROFILES as readonly string[]).includes(v as string)
    ? (v as RigSetup['profileRequest'])
    : DEFAULT_RIG_SETUP.profileRequest
}

/**
 * The 'auto' derivation, as a pure function so it can be tested and so the UI
 * and the engine cannot disagree about it. Returns the CONCRETE profile the
 * engine should run — never 'auto'.
 *
 * The two pieces of evidence, both required for the split:
 *  - the device carries ≥4 channels (a stereo laptop cannot split), AND
 *  - a desk address is saved on this machine (an HDMI TV has ≥4 channels but
 *    no desk — splitting there loses the click into a nonexistent speaker).
 */
export function resolveProfileRequest(
  setup: Pick<RigSetup, 'profileRequest' | 'host'>,
  deviceChannels: number,
): 'stereo-passthrough' | 'stereo-sum' | 'multichannel' {
  if (setup.profileRequest !== 'auto') return setup.profileRequest
  return deviceChannels >= 4 && setup.host.trim().length > 0
    ? 'multichannel'
    : 'stereo-passthrough'
}

const chan = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isInteger(n) && n >= 1 && n <= 16 ? n : fallback
}

/** Tolerant parse — a hand-edited or half-written value must not break the page. */
export function parseRigSetup(raw: string | null): RigSetup {
  if (!raw) return { ...DEFAULT_RIG_SETUP }
  try {
    const o = JSON.parse(raw) as Partial<RigSetup>
    const port =
      typeof o.port === 'number' && o.port >= 1 && o.port <= 65535
        ? o.port
        : DEFAULT_RIG_SETUP.port
    return {
      host: typeof o.host === 'string' ? o.host.trim() : '',
      port,
      leftCh: chan(o.leftCh, DEFAULT_RIG_SETUP.leftCh),
      rightCh: chan(o.rightCh, DEFAULT_RIG_SETUP.rightCh),
      monitorOnly:
        typeof o.monitorOnly === 'string' ? o.monitorOnly : DEFAULT_RIG_SETUP.monitorOnly,
      profileRequest: parseProfile(o.profileRequest),
      splitStripsClaimed: o.splitStripsClaimed === true,
    }
  } catch {
    return { ...DEFAULT_RIG_SETUP }
  }
}

/**
 * Channels that no longer exist, and what they became.
 *
 * Click and cue used to default to 17/18. The XR18 has no such channels — that
 * is the aux return — so those writes went nowhere, silently. The defaults moved
 * to 15/16, but a setup SAVED before that still says "17, 18", and the parser
 * now drops them as out of range.
 *
 * Dropping them is the dangerous outcome: an empty monitor-only list makes the
 * front-of-house safety check pass with nothing to check, which reads as "click
 * is safely off the house" when it was never looked at. So they are migrated
 * rather than discarded.
 */
const RETIRED_CHANNELS: Record<number, number> = { 17: 15, 18: 16 }

/** The monitor-only channel numbers, from the free-text field. */
export function parseMonitorChannels(text: string): number[] {
  const seen = new Set<number>()
  for (const part of text.split(/[,\s]+/)) {
    const n = Number.parseInt(part, 10)
    if (!Number.isInteger(n)) continue
    const migrated = RETIRED_CHANNELS[n] ?? n
    if (migrated >= 1 && migrated <= 16) seen.add(migrated)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * Problems worth refusing to test on, in the user's words.
 *
 * Returned as a list rather than a boolean so the page can show the reason —
 * "Test" being greyed out with no explanation is its own kind of friction.
 */
export function rigSetupProblems(setup: RigSetup): string[] {
  const out: string[] = []
  if (setup.leftCh === setup.rightCh) {
    out.push('Left and right are the same channel — set the pair BarBro actually lands on.')
  }
  const monitor = parseMonitorChannels(setup.monitorOnly)
  const overlap = monitor.filter((c) => c === setup.leftCh || c === setup.rightCh)
  if (overlap.length > 0) {
    // Sending the music to a channel you then take off the house is a silent
    // front-of-house, discovered when the first song starts.
    out.push(
      `Channel ${overlap.join(', ')} carries BarBro AND is marked monitor-only — the house would get no music.`,
    )
  }
  return out
}

export function loadRigSetup(): RigSetup {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_RIG_SETUP }
  try {
    return parseRigSetup(localStorage.getItem(RIG_SETUP_KEY))
  } catch {
    return { ...DEFAULT_RIG_SETUP }
  }
}

export function saveRigSetup(setup: RigSetup): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(RIG_SETUP_KEY, JSON.stringify(setup))
  } catch {
    /* private mode — remembering is best-effort */
  }
}
