/**
 * Section labels become Ableton locator names, and locator names are XML
 * attributes.
 *
 * `escapeXmlAttr` already existed and was applied to clip paths, track names
 * and the set annotation — but not to locators, six lines below its own
 * definition. Section labels are user text, and chord-sheet import derives them
 * straight from pasted material, so an ampersand in a section name emitted
 * malformed XML. AGENTS.md flags a malformed `.als` as something Live can crash
 * on, which makes this a corruption bug rather than a cosmetic one.
 */
import { describe, expect, it } from 'vitest'
import { generateAbletonSetXml } from './abletonSet'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { Section, SongMap } from '$lib/songmap/types'

function songWithSections(labels: string[]): SongMap {
  const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
  const bars = labels.map((_, i) => ({
    id: `bar-${i}`,
    index: i,
    startSec: i * 2,
    endSec: (i + 1) * 2,
    meter: { numerator: 4, denominator: 4 } as const,
    beatCount: 1,
    beatIds: [`beat-${i}`],
  }))
  const sections: Section[] = labels.map((label, i) => ({
    id: `sec-${i}`,
    kind: 'verse',
    label,
    barRange: { startBarIndex: i, endBarIndex: i },
  }))
  return {
    ...base,
    metadata: { ...base.metadata, bpm: 120, analyzed: true },
    timeline: {
      bars,
      beats: bars.map((b, i) => ({ id: `beat-${i}`, barId: b.id, indexInBar: 0, timeSec: b.startSec })),
    },
    sections,
    audio: { fileName: 'a.wav', trim: { startSec: 0, endSec: labels.length * 2 }, source: 'upload' },
  }
}

/** Every `Value="…"` payload in the document, for well-formedness checking. */
function attributeValues(xml: string): string[] {
  return [...xml.matchAll(/Value="([^"]*)"/g)].map((m) => m[1]!)
}

describe('Ableton locator names are XML-safe', () => {
  it('escapes ampersands, angle brackets and quotes in section labels', () => {
    const xml = generateAbletonSetXml(songWithSections(['Verse & Chorus', 'Solo <big>', 'The "Drop"']))
    expect(xml).toContain('Verse &amp; Chorus')
    expect(xml).toContain('Solo &lt;big&gt;')
    expect(xml).toContain('The &quot;Drop&quot;')
    // The raw forms must not survive anywhere.
    expect(xml).not.toContain('Verse & Chorus')
    expect(xml).not.toContain('Solo <big>')
  })

  it('a quote in a label cannot terminate the attribute early', () => {
    // The corruption case: `"` closes Value=" and everything after it becomes
    // stray markup, so Live reads a structurally broken set.
    const xml = generateAbletonSetXml(songWithSections(['Bridge" /><Evil Value="x']))
    for (const value of attributeValues(xml)) {
      expect(value).not.toContain('<')
      expect(value).not.toContain('>')
    }
    expect(xml).not.toContain('<Evil')
  })

  it('leaves ordinary labels untouched', () => {
    const xml = generateAbletonSetXml(songWithSections(['Intro', 'Chorus 2']))
    expect(xml).toContain('Value="Intro"')
    expect(xml).toContain('Value="Chorus 2"')
  })

  it('produces a document with balanced angle brackets', () => {
    // Cheap structural smoke test: an unescaped label unbalances these.
    const xml = generateAbletonSetXml(songWithSections(['A & B', 'C <D> E', 'F "G" H']))
    expect((xml.match(/</g) ?? []).length).toBe((xml.match(/>/g) ?? []).length)
  })
})
