/**
 * Live-performance mapping for the Akai APC Key 25 Mk2.
 *
 * Two layers:
 *   1. LEARNABLE buttons — Play, Stop, Prev/Next song, Replay-once, Loop. The
 *      user assigns each to whatever control they like via MIDI-learn (press the
 *      button you want). Defaults follow Ableton conventions.
 *   2. FIXED pad/button grid — the BOTTOM pad row (0–7) AND the 8 round track
 *      buttons toggle the first eight slots. The first two pads of the row above
 *      are Custom 1/2, giving ten lane controls in a FIXED canonical order
 *      (`CANONICAL_LIVE_SLOTS` / `laneSlotIndex`) so a given stem is ALWAYS the
 *      same button, every song. The remaining 30 pads are the current song's
 *      sections (tap to jump).
 */
import type { ApcKey25Action } from './apcKey25'

/** Live state pushed back to the controller's LEDs so the pads mirror the app. */
export type LiveLedState = {
  playing: boolean
  loopActive: boolean
  replayArmed: boolean
  canReplay: boolean
  canPrev: boolean
  canNext: boolean
  /**
   * The 10 live-toggleable lanes in FIXED canonical slots (index 0-9 = the same
   * instrument every song; `null` = that slot has no lane in this song). Painted
   * on the pad grid; slots 0-7 are also mirrored on the 8 track buttons.
   */
  lanes: ({ on: boolean; kind: 'stem' | 'cue' | 'click' } | null)[]
  /** SectionKind per section index (length = section count, capped at 30). */
  sectionKinds: string[]
  /** Index of the currently-playing section (-1 = none). */
  currentSection: number
  /** Index of a section queued to launch (-1 = none). */
  queuedSection: number
  /** A song just auto-loaded and is waiting for you to start it (play blinks). */
  awaitingStart: boolean
  /** Beat phase gate for the current-section blink (true = on-beat/bright). */
  beatOn: boolean
}

/**
 * SectionKind → APC Key 25 palette velocity, chosen to echo BarBro's on-screen
 * section colours (intro purple, verse blue, chorus amber, solo red, …).
 */
export const SECTION_KIND_VELOCITY: Record<string, number> = {
  intro: 48, // purple
  verse: 41, // blue
  preChorus: 37, // cyan
  chorus: 13, // yellow
  bridge: 21, // green (distinct from the yellow chorus)
  solo: 5, // red (rose)
  riff: 9, // orange
  break: 3, // white
  outro: 53, // magenta (fuchsia)
  custom: 117, // grey
}
export const SECTION_DEFAULT_VELOCITY = 117

/** Bottom-row lane colours (bright when on, dim when off). */
export const STEM_ON_VELOCITY = 37 // #00A9FF (bright azure-turquoise)
export const CUE_ON_VELOCITY = 9 // #FF5400 (orange) — spoken cues
export const CLICK_ON_VELOCITY = 3 // #FFFFFF (white) — click / metronome
export const ABSENT_LANE_VELOCITY = 5 // #FF0000 (red), always sent at dim brightness

export type LiveLanePadLed = Readonly<{
  velocity: number
  dimmed: boolean
}>

/** Keep every live pad legible: dim red means the song has no lane there. */
export function liveLanePadLed(
  lane: LiveLedState['lanes'][number],
): LiveLanePadLed {
  if (!lane) return { velocity: ABSENT_LANE_VELOCITY, dimmed: true }
  const velocity =
    lane.kind === 'cue'
      ? CUE_ON_VELOCITY
      : lane.kind === 'click'
        ? CLICK_ON_VELOCITY
        : STEM_ON_VELOCITY
  return { velocity, dimmed: !lane.on }
}

/** A high-level live action, device-independent. */
export type LiveCommand =
  | { type: 'play-pause' }
  | { type: 'stop' }
  | { type: 'prev-song' }
  | { type: 'next-song' }
  | { type: 'replay-once' }
  | { type: 'loop' }
  | { type: 'announce-song' }
  | { type: 'toggle-stem'; index: number }
  | { type: 'jump-section'; index: number }
  /** Chord-jam voices as a live instrument: drop the arp in for a chorus, etc. */
  | { type: 'toggle-jam'; voice: 'keys' | 'bass' | 'arp' }
  /** Step the arp 1/4 → 1/8 → 1/16 → 1/4 without leaving the controller. */
  | { type: 'cycle-arp-rate' }

