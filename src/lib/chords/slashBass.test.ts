import { describe, expect, it } from 'vitest'
import { chordWithoutBass, withSlashBass } from './slashBass'

describe('slashBass', () => {
  it('adds slash bass', () => {
    const c = chordWithoutBass(
      { root: 'C', quality: 'major', displayRaw: 'C' },
      false,
    )
    const slash = withSlashBass(c, 'G', undefined, false)
    expect(slash.bass).toBe('G')
    expect(slash.displayRaw).toMatch(/^C\/G$/)
  })

  it('strips bass', () => {
    const plain = chordWithoutBass(
      {
        root: 'C',
        quality: 'major',
        bass: 'G',
        displayRaw: 'C/G',
      },
      false,
    )
    expect(plain.bass).toBeUndefined()
    expect(plain.displayRaw).toMatch(/^C$/)
  })
})
