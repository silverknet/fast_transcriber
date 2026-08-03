import { describe, it, expect } from 'vitest'
import { buildArpHits, arpNoteAt } from './chordArp'

const triad = [60, 64, 67] // C major voicing

// Four beats, 0.5s apart, all the same chord.
const beats = Array.from({ length: 4 }, (_, i) => ({ timeSec: i * 0.5, notes: triad }))

describe('arpNoteAt', () => {
  it('goes up through the notes', () => {
    expect([0, 1, 2, 3, 4].map((s) => arpNoteAt(triad, s, 'up'))).toEqual([60, 64, 67, 60, 64])
  })
  it('goes down through the notes', () => {
    expect([0, 1, 2, 3].map((s) => arpNoteAt(triad, s, 'down'))).toEqual([67, 64, 60, 67])
  })
  it('bounces up then down without doubling endpoints', () => {
    // period = 2*3-2 = 4 → 60,64,67,64, then repeat
    expect([0, 1, 2, 3, 4, 5].map((s) => arpNoteAt(triad, s, 'updown'))).toEqual([
      60, 64, 67, 64, 60, 64,
    ])
  })
  it('random stays within the chord', () => {
    const seq = [0.9, 0.1, 0.5, 0.99].map((r) => arpNoteAt(triad, 0, 'random', () => r))
    for (const m of seq) expect(triad).toContain(m)
  })
})

describe('buildArpHits', () => {
  it('1/8 → two steps per beat, ascending across the chord', () => {
    const hits = buildArpHits(beats, 2, 'up')
    expect(hits.length).toBe(8)
    expect(hits.map((h) => h.midi)).toEqual([60, 64, 67, 60, 64, 67, 60, 64])
    expect(hits[1]!.timeSec).toBeCloseTo(0.25, 6)
  })

  it('resets the step figure when the chord changes', () => {
    const mixed = [
      { timeSec: 0, notes: [60, 64, 67] },
      { timeSec: 0.5, notes: [62, 65, 69] }, // new chord → restart at step 0
    ]
    const hits = buildArpHits(mixed, 1, 'up')
    expect(hits.map((h) => h.midi)).toEqual([60, 62]) // each chord starts from its lowest
  })

  it('spans multiple octaves when octaves > 1', () => {
    const oneBeat = [{ timeSec: 0, notes: [60, 64, 67] }]
    const hits = buildArpHits(oneBeat, 6, 'up', 2) // 2 octaves → C E G C' E' G'
    expect(hits.map((h) => h.midi)).toEqual([60, 64, 67, 72, 76, 79])
  })

  it('swings the off-beats later without moving the down-beats', () => {
    const straight = buildArpHits(beats, 2, 'up', 1, 0)
    const swung = buildArpHits(beats, 2, 'up', 1, 1)
    // beat 0: on-beat unchanged, off-beat (index 1) pushed later
    expect(swung[0]!.timeSec).toBeCloseTo(straight[0]!.timeSec, 6)
    expect(swung[1]!.timeSec).toBeGreaterThan(straight[1]!.timeSec)
  })

  it('rests (and resets) on empty note sets', () => {
    const gapped = [
      { timeSec: 0, notes: [60, 64, 67] },
      { timeSec: 0.5, notes: [] as number[] },
      { timeSec: 1, notes: [60, 64, 67] },
    ]
    const hits = buildArpHits(gapped, 1, 'up')
    expect(hits.length).toBe(2) // the gap produces no hit
    expect(hits.map((h) => h.timeSec)).toEqual([0, 1])
  })
})