/** The learnable button actions (everything except the positional pad grid). */
export type LiveAction =
  | 'play-pause'
  | 'stop'
  | 'prev-song'
  | 'next-song'
  | 'replay-once'
  | 'loop'
  | 'announce-song'
  | 'jam-keys'
  | 'jam-bass'
  | 'jam-arp'
  | 'jam-arp-rate'

export const LIVE_ACTIONS: ReadonlyArray<{ id: LiveAction; label: string }> = [
  { id: 'play-pause', label: 'Play / pause' },
  { id: 'stop', label: 'Stop' },
  { id: 'prev-song', label: 'Previous song' },
  { id: 'next-song', label: 'Next song' },
  { id: 'replay-once', label: 'Replay section once' },
  { id: 'loop', label: 'Loop section' },
  { id: 'announce-song', label: 'Announce song name' },
  { id: 'jam-keys', label: 'Chords on / off' },
  { id: 'jam-bass', label: 'Bass on / off' },
  { id: 'jam-arp', label: 'Arp on / off' },
  { id: 'jam-arp-rate', label: 'Arp rate (1/4 → 1/8 → 1/16)' },
]

/** action → the command it fires. */
export function actionCommand(action: LiveAction): LiveCommand {
  switch (action) {
    case 'jam-keys':
      return { type: 'toggle-jam', voice: 'keys' }
    case 'jam-bass':
      return { type: 'toggle-jam', voice: 'bass' }
    case 'jam-arp':
      return { type: 'toggle-jam', voice: 'arp' }
    case 'jam-arp-rate':
      return { type: 'cycle-arp-rate' }
    default:
      return { type: action } as LiveCommand
  }
}

/** A binding map: which control id is assigned to each learnable action. */
export type LiveMapping = Record<LiveAction, string>

/** Ableton-convention defaults (used until the user re-learns a button). */
export const DEFAULT_LIVE_MAPPING: LiveMapping = {
  'play-pause': 'play',
  stop: 'stop-all',
  'prev-song': 'scene:0',
  'next-song': 'scene:1',
  'replay-once': 'record',
  loop: 'scene:2',
  'announce-song': 'scene:3',
  // Jam voices ship UNASSIGNED on purpose. Custom 1/2 are ordinary mixer slots,
  // not direct jam switches: a user explicitly links whichever lanes they want.
  'jam-keys': '',
  'jam-bass': '',
  'jam-arp': '',
  'jam-arp-rate': '',
}

/**
 * Stable identifier for a pressed control (button or pad). Returns null for
 * things that can't be a trigger (knobs, shift, releases).
 */
export function controlId(a: ApcKey25Action): string | null {
  switch (a.type) {
    case 'play':
      return 'play'
    case 'record':
      return 'record'
    case 'stop-all-clips':
      return 'stop-all'
    case 'track-button':
      return `track:${a.index}`
    case 'scene-launch':
      return `scene:${a.index}`
    case 'clip-pad':
      return `pad:${a.index}`
    default:
      return null // shift, knob
  }
}

/** Human label for a control id (for the mapping UI). */
export function controlLabel(id: string | undefined): string {
  if (!id) return 'unassigned'
  if (id === 'play') return 'Play'
  if (id === 'record') return 'Record'
  if (id === 'stop-all') return 'Stop All Clips'
  const [kind, n] = id.split(':')
  const i = Number(n) + 1
  if (kind === 'track') return `Track Button ${i}`
  if (kind === 'scene') return `Scene Launch ${i}`
  if (kind === 'pad') return `Pad ${Number(n)}`
  return id
}

// ── Positional pad grid ─────────────────────────────────────────────────────
// Pad 0 is bottom-left (verified on hardware). Bottom row = slots 0-7. Pads 8/9
// (the first two pads of physical row 4, counting top-down) = Custom 1/2. All
// remaining pads are sections, read top-left → bottom-right.

export const STEM_PAD_COUNT = 8
export const LIVE_SLOT_PAD_COUNT = 10
export const SECTION_PAD_COUNT = 30

/** Canonical live-slot index for a pad, or null when that pad launches a section. */
export function padToLiveSlot(pad: number): number | null {
  return Number.isInteger(pad) && pad >= 0 && pad < LIVE_SLOT_PAD_COUNT ? pad : null
}

/** Section pads in chronological order: top-left to bottom-right, skipping Custom 1/2. */
const SECTION_PADS = [
  32, 33, 34, 35, 36, 37, 38, 39,
  24, 25, 26, 27, 28, 29, 30, 31,
  16, 17, 18, 19, 20, 21, 22, 23,
  10, 11, 12, 13, 14, 15,
] as const

