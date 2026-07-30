/**
 * Adding and removing the programmed tracks — the "+ Add track" flow.
 *
 * Pure `SongMap → SongMap` so the mixer's menu stays a thin caller and the
 * behaviour is unit-testable without mounting a 2,600-line component.
 *
 * Adding is idempotent: a song has at most one drum machine and one bass
 * machine, so a second "add" returns the map untouched rather than wiping the
 * settings the user already dialled in.
 */
import type { SongMap } from './types'

/** Sensible starting point for a new drum machine track. */
export const DEFAULT_DRUM_MACHINE = {
  enabled: true,
  style: 'rock',
  loudness: 0.5,
  fills: 0.5,
} as const satisfies NonNullable<SongMap['drumMachine']>

/** Sensible starting point for a new bass machine track. */
export const DEFAULT_BASS_MACHINE = {
  enabled: true,
  style: 'roots',
  loudness: 0.5,
} as const satisfies NonNullable<SongMap['bassMachine']>

export type MachineTrackKind = 'drum' | 'bass'

export function hasMachineTrack(sm: SongMap, kind: MachineTrackKind): boolean {
  return kind === 'drum' ? !!sm.drumMachine : !!sm.bassMachine
}

export function withMachineTrack(sm: SongMap, kind: MachineTrackKind): SongMap {
  if (hasMachineTrack(sm, kind)) return sm
  return kind === 'drum'
    ? { ...sm, drumMachine: { ...DEFAULT_DRUM_MACHINE } }
    : { ...sm, bassMachine: { ...DEFAULT_BASS_MACHINE } }
}

export function withoutMachineTrack(sm: SongMap, kind: MachineTrackKind): SongMap {
  if (kind === 'drum') {
    const { drumMachine: _drop, ...rest } = sm
    return rest
  }
  const { bassMachine: _drop, ...rest } = sm
  return rest
}

/** Mixer lane key for a machine track — the id the editor keys off. */
export function machineTrackLaneKey(kind: MachineTrackKind): string {
  return kind === 'drum' ? 'drum-machine' : 'bass-machine'
}
