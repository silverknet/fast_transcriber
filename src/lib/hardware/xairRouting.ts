
/** The XR18 has SIXTEEN channel strips. 17/18 is the aux return, not a channel. */
export const XAIR_MAX_CHANNEL = 16

/**
 * Fader position meaning UNITY on an X-Air (0 dB).
 *
 * NOT 1.0, and not the same thing as a linear gain of 0.75. The desk's fader
 * scale is a four-segment dB curve; `xairFaderFromLinearGain` is the only
 * correct way to turn a BarBro level into one of these.
 */
export const XAIR_UNITY_FADER = 0.75
export type XAirLaneRoute = {
  laneKey: string
  channels: number[]
  followVolume: boolean
  followMute: boolean
}

export type XAirLiveLane = {
  key: string
  label: string
  volume: number
  muted: boolean
  soloed: boolean
}

export type XAirLaneWrite =
  | { kind: 'channel-fader'; channel: number; value: number }
  | { kind: 'channel-on'; channel: number; on: boolean }

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

// ── X Air fader law ─────────────────────────────────────────────────────────
// XR18 fader positions are NOT linear gain: the X32/X Air fader curve puts
// unity (0 dB) at 0.75 and +10 dB at 1.0. Sending BarBro's linear lane gain
// (1.0 = unity) straight through would slam the PA channel to +10 dB — the
// loudest possible live-sound bug. Convert linear gain → dB → fader position.
// Curve (per the X32/X Air OSC documentation):
//   f ≥ 0.5    : dB = f·40 − 30      (0.75 → 0 dB, 1.0 → +10 dB)
//   f ≥ 0.25   : dB = f·80 − 50
//   f ≥ 0.0625 : dB = f·160 − 70
//   f < 0.0625 : dB = f·480 − 90     (0 → −90 dB ≈ −∞)

export function xairDbToFader(db: number): number {
  if (!Number.isFinite(db)) return 0
  if (db >= -10) return clamp01((db + 30) / 40)
  if (db >= -30) return clamp01((db + 50) / 80)
  if (db >= -60) return clamp01((db + 70) / 160)
  return clamp01((db + 90) / 480)
}

export function xairFaderToDb(fader: number): number {
  const f = clamp01(fader)
  if (f >= 0.5) return f * 40 - 30
  if (f >= 0.25) return f * 80 - 50
  if (f >= 0.0625) return f * 160 - 70
  return f * 480 - 90
}

/** BarBro linear lane gain (1.0 = unity, ≤1.5) → X Air fader position. */
export function xairFaderFromLinearGain(gain: number): number {
  const g = Number.isFinite(gain) ? Math.max(0, gain) : 0
  if (g <= 0.0001) return 0
  return xairDbToFader(20 * Math.log10(g))
}

export function parseXAirChannelList(input: string): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const part of input.split(/[,\s]+/)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`XR18 channels must be numbers 1..${XAIR_MAX_CHANNEL}`)
    }
    const channel = Number.parseInt(trimmed, 10)
    if (!Number.isInteger(channel) || channel < 1 || channel > XAIR_MAX_CHANNEL) {
      throw new Error(`XR18 channels must be numbers 1..${XAIR_MAX_CHANNEL}`)
    }
    if (!seen.has(channel)) {
      seen.add(channel)
      out.push(channel)
    }
  }
  return out
}

export function formatXAirChannelList(channels: readonly number[]): string {
  return channels.join(', ')
}

/** The XR18 channel pair a stem lane defaults to (live-rig contract: stems on 9-16). */
function stemPairForLaneKey(laneKey: string): number[] | null {
  if (!laneKey.startsWith('stem:')) return null
  const rest = laneKey.slice('stem:'.length).toLowerCase()
  if (/drum/.test(rest)) return [9, 10]
  if (/bass/.test(rest)) return [11, 12]
  if (/vocal/.test(rest)) return [13, 14]
  if (/other/.test(rest)) return [15, 16]
  return null
}

