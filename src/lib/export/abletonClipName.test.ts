import { describe, expect, it } from 'vitest'
import { generateAbletonSetXml, type StemClip } from './abletonSet'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { SongMap } from '$lib/songmap/types'

/**
 * Regression: the AudioClip `<Name>` is user-controlled (a dropped stem's
 * filename) and was emitted RAW while the RelativePath right beside it was
 * escaped. A file named `Rock & Roll.wav` (or one containing `"` / `<` / `>`)
 * produced malformed XML that Ableton Live can refuse or crash on. Every
 * attribute value in the exported set must be XML-safe.
 */
function song(): SongMap {
  const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
  return {
    ...base,
    metadata: { ...base.metadata, bpm: 120, analyzed: true },
    timeline: {
      bars: [
        { id: 'bar-0', index: 0, startSec: 0, endSec: 2, meter: { numerator: 4, denominator: 4 }, beatCount: 1, beatIds: ['beat-0'] },
      ],
      beats: [{ id: 'beat-0', barId: 'bar-0', indexInBar: 0, timeSec: 0 }],
    },
    audio: { fileName: 'a.wav', trim: { startSec: 0, endSec: 2 }, source: 'upload' },
  }
}

function clip(fileName: string): StemClip {
  return { fileName, relativePath: fileName, durationSec: 2, sampleRate: 44100 }
}

const attributeValues = (xml: string) => [...xml.matchAll(/Value="([^"]*)"/g)].map((m) => m[1]!)

describe('Ableton AudioClip Name is XML-safe', () => {
  it('escapes ampersands, angle brackets and quotes in the clip filename', () => {
    const xml = generateAbletonSetXml(song(), {
      title: 'Set',
      stems: new Map([['Drums', clip('Rock & Roll <"live">.wav')]]),
    })
    expect(xml).toContain('Rock &amp; Roll &lt;&quot;live&quot;&gt;.wav')
    expect(xml).not.toContain('Rock & Roll')
  })

  it('a quote in the filename cannot terminate the attribute or inject markup', () => {
    const xml = generateAbletonSetXml(song(), {
      title: 'Set',
      stems: new Map([['Bass', clip('x" /><Evil Value="pwn')]]),
    })
    for (const value of attributeValues(xml)) {
      expect(value).not.toContain('<')
      expect(value).not.toContain('>')
    }
    expect(xml).not.toContain('<Evil')
  })

  it('keeps the document angle-bracket balanced with a hostile filename', () => {
    const xml = generateAbletonSetXml(song(), {
      title: 'Set',
      stems: new Map([['Guitar', clip('A & B <C> "D".wav')]]),
    })
    expect((xml.match(/</g) ?? []).length).toBe((xml.match(/>/g) ?? []).length)
  })
})
