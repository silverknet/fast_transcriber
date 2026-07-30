/**
 * Live-performance mapping for the Akai APC Key 25 Mk2.
 *
 * Two layers:
 *   1. LEARNABLE buttons — Play, Stop, Prev/Next song, Replay-once, Loop. The
 *      user assigns each to whatever control they like via MIDI-learn (press the
 *      button you want). Defaults follow Ableton conventions.
 *   2. FIXED pad/button grid — the BOTTOM pad row (0–7) AND the 8 round track
 *      buttons both toggle stems, in a FIXED canonical instrument order
 *      (`CANONICAL_LIVE_SLOTS` / `laneSlotIndex`) so a given stem is ALWAYS the
 *      same button, every song. The TOP 4 pad rows are the current song's
 *      sections (tap to jump). No song has more than 8×4 = 32 sections.
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
   * The 8 live-toggleable lanes in FIXED canonical slots (index 0-7 = the same
   * instrument every song; `null` = that slot has no lane in this song). Painted
   * on BOTH the bottom pad row and the 8 track buttons.
   */
  lanes: ({ on: boolean; kind: 'stem' | 'cue' | 'click' } | null)[]
  /** SectionKind per section index (length = section count, capped at 32). */
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
  // Jam voices ship UNASSIGNED on purpose. Every pad is already spoken for —
  // the bottom row is stems and the four rows above are sections, so any default
  // here would silently steal section pads (pads 32-39 are sections 0-7, the
  // ones you reach for most). Learn them to whatever you can spare.
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
// Pad 0 is bottom-left (verified on hardware). Bottom row = stems; the 4 rows
// above = sections, read top-left → bottom-right so section 0 is the top-left.

export const STEM_PAD_COUNT = 8

/** Section index for a pad (top 4 rows), or null if it's a stem/out of range. */
export function padToSection(pad: number): number | null {
  if (pad < 8 || pad > 39) return null
  const row = Math.floor(pad / 8) // 1..4 (1 = just above stems, 4 = top)
  const col = pad % 8
  return (4 - row) * 8 + col
}

/** Pad index for a section (inverse of padToSection), or null if out of range. */
export function sectionToPad(sectionIndex: number): number | null {
  if (sectionIndex < 0 || sectionIndex >= 32) return null
  const row = 4 - Math.floor(sectionIndex / 8)
  const col = sectionIndex % 8
  return row * 8 + col
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
] as const

/**
 * The fixed slot (0-7) a mixer lane key belongs to, or `null` if it isn't a
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

  // 2. Positional pad grid: bottom row = stems (canonical slots), top = sections.
  if (a.type === 'clip-pad') {
    if (a.index < STEM_PAD_COUNT) return { type: 'toggle-stem', index: a.index }
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
