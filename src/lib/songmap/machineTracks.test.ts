import { describe, expect, it } from 'vitest'
import { createEmptySongMap } from './factory'
import {
  hasMachineTrack,
  machineTrackLaneKey,
  withMachineTrack,
  withoutMachineTrack,
} from './machineTracks'
import type { SongMap } from './types'

const empty = createEmptySongMap()

describe('machine tracks', () => {
  it('adds a drum machine with usable defaults', () => {
    const sm = withMachineTrack(empty, 'drum')
    expect(sm.drumMachine?.enabled).toBe(true)
    expect(sm.drumMachine?.style).toBe('rock')
    expect(sm.bassMachine).toBeUndefined()
  })

  it('adds a bass machine with usable defaults', () => {
    const sm = withMachineTrack(empty, 'bass')
    expect(sm.bassMachine?.enabled).toBe(true)
    expect(sm.bassMachine?.style).toBe('roots')
    expect(sm.drumMachine).toBeUndefined()
  })

  it('both tracks can exist at once, like tracks in a DAW', () => {
    const sm = withMachineTrack(withMachineTrack(empty, 'drum'), 'bass')
    expect(sm.drumMachine).toBeDefined()
    expect(sm.bassMachine).toBeDefined()
  })

  it('adding twice never clobbers settings the user already dialled in', () => {
    const edited: SongMap = {
      ...empty,
      drumMachine: { enabled: true, style: 'funk', complexity: 0.9 },
    }
    expect(withMachineTrack(edited, 'drum')).toBe(edited)
  })

  it('removing drops only that track', () => {
    const both = withMachineTrack(withMachineTrack(empty, 'drum'), 'bass')
    const noDrums = withoutMachineTrack(both, 'drum')
    expect(noDrums.drumMachine).toBeUndefined()
    expect(noDrums.bassMachine).toBeDefined()
  })

  it('removing a track that is not there is a no-op, not a crash', () => {
    expect(withoutMachineTrack(empty, 'bass').bassMachine).toBeUndefined()
  })

  it('reports what exists', () => {
    expect(hasMachineTrack(empty, 'drum')).toBe(false)
    expect(hasMachineTrack(withMachineTrack(empty, 'drum'), 'drum')).toBe(true)
  })

  it('lane keys match the mixer lanes the editors key off', () => {
    expect(machineTrackLaneKey('drum')).toBe('drum-machine')
    expect(machineTrackLaneKey('bass')).toBe('bass-machine')
  })
})
