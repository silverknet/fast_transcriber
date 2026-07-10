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
      throw new Error('XR18 channels must be numbers 1..18')
    }
    const channel = Number.parseInt(trimmed, 10)
    if (!Number.isInteger(channel) || channel < 1 || channel > 18) {
      throw new Error('XR18 channels must be numbers 1..18')
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

export function defaultXAirChannelsForLane(laneKey: string): number[] {
  if (laneKey === 'original') return [17, 18]
  if (laneKey === 'click') return [15]
  if (laneKey === 'cue') return [16]
  return []
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

function sanitizeXAirChannels(channels: readonly number[]): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const channel of channels) {
    if (!Number.isInteger(channel) || channel < 1 || channel > 18 || seen.has(channel)) continue
    seen.add(channel)
    out.push(channel)
  }
  return out
}
