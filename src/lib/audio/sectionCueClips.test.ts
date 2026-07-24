import { describe, expect, it } from 'vitest'
import { CUE_SAMPLE_RATE, trimLeadingSilence } from '$lib/audio/renderCueTrack'
import { renderSectionCueClips, sliceWordsByOnset } from '$lib/audio/sectionCueClips'
import type { SectionCueRenderDeps, SectionCueSpec } from '$lib/audio/sectionCueClips'

// ── Fake TTS fixture: near-silence, then a short loud burst, then near-silence
// again — so trimLeadingSilence has a clear onset, and the single burst gives
// one "audible energy" landmark. It's ONE burst, so the phrase slicer can't
// split it into N words → renderSectionCueClips falls back to per-word (which
// is what these tests exercise; slicing is tested directly below). ──
const RAW_RATE = 22050
const RAW_LEN = 4000
const SILENCE = 0.001
const BURST = 0.6
const BURST_START = 1000
const BURST_LEN = 100

function makeRawFixture(): Float32Array {
  const arr = new Float32Array(RAW_LEN)
  for (let i = 0; i < RAW_LEN; i++) {
    arr[i] = i >= BURST_START && i < BURST_START + BURST_LEN ? BURST : SILENCE
  }
  return arr
}

const TRIMMED = trimLeadingSilence(makeRawFixture(), RAW_RATE)
const NAME_DURATION_SEC = TRIMMED.length / RAW_RATE
const NAME_TO_DOWNBEAT_GAP_SEC = 0.15

function makeDeps(opts: { failAll?: boolean } = {}): {
  deps: SectionCueRenderDeps
  requested: string[]
} {
  const requested: string[] = []
  const deps: SectionCueRenderDeps = {
    fetchTts: async (text: string) => {
      requested.push(text)
      if (opts.failAll) return { ok: false, error: 'boom' }
      return { ok: true, blob: new Blob(['dummy']) }
    },
    decodeWav: async () => ({ data: makeRawFixture(), sampleRate: RAW_RATE }),
  }
  return { deps, requested }
}

/** Contiguous regions of `data` whose |sample| exceeds `threshold`. */
function findOnsets(
  data: Float32Array,
  sampleRate: number,
  threshold = 0.05,
  mergeGapSamples = 20,
): { startSec: number; endSec: number }[] {
  const idxs: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]!) > threshold) idxs.push(i)
  }
  const regions: { start: number; end: number }[] = []
  for (const idx of idxs) {
    const last = regions[regions.length - 1]
    if (last && idx - last.end <= mergeGapSamples) last.end = idx
    else regions.push({ start: idx, end: idx })
  }
  return regions.map((r) => ({ startSec: r.start / sampleRate, endSec: r.end / sampleRate }))
}

describe('sliceWordsByOnset', () => {
  it('splits a phrase with clear word gaps into that many clips', () => {
    const rate = 22050
    const wordLen = Math.floor(0.12 * rate)
    const gapLen = Math.floor(0.15 * rate) // > 90 ms merge threshold → separate words
    const parts: number[] = []
    for (let w = 0; w < 3; w++) {
      for (let i = 0; i < wordLen; i++) parts.push(0.5)
      for (let i = 0; i < gapLen; i++) parts.push(0.0)
    }
    const clips = sliceWordsByOnset(new Float32Array(parts), rate, 3)
    expect(clips).not.toBeNull()
    expect(clips!).toHaveLength(3)
    // Each clip carries audible energy.
    for (const c of clips!) expect(c.some((s) => Math.abs(s) > 0.1)).toBe(true)
  })

  it('returns null when the word count does not match (caller falls back)', () => {
    const rate = 22050
    const one = new Float32Array(rate)
    for (let i = 200; i < 400; i++) one[i] = 0.5
    expect(sliceWordsByOnset(one, rate, 3)).toBeNull()
  })
})

