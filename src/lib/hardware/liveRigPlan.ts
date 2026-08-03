/**
 * THE LIVE SIGNAL CHAIN — derived once, in one place.
 *
 * ## The disease this cures
 *
 * The same fact was written down in six places and nothing forced them to
 * agree, so they drifted. Measured in the repository, not imagined:
 *
 *  - `liveOutputMap` said the click leaves on output channel 2.
 *    `defaultXAirChannelsForLane` said the click arrives on desk channel 15.
 *    Both shipped. Neither knew about the other.
 *  - `suggestedDeskChannels` and `liveUsbPlan` were byte-equivalent copies of
 *    one layout rule, and BOTH were dead code.
 *  - Production ignored all of them and hard-coded USB sources 1 and 2.
 *  - Two separate "keep these off the house" lists issued real `/mix/lr` writes
 *    from two different pages.
 *  - The default lane table was not injective: `stem:other` claimed channels
 *    15 and 16, which were also click and cue.
 *
 * The result on a real desk: channel 15 was dutifully taken off the house — a
 * channel carrying silence — while the actual click rode inside the song's own
 * pair straight to the PA. Every status light was honest about a fact that was
 * irrelevant.
 *
 * ## The cure
 *
 * One invariant makes the drift unrepresentable:
 *
 *     deskChannel === firstDeskChannel + webAudioChannel
 *     usbSource   === webAudioChannel
 *
 * Both sides of the USB link are read off the same record, so "output channel 2
 * but desk channel 15" cannot be written down. Everything else — the desk
 * writes, the FOH plan, the audio graph — is a projection of this.
 *
 * ## What is deliberately NOT an input
 *
 * The loaded song. An earlier sketch took the mixer's lanes, which would have
 * made USB routing and house assignments a function of whichever song was open
 * — so loading the next song mid-set would re-write `rtnsrc` on live channels
 * and move house assignments under the band. The LAYOUT is the electrical
 * contract for the whole set: written once at load-in, verified, then frozen.
 * Which lane's audio enters which slot is `slotForLane`, a per-song projection
 * that touches Web Audio connections only and cannot move a desk channel.
 */

/** The XR18 has SIXTEEN channel strips. `/ch/17` and `/ch/18` do not exist. */
export const XAIR_MAX_CHANNEL = 16

/** Six aux buses, and they are MONO (`/config/buslink` = 0,0,0 on a real desk). */
export const MONITOR_BUS_COUNT = 6

export type RigProfile =
  /** Everything mixed, two channels — today's behaviour, and the default. */
  | 'stereo-passthrough'
  /** Song summed to mono on one channel, click + cues on the other. */
  | 'stereo-sum'
  /** Song in stereo, click and cues on their own channels. */
  | 'multichannel'

export type SlotRole = 'program' | 'click' | 'cue' | 'monitor'

/** One output channel, and everything true about it. Exactly one channel. */
export type RigSlot = {
  id: string
  role: SlotRole
  /** 1-based, as printed on the desk. */
  deskChannel: number
  /** Zero-based, for `/ch/NN/config/rtnsrc`. */
  usbSource: number
  /** Zero-based, for the Web Audio merger. */
  webAudioChannel: number
  /** Assigned to the main L/R bus — i.e. audible in the house. */
  house: boolean
  /** Shown to a person standing at a desk. */
  label: string
}

export type MonitorAssignment = {
  performerId: string
  name: string
  /** 1-6. */
  bus: number
}

export type RigLayout = {
  profile: RigProfile
  /** Why this profile and not the requested one. Empty when it was honoured. */
  reason: string
  slots: RigSlot[]
  /** Channels to open on the destination. NEVER `maxChannelCount`. */
  requiredOutputChannels: number
  monitors: MonitorAssignment[]
  /** Things a person must fix, in their words. Empty when the rig is coherent. */
  problems: string[]
}

export type RigPerformer = {
  id: string
  name: string
  monitorBus?: number | null
}