/**
 * Default XR18 channels per BarBro lane, per the live-rig channel contract:
 * click → ch 15, cue → ch 16 (the two MONITOR-ONLY channels that must never hit
 * the house), stems on 9-16 stereo pairs, and the full mix as the 9/10 fallback.
 * All configurable in the UI; these are just safe starting points.
 */
/**
 * The XR18 has SIXTEEN channels. `/ch/17` and `/ch/18` DO NOT EXIST — verified
 * against a real XR18V2 (fw 1.19), which answers `/ch/16/mix/fader` and stays
 * silent for 17 and 18.
 *
 * Click and cue used to be routed to 17 and 18, so every write went to an
 * address the desk does not have. X-AIR ignores unknown addresses with no reply
 * and no error, so this failed completely silently — the FOH-safety check only
 * appeared to pass because a channel missing from the read-back counts as
 * unsafe rather than as absent.
 *
 * They now sit on real channels: 15 and 16, the top of the strip and the least
 * likely to be wanted for a microphone.
 */

export function defaultXAirChannelsForLane(laneKey: string): number[] {
  if (laneKey === 'click') return [15]
  if (laneKey === 'cue') return [16]
  if (laneKey === 'original') return [9, 10]
  return stemPairForLaneKey(laneKey) ?? []
}

/**
 * A lane whose audio must be MONITOR-ONLY — heard in the performers' in-ears but
 * NEVER in the front-of-house mix. Click ends the show if it reaches the house;
 * spoken cues are for the band only. Everything else is musical (FOH-ok).
 */
export function isMonitorOnlyLane(laneKey: string): boolean {
  return laneKey === 'click' || laneKey === 'cue'
}

export function hasAnySoloedLane(lanes: readonly XAirLiveLane[]): boolean {
  return lanes.some((lane) => lane.soloed)
}

export function xairLaneAudible(lane: XAirLiveLane, lanes: readonly XAirLiveLane[]): boolean {
  if (lane.muted) return false
  const anySoloed = hasAnySoloedLane(lanes)
  if (anySoloed && !lane.soloed) return false
  return lane.volume > 0.001
}

export function ensureXAirRoutesForLanes(
  routes: readonly XAirLaneRoute[],
  lanes: readonly XAirLiveLane[],
): XAirLaneRoute[] {
  const next: XAirLaneRoute[] = routes.map((route) => ({
    laneKey: route.laneKey,
    channels: sanitizeXAirChannels(route.channels),
    followVolume: route.followVolume,
    followMute: route.followMute,
  }))
  const byKey = new Map(next.map((route) => [route.laneKey, route]))
  for (const lane of lanes) {
    if (byKey.has(lane.key)) continue
    const route = {
      laneKey: lane.key,
      channels: defaultXAirChannelsForLane(lane.key),
      followVolume: true,
      followMute: true,
    }
    next.push(route)
    byKey.set(lane.key, route)
  }
  return next
}

export function buildXAirLaneWrites(
  lanes: readonly XAirLiveLane[],
  routes: readonly XAirLaneRoute[],
): XAirLaneWrite[] {
  const laneByKey = new Map(lanes.map((lane) => [lane.key, lane]))
  const writes: XAirLaneWrite[] = []
  for (const route of routes) {
    const lane = laneByKey.get(route.laneKey)
    if (!lane) continue
    const channels = sanitizeXAirChannels(route.channels)
    if (channels.length === 0) continue
    const on = xairLaneAudible(lane, lanes)
    for (const channel of channels) {
      if (route.followVolume) {
        // Through the fader law — BarBro unity (1.0) lands at 0 dB (0.75),
        // never at the console's +10 dB ceiling.
        writes.push({ kind: 'channel-fader', channel, value: xairFaderFromLinearGain(lane.volume) })
      }
      if (route.followMute) {
        writes.push({ kind: 'channel-on', channel, on })
      }
    }
  }
  return writes
}

