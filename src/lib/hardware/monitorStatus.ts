/**
 * IS EACH PERFORMER'S MONITOR ACTUALLY WORKING?
 *
 * ## Why this exists
 *
 * Before a show the only honest answer to "are the in-ears working" came from
 * asking everyone, one at a time, while they were still plugging in. BarBro
 * could show that a performer had a bus ASSIGNED — a fact about a config file —
 * and nothing at all about whether sound was leaving the desk.
 *
 * The desk knows. `/meters/1` reports the level on every channel and every bus,
 * so "audio is leaving aux 3" stops being a hope and becomes something the XR18
 * said. That is the strongest evidence available on this side of the XLR.
 *
 * ## What it deliberately does NOT claim
 *
 * A moving bus meter proves the desk is sending. It cannot prove the cable is
 * plugged in, the pack is powered, the pack's volume is up, or that anyone can
 * hear anything. So the states below stop at `sending` and never say "working".
 * The last link is a human saying yes, and no amount of OSC replaces it.
 *
 * This is the same discipline as `rigHealth.ts`: an unknown is never a pass.
 */

/** Where each thing sits in the desk's meter frame. Verified on a real XR18V2,
 *  which sends 40 values in an 84-byte blob. */
export const METER_INDEX = {
  /** Channels 1-16 are meter points 0-15. */
  firstChannel: 0,
  channelCount: 16,
  /** The six aux buses — the in-ear sends. */
  firstBus: 22,
  busCount: 6,
  /** Main L/R. */
  mainLeft: 28,
} as const

/**
 * Are the BUS meter positions in the table above proven against a live desk?
 *
 * FALSE since 2026-08-03: during the first working click-in-monitors session
 * the packs AUDIBLY carried signal while indices 22-27 read −128 the whole
 * time — so the bus block is very likely wrong (slots 16-21 are unaccounted
 * for and are the prime suspect). Until a rehearsal capture (/debug/meters)
 * proves the real positions, a bus-derived verdict is an UNKNOWN — never a
 * red fault (false reds train people to ignore red) and never a green
 * "sending" (a false green about someone's in-ears is worse). The CHANNEL
 * block (0-15) matched live behaviour all night and stays trusted.
 *
 * Flip to true ONLY together with corrected indices and their test.
 */
export const BUS_METER_INDEX_VERIFIED = false

/** Below this, the desk is reporting a noise floor rather than programme. */
export const SIGNAL_FLOOR_DB = -60

/** A meter older than this is not describing now. */
export const METER_STALE_MS = 3_000

export type MonitorState =
  /** The desk reports signal leaving this bus. */
  | 'sending'
  /**
   * The bus is silent WHILE THE SOURCE IS HOT — a send is genuinely broken.
   * Distinct from `idle`: with nothing playing, every bus is silent and that
   * is not a fault. A strip that shows three red dots at an idle desk trains
   * people to ignore red, which is the one thing a warning must never do.
   */
  | 'silent'
  /** Nothing is playing; levels will appear when the song runs. */
  | 'idle'
  /** No bus assigned to this performer yet. */
  | 'unassigned'
  /** The desk has not said — never treated as either of the above. */
  | 'unknown'

export type MonitorStatus = {
  performerId: string
  name: string
  role: string | null
  /** 1-6, or null when nobody has assigned one. */
  bus: number | null
  state: MonitorState
  /** Level in dB, or null when unknown. */
  levelDb: number | null
  /** Said plainly, for someone standing on a stage. */
  detail: string
}

export type MonitorPerformer = {
  id: string
  name: string
  role?: string | null
  monitorBus?: number | null
}

export function busLevelDb(levels: readonly number[] | null, bus: number): number | null {
  if (!levels) return null
  if (!Number.isInteger(bus) || bus < 1 || bus > METER_INDEX.busCount) return null
  const v = levels[METER_INDEX.firstBus + bus - 1]
  return typeof v === 'number' ? v : null
}