export type RigLayoutInput = {
  /** What the user asked for. */
  profileRequest?: RigProfile
  /** `AudioContext.destination.maxChannelCount` for the SELECTED output. */
  deviceChannels?: number
  /** Desk channel BarBro's first output lands on. */
  firstDeskChannel?: number
  performers?: readonly RigPerformer[]
}

/** Slot shapes per profile, before they are placed on the desk. */
type SlotSeed = { id: string; role: SlotRole; house: boolean; label: string }

const SEEDS: Record<RigProfile, SlotSeed[]> = {
  'stereo-passthrough': [
    { id: 'program-l', role: 'program', house: true, label: 'Song L' },
    { id: 'program-r', role: 'program', house: true, label: 'Song R' },
  ],
  'stereo-sum': [
    { id: 'program', role: 'program', house: true, label: 'Song (mono)' },
    // Click AND cues share this one. It is off the house, which is the entire
    // point of the profile: the band hears the click, the room never does.
    { id: 'monitor', role: 'monitor', house: false, label: 'Click + cues' },
  ],
  multichannel: [
    { id: 'program-l', role: 'program', house: true, label: 'Song L' },
    { id: 'program-r', role: 'program', house: true, label: 'Song R' },
    { id: 'click', role: 'click', house: false, label: 'Click' },
    { id: 'cue', role: 'cue', house: false, label: 'Cues' },
  ],
}

/** Channels each profile needs on the output device. */
export function channelsForProfile(profile: RigProfile): number {
  return SEEDS[profile].length
}

/**
 * Which profile can actually run here, and why.
 *
 * Degrades rather than demanding hardware, and SAYS SO. A layout that silently
 * fell back would put the click on a channel that does not exist, where it
 * vanishes without an error — on a laptop, which is what most people use most
 * of the time.
 */
export function resolveRigProfile(
  request: RigProfile,
  deviceChannels: number,
): { profile: RigProfile; reason: string } {
  const have = Number.isFinite(deviceChannels) ? Math.floor(deviceChannels) : 2
  const need = channelsForProfile(request)
  if (have >= need) return { profile: request, reason: '' }
  if (request === 'multichannel') {
    // Two channels can still separate the click — by summing the song to mono.
    // Offered rather than taken: it costs the house a stereo backing track.
    return {
      profile: 'stereo-passthrough',
      reason: `This sound output has ${have} channels, so the song, the click and the cues travel mixed together and the click cannot be kept out of the house. Choose the mixer as the computer's sound output, or switch to the mono-song layout.`,
    }
  }
  return {
    profile: 'stereo-passthrough',
    reason: `This sound output has ${have} channels, which is not enough to separate the click.`,
  }
}

/**
 * The whole electrical contract, derived once.
 *
 * Returns problems in words rather than throwing: at load-in the useful thing
 * is a layout you can look at plus a list of what is wrong with it, not an
 * exception.
 */
