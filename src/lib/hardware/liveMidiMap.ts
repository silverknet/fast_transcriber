/**
 * Live-performance mapping for the Akai APC Key 25 Mk2.
 *
 * Two layers:
 *   1. LEARNABLE buttons — Play, Stop, Prev/Next song, Replay-once, Loop. The
 *      user assigns each to whatever control they like via MIDI-learn (press the
 *      button you want). Defaults follow Ableton conventions.
 *   2. POSITIONAL pad grid — fixed: the BOTTOM pad row (0–7) is the 8 stems
 *      (green = on, red = muted), and the TOP 4 rows are the current song's
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
  /** Bottom pad row: the live-toggleable lanes (stems + cue + click). Up to 8. */
  lanes: { on: boolean; kind: 'stem' | 'cue' | 'click' }[]
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

/** The learnable button actions (everything except the positional pad grid). */
export type LiveAction =
  | 'play-pause'
  | 'stop'
  | 'prev-song'
  | 'next-song'
  | 'replay-once'
  | 'loop'
  | 'announce-song'

export const LIVE_ACTIONS: ReadonlyArray<{ id: LiveAction; label: string }> = [
  { id: 'play-pause', label: 'Play / pause' },
  { id: 'stop', label: 'Stop' },
  { id: 'prev-song', label: 'Previous song' },
  { id: 'next-song', label: 'Next song' },
  { id: 'replay-once', label: 'Replay section once' },
  { id: 'loop', label: 'Loop section' },
  { id: 'announce-song', label: 'Announce song name' },
]

/** action → the command it fires. */
export function actionCommand(action: LiveAction): LiveCommand {
  return { type: action } as LiveCommand
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

  // 2. Positional pad grid.
  if (a.type === 'clip-pad') {
    if (a.index < STEM_PAD_COUNT) return { type: 'toggle-stem', index: a.index }
    const section = padToSection(a.index)
    if (section !== null) return { type: 'jump-section', index: section }
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
