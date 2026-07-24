/**
 * Canonical per-section-kind colours, shared by the on-screen UI and the APC
 * pad LEDs so a section looks the same everywhere. Solid hex (the waveform's
 * SECTION_FILL_RGBA uses the same hues at low opacity).
 */
export const SECTION_KIND_COLOR: Record<string, string> = {
  intro: '#8b5cf6', // purple
  verse: '#0ea5e9', // sky blue
  preChorus: '#06b6d4', // cyan
  chorus: '#facc15', // yellow
  bridge: '#16a34a', // green (distinct from the yellow chorus)
  solo: '#f43f5e', // rose
  riff: '#f97316', // orange
  break: '#94a3b8', // slate
  outro: '#d946ef', // fuchsia
  custom: '#71717a', // grey
}

export const SECTION_DEFAULT_COLOR = '#71717a'

export function sectionKindColor(kind: string | undefined): string {
  return (kind && SECTION_KIND_COLOR[kind]) || SECTION_DEFAULT_COLOR
}