export function liveRigLayout(input: RigLayoutInput = {}): RigLayout {
  const request = input.profileRequest ?? 'stereo-passthrough'
  const deviceChannels = input.deviceChannels ?? 2
  const { profile, reason } = resolveRigProfile(request, deviceChannels)

  const rawFirst = input.firstDeskChannel ?? 9
  const first = Number.isInteger(rawFirst) && rawFirst >= 1 ? rawFirst : 9
  const seeds = SEEDS[profile]
  const problems: string[] = []

  if (!Number.isInteger(rawFirst) || rawFirst < 1) {
    problems.push(`Channel ${rawFirst} is not a channel on this desk. Using ${first}.`)
  }

  // THE INVARIANT. Desk channel, USB source and output channel all come from
  // one index, so they cannot disagree.
  const slots: RigSlot[] = seeds.map((s, i) => ({
    ...s,
    webAudioChannel: i,
    usbSource: i,
    deskChannel: first + i,
  }))

  const last = slots[slots.length - 1]
  if (last && last.deskChannel > XAIR_MAX_CHANNEL) {
    // Refused, not truncated: a slot past channel 16 is written to an address
    // the desk does not have, and X-Air ignores those in silence.
    problems.push(
      `This layout needs channels ${first}-${last.deskChannel}, but the desk stops at ${XAIR_MAX_CHANNEL}. Start it at channel ${XAIR_MAX_CHANNEL - slots.length + 1} or lower.`,
    )
  }

  // ── Monitors ────────────────────────────────────────────────────────────
  const performers = input.performers ?? []
  const monitors: MonitorAssignment[] = []
  const takenBy = new Map<number, string>()
  for (const p of performers) {
    const bus = p.monitorBus
    if (!Number.isInteger(bus) || (bus ?? 0) < 1) continue
    if (bus! > MONITOR_BUS_COUNT) {
      problems.push(`${p.name} is on monitor ${bus}, but this desk has ${MONITOR_BUS_COUNT}.`)
      continue
    }
    const already = takenBy.get(bus!)
    if (already) {
      // Sharing a bus is not a small thing: turning one person down turns the
      // other down too, and neither can be fixed without moving someone.
      problems.push(`${already} and ${p.name} are both on monitor ${bus} — they cannot have different mixes.`)
      continue
    }
    takenBy.set(bus!, p.name)
    monitors.push({ performerId: p.id, name: p.name, bus: bus! })
  }
  const unassigned = performers.filter(
    (p) => !Number.isInteger(p.monitorBus) || (p.monitorBus ?? 0) < 1,
  )
  if (unassigned.length > 0 && performers.length > MONITOR_BUS_COUNT) {
    problems.push(
      `There are ${performers.length} performers and only ${MONITOR_BUS_COUNT} monitor mixes, so ${unassigned.length} of them cannot have their own.`,
    )
  }

  monitors.sort((a, b) => a.bus - b.bus)

  return {
    profile,
    reason,
    slots,
    requiredOutputChannels: slots.length,
    monitors,
    problems,
  }
}

// ── Selectors. Everything downstream reads THESE, never its own opinion. ────

/** Desk channels that must be OFF the main bus. Feeds the FOH plan. */
export function slotsOffHouse(layout: RigLayout): number[] {
  return layout.slots.filter((s) => !s.house).map((s) => s.deskChannel)
}

/** Desk channels that belong ON the main bus. */
export function slotsOnHouse(layout: RigLayout): number[] {
  return layout.slots.filter((s) => s.house).map((s) => s.deskChannel)
}

/** Which USB channel each desk strip must listen to. */
export function usbWritePlan(layout: RigLayout): { channel: number; usbSource: number }[] {
  return layout.slots.map((s) => ({ channel: s.deskChannel, usbSource: s.usbSource }))
}

/**
 * Which slot a lane's audio enters — the per-song projection.
 *
 * Falls back rather than dropping audio: with no click slot the click is mixed
 * into the programme, which is exactly today's behaviour and audible, instead
 * of routed to a channel that does not exist and silent.
 */
export function slotForLane(layout: RigLayout, laneKey: string): RigSlot | null {
  const byRole = (r: SlotRole) => layout.slots.find((s) => s.role === r) ?? null
  if (laneKey === 'click') return byRole('click') ?? byRole('monitor') ?? byRole('program')
  if (laneKey === 'cue') return byRole('cue') ?? byRole('monitor') ?? byRole('program')
  return byRole('program')
}

/**
 * Output channels a lane leaves on.
 *
 * When a lane lands on the PROGRAMME it takes every programme channel, not just
 * the first. Returning one channel here put the click on the left side only —
 * the same one-eared failure the mono aux buses produce, arriving by a
 * different route, and caught by its own test rather than on a stage.
 */
export function outputChannelsForLane(layout: RigLayout, laneKey: string): number[] {
  const slot = slotForLane(layout, laneKey)
  if (!slot) return []
  if (slot.role === 'program') {
    return layout.slots.filter((s) => s.role === 'program').map((s) => s.webAudioChannel)
  }
  return [slot.webAudioChannel]
}

/** Is the click genuinely kept out of the room in this layout? */
export function clickIsOutOfHouse(layout: RigLayout): boolean {
  const slot = slotForLane(layout, 'click')
  return slot !== null && !slot.house
}