export function channelLevelDb(levels: readonly number[] | null, channel: number): number | null {
  if (!levels) return null
  if (!Number.isInteger(channel) || channel < 1 || channel > METER_INDEX.channelCount) return null
  const v = levels[METER_INDEX.firstChannel + channel - 1]
  return typeof v === 'number' ? v : null
}

/**
 * One row per performer, from the desk's own meters.
 *
 * `ageMs` decides whether the meters are describing now. A missing or stale
 * frame gives `unknown` for everyone rather than a screen full of reds — the
 * meter feed dropping is a different fault from six silent monitors, and
 * conflating them sends people hunting for cables that are fine.
 */
export function monitorStatuses(opts: {
  performers: readonly MonitorPerformer[]
  levels: readonly number[] | null
  ageMs: number | null
  /**
   * Is ANY source channel (song, click) carrying signal right now? Decides
   * whether a silent bus is a broken send (source hot, bus dead → red) or
   * just an idle desk (nothing playing → neutral).
   */
  sourceActive?: boolean
  /**
   * Override for tests and for the day the indices are re-proven. Defaults to
   * the module constant — callers should not pass this in production.
   */
  busIndexVerified?: boolean
}): MonitorStatus[] {
  const {
    performers,
    levels,
    ageMs,
    sourceActive = false,
    busIndexVerified = BUS_METER_INDEX_VERIFIED,
  } = opts
  const fresh = levels !== null && ageMs !== null && ageMs <= METER_STALE_MS

  return performers.map((p) => {
    const bus = Number.isInteger(p.monitorBus) && (p.monitorBus ?? 0) >= 1 ? p.monitorBus! : null
    const base = { performerId: p.id, name: p.name, role: p.role ?? null, bus }

    if (bus === null) {
      return {
        ...base,
        state: 'unassigned' as const,
        levelDb: null,
        detail: 'No monitor bus yet — pick one in Project settings.',
      }
    }
    if (!fresh) {
      return {
        ...base,
        state: 'unknown' as const,
        levelDb: null,
        detail:
          levels === null
            ? 'The desk has not sent any levels yet.'
            : 'The levels from the desk have stopped updating.',
      }
    }
    if (!busIndexVerified) {
      // The desk IS talking; it is OUR map of its meter frame that is in
      // doubt. Saying so beats a confident wrong answer in either colour.
      return {
        ...base,
        state: 'unknown' as const,
        levelDb: null,
        detail: `Bus levels can’t be trusted yet — the desk’s meter layout hasn’t been verified. Run the meter check (/debug/meters) at rehearsal.`,
      }
    }
    const levelDb = busLevelDb(levels, bus)
    if (levelDb === null) {
      return {
        ...base,
        state: 'unknown' as const,
        levelDb: null,
        detail: `The desk did not report a level for aux ${bus}.`,
      }
    }
    if (levelDb > SIGNAL_FLOOR_DB) {
      return {
        ...base,
        state: 'sending' as const,
        levelDb,
        detail: `Audio is leaving aux ${bus}. Confirm ${p.name} can actually hear it.`,
      }
    }
    if (!sourceActive) {
      return {
        ...base,
        state: 'idle' as const,
        levelDb,
        detail: 'Nothing is playing — levels appear when the song runs.',
      }
    }
    return {
      ...base,
      state: 'silent' as const,
      levelDb,
      detail: `The song is playing but nothing is leaving aux ${bus}. Check the sends and the bus master.`,
    }
  })
}

/** Two performers cannot share a bus — one of them will be turned down for both. */
export function duplicateBuses(performers: readonly MonitorPerformer[]): number[] {
  const seen = new Set<number>()
  const dupes = new Set<number>()
  for (const p of performers) {
    const b = p.monitorBus
    if (!Number.isInteger(b) || (b ?? 0) < 1) continue
    if (seen.has(b!)) dupes.add(b!)
    seen.add(b!)
  }
  return [...dupes].sort((a, b) => a - b)
}