export function xairWriteSignature(writes: readonly XAirLaneWrite[]): string {
  return writes
    .map((write) =>
      write.kind === 'channel-fader'
        ? `f:${write.channel}:${write.value.toFixed(4)}`
        : `o:${write.channel}:${write.on ? 1 : 0}`,
    )
    .join('|')
}

/**
 * Diff a planned write set against the last values actually sent, returning
 * only the writes that CHANGED. Live stability: a single knob move must not
 * re-send every mapped channel (UDP spam + stomping FOH moves on unrelated
 * channels). `sentState` maps `f:<ch>` / `o:<ch>` → last sent value.
 */
export function diffXAirLaneWrites(
  writes: readonly XAirLaneWrite[],
  sentState: ReadonlyMap<string, string>,
): { changed: XAirLaneWrite[]; nextState: Map<string, string> } {
  const nextState = new Map(sentState)
  const changed: XAirLaneWrite[] = []
  for (const write of writes) {
    const key = write.kind === 'channel-fader' ? `f:${write.channel}` : `o:${write.channel}`
    const value = write.kind === 'channel-fader' ? write.value.toFixed(4) : write.on ? '1' : '0'
    if (nextState.get(key) === value) continue
    nextState.set(key, value)
    changed.push(write)
  }
  return { changed, nextState }
}

// ── FOH safety: keep monitor-only channels (click/cue) OFF the main/LR bus ────

export type XAirMainAssignWrite = { kind: 'channel-main-assign'; channel: number; on: boolean }

/**
 * The main/LR assignments that make a show house-safe: every channel carrying a
 * MONITOR-ONLY lane (click/cue) is taken OFF the main bus (`on:false`), while
 * every other routed channel is assigned ON. If a channel carries both (a
 * misconfiguration), monitor-only WINS — safety over convenience. Derived from
 * the user's routes so it always tracks their channel choices.
 */
export function xairFohSafetyPlan(routes: readonly XAirLaneRoute[]): XAirMainAssignWrite[] {
  const monitorOnly = new Set<number>()
  const musical = new Set<number>()
  for (const route of routes) {
    const target = isMonitorOnlyLane(route.laneKey) ? monitorOnly : musical
    for (const channel of sanitizeXAirChannels(route.channels)) target.add(channel)
  }
  const writes: XAirMainAssignWrite[] = []
  for (const channel of [...new Set([...monitorOnly, ...musical])].sort((a, b) => a - b)) {
    writes.push({ kind: 'channel-main-assign', channel, on: !monitorOnly.has(channel) })
  }
  return writes
}

/**
 * From a desk READBACK, which monitor-only channels are NOT yet house-safe: any
 * channel carrying click/cue whose `/mix/lr` assign is not proven to be OFF.
 * `mainAssignByChannel` maps channel → current LR assign (true = on the main bus).
 * CRITICAL: an unread channel (missing from the map) is treated as UNSAFE — we
 * never claim "house safe" without proof from the console.
 */
export type FohVerdict = {
  safe: boolean
  unsafeChannels: number[]
  /** The monitor-only channels this verdict actually examined. */
  checkedChannels: number[]
  /** Why it is not safe. Empty when it is. */
  reason: string
}