describe('renderSectionCueClips', () => {
  it('count-only (no name): counts one..four, downbeat 4*0.5s in', async () => {
    const { deps, requested } = makeDeps()
    const specs: SectionCueSpec[] = [{ sectionId: 's1', countInBeats: 4, beatDurationSec: 0.5 }]
    const out = await renderSectionCueClips(specs, deps)

    // Tries the connected phrase first, then falls back to per-word (fixture is
    // a single burst, so the slicer can't find 4 words).
    expect(requested[0]).toBe('one two three four')
    expect(requested).toContain('one')
    expect(requested).toContain('four')
    const clip = out.get('s1')!
    expect(clip.sampleRate).toBe(CUE_SAMPLE_RATE)
    // ~n*beat, plus a few ms because each word is anchored by its stress.
    expect(clip.downbeatOffsetSec).toBeCloseTo(2.0, 1)
    expect(clip.data.length).toBe(Math.ceil(clip.downbeatOffsetSec * CUE_SAMPLE_RATE))
  })

  it('the last count lands audibly ~one beat before the downbeat', async () => {
    const { deps } = makeDeps()
    const specs: SectionCueSpec[] = [{ sectionId: 's1', countInBeats: 4, beatDurationSec: 0.5 }]
    const out = await renderSectionCueClips(specs, deps)
    const clip = out.get('s1')!
    const onsets = findOnsets(clip.data, clip.sampleRate)
    expect(onsets).toHaveLength(4)
    const last = onsets[onsets.length - 1]!
    expect(Math.abs(last.startSec - (clip.downbeatOffsetSec - 0.5))).toBeLessThan(0.03)
  })

  it('name + count: the NAME is the "1" (requested, not "one"), then two/three/four', async () => {
    const { deps, requested } = makeDeps()
    const specs: SectionCueSpec[] = [
      { sectionId: 's1', speechText: 'Verse', countInBeats: 4, beatDurationSec: 0.5 },
    ]
    const out = await renderSectionCueClips(specs, deps)

    expect(requested).toContain('Verse')
    expect(requested).not.toContain('one') // the name replaces "1"
    expect(requested).toContain('two')
    const clip = out.get('s1')!
    // Name sits on beat 0, so the clip still spans ~the count-in beats.
    expect(clip.downbeatOffsetSec).toBeCloseTo(2.0, 1)
    const onsets = findOnsets(clip.data, clip.sampleRate)
    expect(onsets).toHaveLength(4) // name + two + three + four
    expect(onsets[0]!.startSec).toBeLessThan(0.05) // name is beat 0 (earliest)
  })

  it('speech-only: name energy ends before the downbeat', async () => {
    const { deps, requested } = makeDeps()
    const specs: SectionCueSpec[] = [{ sectionId: 's1', speechText: 'Chorus', beatDurationSec: 0.5 }]
    const out = await renderSectionCueClips(specs, deps)

    expect(requested).toEqual(['Chorus'])
    const clip = out.get('s1')!
    expect(clip.downbeatOffsetSec).toBeCloseTo(NAME_TO_DOWNBEAT_GAP_SEC + NAME_DURATION_SEC, 5)
    const onsets = findOnsets(clip.data, clip.sampleRate)
    expect(onsets).toHaveLength(1)
    expect(onsets[0]!.endSec).toBeLessThan(clip.downbeatOffsetSec)
  })

  it('neither speech nor count-in: the spec is absent from the map', async () => {
    const { deps } = makeDeps()
    const out = await renderSectionCueClips([{ sectionId: 's1', beatDurationSec: 0.5 }], deps)
    expect(out.size).toBe(0)
  })

  it('empty specs produce an empty map', async () => {
    const { deps } = makeDeps()
    expect((await renderSectionCueClips([], deps)).size).toBe(0)
  })

  it('a spec whose TTS always fails is absent from the map (no throw)', async () => {
    const { deps } = makeDeps({ failAll: true })
    const specs: SectionCueSpec[] = [
      { sectionId: 's1', speechText: 'Chorus', countInBeats: 4, beatDurationSec: 0.5 },
    ]
    const out = await renderSectionCueClips(specs, deps)
    expect(out.size).toBe(0)
  })
})
