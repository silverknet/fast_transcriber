/**
 * Authoring the spoken parts of a cue track: the announcement override and the
 * spoken count-in switch.
 *
 * The contract that matters: the override carries WORDS, never the switch;
 * clearing it restores derivation (the title speaks again, and keeps following
 * renames); and a person's override survives every regeneration and migration.
 */
import { describe, expect, it } from 'vitest'
import {
  announcementOverrideText,
  applyProjectCueDefaults,
  createDefaultCueTrack,
  generateCueTrackFromSections,
  withAnnouncementOverride,
  withSpokenCountIn,
} from './cueTracks'
import { buildCueSpeechEvents, resolvedSpokenIntroText } from '$lib/audio/cueTrackSpeechSchedule'
import { createEmptySongMap } from './factory'
import type { CueTrack, RenderedCueExport, Section, SongMap } from './types'

function song(title: string): SongMap {
  const bars = Array.from({ length: 4 }, (_, i) => ({
    id: `bar${i}`,
    index: i,
    startSec: i * 2,
    endSec: (i + 1) * 2,
    beatCount: 4,
    beatIds: Array.from({ length: 4 }, (_, k) => `b${i}_${k}`),
  }))
  const beats = bars.flatMap((bar, bi) =>
    Array.from({ length: 4 }, (_, k) => ({
      id: `b${bi}_${k}`,
      barId: bar.id,
      indexInBar: k,
      timeSec: bar.startSec + k * 0.5,
    })),
  )
  const sections: Section[] = [
    { id: 's1', kind: 'verse', label: 'Verse', barRange: { startBarIndex: 0, endBarIndex: 3 } },
  ]
  const sm = createEmptySongMap()
  return {
    ...sm,
    metadata: { ...sm.metadata, title },
    audio: { ...sm.audio!, fileName: 'x.wav', trim: { startSec: 0, endSec: 8 } },
    timeline: { ...sm.timeline, bars, beats },
    sections,
  } as SongMap
}

const RENDER: RenderedCueExport = {
  fingerprint: 'abc',
  durationSec: 8,
  sampleRate: 44100,
  generatedAt: '2026-01-01T00:00:00.000Z',
  preludeOffsetSec: 0,
}

describe('the announcement override', () => {
  it('sets the words, and the resolver + speech builder both use them', () => {
    const sm = song('Valerie (Amy Winehouse cover) — live')
    const track = withAnnouncementOverride(createDefaultCueTrack(), 'Winehouse')
    expect(announcementOverrideText(track)).toBe('Winehouse')
    expect(resolvedSpokenIntroText(sm, track)).toBe('Winehouse')
    const title = buildCueSpeechEvents(sm, track, { announceTitle: true }).find((e) => e.kind === 'title')
    expect(title?.text).toMatch(/Winehouse/)
  })

  it('never acts as the switch — setting off stays silent with the override present', () => {
    const sm = song('Valerie')
    const track = withAnnouncementOverride(createDefaultCueTrack(), 'Winehouse')
    expect(buildCueSpeechEvents(sm, track, { announceTitle: false }).find((e) => e.kind === 'title')).toBeUndefined()
  })

  it('clearing restores DERIVATION — the title speaks again and follows renames', () => {
    const track = withAnnouncementOverride(createDefaultCueTrack(), 'Winehouse')
    const cleared = withAnnouncementOverride(track, '')
    expect(announcementOverrideText(cleared)).toBeUndefined()
    const before = song('Valerie')
    expect(resolvedSpokenIntroText(before, cleared)).toBe('Valerie')
    const renamed = song('Valerie (live)')
    expect(resolvedSpokenIntroText(renamed, cleared)).toBe('Valerie (live)')
  })

  it('replaces rather than stacks — one override, ever', () => {
    let track = withAnnouncementOverride(createDefaultCueTrack(), 'First')
    track = withAnnouncementOverride(track, 'Second')
    expect(track.events.filter((e) => e.kind === 'intro')).toHaveLength(1)
    expect(announcementOverrideText(track)).toBe('Second')
  })

  it('survives regeneration AND the bulk pass — it is a person’s decision', () => {
    const sm = song('Valerie')
    const withTrack: SongMap = {
      ...sm,
      cueTracks: [withAnnouncementOverride({ ...createDefaultCueTrack(), performerId: 'p1' }, 'Winehouse')],
    }
    const regenerated = generateCueTrackFromSections(withTrack, withTrack.cueTracks[0]!)
    expect(announcementOverrideText(regenerated)).toBe('Winehouse')
    const bulk = applyProjectCueDefaults(withTrack, { performers: [{ id: 'p1', name: 'Martin' }] })
    expect(announcementOverrideText(bulk.cueTracks.find((t) => t.performerId === 'p1')!)).toBe('Winehouse')
  })

  it('invalidates the render when the words change, and only then', () => {
    const rendered: CueTrack = { ...createDefaultCueTrack(), renderExport: RENDER }
    expect(withAnnouncementOverride(rendered, 'New words').renderExport).toBeUndefined()
    // No-op set: same words → the render survives.
    const set = withAnnouncementOverride({ ...createDefaultCueTrack(), renderExport: RENDER }, '')
    expect(set.renderExport).toEqual(RENDER)
  })

  it('whitespace is not an override', () => {
    const track = withAnnouncementOverride(createDefaultCueTrack(), '   ')
    expect(announcementOverrideText(track)).toBeUndefined()
    expect(track.events).toHaveLength(0)
  })
})

describe('the spoken count-in switch', () => {
  it('flips on and off, clearing the render each real change', () => {
    const on = withSpokenCountIn({ ...createDefaultCueTrack(), renderExport: RENDER }, true)
    expect(on.spokenCountIn).toBe(true)
    expect(on.renderExport).toBeUndefined()
    const off = withSpokenCountIn({ ...on, renderExport: RENDER }, false)
    expect(off.spokenCountIn).toBeUndefined()
    expect(off.renderExport).toBeUndefined()
  })

  it('a no-op flip keeps the render — nothing spoken changed', () => {
    const track = { ...createDefaultCueTrack(), renderExport: RENDER }
    expect(withSpokenCountIn(track, false)).toBe(track)
  })
})