export function verifyFohSafe(
  routes: readonly XAirLaneRoute[],
  mainAssignByChannel: ReadonlyMap<number, boolean>,
): FohVerdict {
  const monitorOnly = new Set<number>()
  for (const route of routes) {
    if (!isMonitorOnlyLane(route.laneKey)) continue
    for (const channel of sanitizeXAirChannels(route.channels)) monitorOnly.add(channel)
  }
  const checkedChannels = [...monitorOnly].sort((a, b) => a - b)

  // NOTHING TO CHECK IS NOT SAFE.
  //
  // This returned `{safe: true}` when no lane carried click or cues, and that
  // was the single most dangerous line in the live rig: click is not absent in
  // that situation, it is travelling INSIDE the song's own stereo pair — which
  // is assigned to the house by design. So the check reported "click is off the
  // house" precisely when click was in the PA, and had examined nothing to say
  // so. Every analysed song has a click track, so zero monitor-only channels
  // means the rig is mis-wired, never that there is no click.
  if (checkedChannels.length === 0) {
    return {
      safe: false,
      unsafeChannels: [],
      checkedChannels: [],
      reason:
        'No channel is carrying the click or the cues, so nothing was checked. They are most likely travelling inside the song channels — which go to the house.',
    }
  }

  const unsafeChannels: number[] = []
  for (const channel of checkedChannels) {
    // `!== false` on purpose: a channel MISSING from the read-back is unsafe.
    // We never claim house-safe without the desk having said so.
    if (mainAssignByChannel.get(channel) !== false) unsafeChannels.push(channel)
  }
  return {
    safe: unsafeChannels.length === 0,
    unsafeChannels,
    checkedChannels,
    reason:
      unsafeChannels.length === 0
        ? ''
        : `Still going to the house: channel ${unsafeChannels.join(', ')}.`,
  }
}

// ── Monitor mixes: per-performer aux-bus sends (the in-ear mixes) ─────────────

/** One performer's in-ear monitor mix on an XR18 aux bus (1-6). */
export type XAirMonitorMix = {
  performerId: string
  bus: number
  /** laneKey → BarBro linear send level (1.0 = unity), through the fader law. */
  sends: Record<string, number>
  /** Optional bus-master linear level. */
  master?: number
}

export type XAirBusWrite =
  | { kind: 'bus-send'; channel: number; bus: number; value: number }
  | { kind: 'bus-fader'; bus: number; value: number }

/**
 * Aux-bus send writes for the per-performer monitor mixes: each lane's send level
 * (through the fader law, so unity lands at 0 dB not +10) is written to every
 * channel that lane routes to, on that mix's bus. Optional bus master.
 */
export function buildXAirBusSends(
  routes: readonly XAirLaneRoute[],
  mixes: readonly XAirMonitorMix[],
): XAirBusWrite[] {
  const channelsByLane = new Map(routes.map((r) => [r.laneKey, sanitizeXAirChannels(r.channels)]))
  const writes: XAirBusWrite[] = []
  for (const mix of mixes) {
    if (!Number.isInteger(mix.bus) || mix.bus < 1 || mix.bus > 6) continue
    for (const [laneKey, level] of Object.entries(mix.sends)) {
      const channels = channelsByLane.get(laneKey)
      if (!channels || channels.length === 0) continue
      const value = xairFaderFromLinearGain(level)
      for (const channel of channels) writes.push({ kind: 'bus-send', channel, bus: mix.bus, value })
    }
    if (mix.master != null) {
      writes.push({ kind: 'bus-fader', bus: mix.bus, value: xairFaderFromLinearGain(mix.master) })
    }
  }
  return writes
}

/** Diff bus writes against the last-sent state (same spam-guard as the lane writes). */
export function diffXAirBusWrites(
  writes: readonly XAirBusWrite[],
  sentState: ReadonlyMap<string, string>,
): { changed: XAirBusWrite[]; nextState: Map<string, string> } {
  const nextState = new Map(sentState)
  const changed: XAirBusWrite[] = []
  for (const write of writes) {
    const key = write.kind === 'bus-send' ? `b:${write.channel}:${write.bus}` : `bf:${write.bus}`
    const value = write.value.toFixed(4)
    if (nextState.get(key) === value) continue
    nextState.set(key, value)
    changed.push(write)
  }
  return { changed, nextState }
}

function sanitizeXAirChannels(channels: readonly number[]): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const channel of channels) {
    if (!Number.isInteger(channel) || channel < 1 || channel > XAIR_MAX_CHANNEL || seen.has(channel)) continue
    seen.add(channel)
    out.push(channel)
  }
  return out
}