/** Section index for a pad, or null if it is a live slot/out of range. */
export function padToSection(pad: number): number | null {
  const section = (SECTION_PADS as readonly number[]).indexOf(pad)
  return section >= 0 ? section : null
}

/** Pad index for a section (inverse of padToSection), or null if out of range. */
export function sectionToPad(sectionIndex: number): number | null {
  if (!Number.isInteger(sectionIndex) || sectionIndex < 0) return null
  return SECTION_PADS[sectionIndex] ?? null
}

/**
 * FIXED live lane order — a given instrument is ALWAYS the same button (bottom
 * pad row + track button), every song. This is what makes the stem buttons
 * trustworthy live: pad/button 0 is Drums whether or not this song has drums.
 */
export const CANONICAL_LIVE_SLOTS = [
  'drums',
  'bass',
  'vocals',
  'other',
  'guitar',
  'fx',
  'click',
  'cue',
  'custom1',
  'custom2',
] as const

/**
 * The automatically inferred slot a mixer lane key belongs to, or `null` if it
 * isn't recognized. Custom 1/2 are deliberately never inferred: the user links
 * those lanes explicitly in the mixer.
 * live-toggleable lane. Handles both disk (`stem:drums.wav`) and cloud
 * (`stem:Drums`) stem keys, plus the `click` / `cue` lanes.
 */
export function laneSlotIndex(key: string): number | null {
  if (key === 'click') return 6
  if (key === 'cue') return 7
  if (!key.startsWith('stem:')) return null
  const rest = key.slice('stem:'.length).toLowerCase()
  if (/vocal/.test(rest)) return 2
  if (/drum/.test(rest)) return 0
  if (/bass/.test(rest)) return 1
  if (/guitar/.test(rest)) return 4
  if (/(?:^|[^a-z])fx(?:[^a-z]|$)/.test(rest)) return 5
  if (/other/.test(rest)) return 3
  return null
}

/**
 * Resolve a parsed APC action to a live command, given the user's button
 * mapping. Learned buttons win; otherwise the pad grid is positional (bottom
 * row = stems, top rows = sections). Fires on press only.
 */
export function resolveLiveCommand(a: ApcKey25Action, mapping: LiveMapping): LiveCommand | null {
  if (a.type === 'knob' || a.type === 'shift') return null
  if ('pressed' in a && !a.pressed) return null
  const id = controlId(a)
  if (!id) return null

  // 1. Learned button bindings.
  for (const { id: action } of LIVE_ACTIONS) {
    if (mapping[action] === id) return actionCommand(action)
  }

  // 2. Positional pad grid: ten canonical lane slots, then section launchers.
  if (a.type === 'clip-pad') {
    const slot = padToLiveSlot(a.index)
    if (slot !== null) return { type: 'toggle-stem', index: slot }
    const section = padToSection(a.index)
    if (section !== null) return { type: 'jump-section', index: section }
  }
  // 3. Track buttons mirror the bottom pad row — the SAME canonical stem slots,
  //    so a stem toggle works from either control (unless the user MIDI-learned
  //    that track button to an action above, which wins).
  if (a.type === 'track-button' && a.index < STEM_PAD_COUNT) {
    return { type: 'toggle-stem', index: a.index }
  }
  return null
}

/** One-line description of any incoming action, for the debug monitor. */
export function describeApcKey25Action(a: ApcKey25Action): string {
  switch (a.type) {
    case 'play':
      return `Play ${a.pressed ? 'down' : 'up'}`
    case 'record':
      return `Record ${a.pressed ? 'down' : 'up'}`
    case 'shift':
      return `Shift ${a.pressed ? 'down' : 'up'}`
    case 'stop-all-clips':
      return `Stop All Clips ${a.pressed ? 'down' : 'up'}`
    case 'track-button':
      return `Track Button ${a.index + 1} ${a.pressed ? 'down' : 'up'}`
    case 'scene-launch':
      return `Scene Launch ${a.index + 1} ${a.pressed ? 'down' : 'up'}`
    case 'clip-pad':
      return `Pad r${a.row + 1}c${a.col + 1} ${a.pressed ? `down (vel ${a.velocity})` : 'up'}`
    case 'knob':
      return `Knob ${a.index + 1} ${a.delta >= 0 ? '+' : ''}${a.delta} (raw ${a.rawValue})`
    default:
      return 'Unknown'
  }
}
