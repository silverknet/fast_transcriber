import { describe, it, expect } from 'vitest'
import {
  effectiveSlotLink,
  isGroupOn,
  isLiveSlotLink,
  nextGroupMuted,
  resolveLaneSlot,
  resolveLiveSlotLanes,
  slotIndexByName,
  slotNameByIndex,
  LIVE_SLOT_COUNT,
  buildLiveSlotViews,
  hasMusicalSlotLane,
  liveInitialMuted,
  type LiveSlotLink,
} from './liveSlotLinks'
import type { AutoStemName } from '$lib/project/types'

const DRUMS = slotIndexByName('drums')
const BASS = slotIndexByName('bass')

describe('resolveLaneSlot', () => {
  it('falls back to the filename guess when nothing is set', () => {
    expect(resolveLaneSlot('stem:drums.wav')).toBe(DRUMS)
    expect(resolveLaneSlot('stem:Drums')).toBe(DRUMS) // cloud key scheme
  })

  it('an explicit link wins over the filename', () => {
    // A file called "drums" deliberately parked on the Bass button.
    expect(resolveLaneSlot('stem:drums.wav', 'bass')).toBe(BASS)
  })

  it('links a track the filename guess cannot recognise', () => {
    expect(resolveLaneSlot('stem:percussion.wav')).toBeNull() // before
    expect(resolveLaneSlot('stem:percussion.wav', 'drums')).toBe(DRUMS) // after
  })

  it("'none' removes a lane the guess would have claimed", () => {
    expect(resolveLaneSlot('stem:drums.wav', 'none')).toBeNull()
  })
})

describe('resolveLiveSlotLanes', () => {
  it('puts several tracks on one button, in order', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'stem:drums.wav' },
      { key: 'stem:percussion.wav', liveSlot: 'drums' },
      { key: 'stem:bass.wav' },
    ])
    expect(slots[DRUMS]).toEqual(['stem:drums.wav', 'stem:percussion.wav'])
    expect(slots[BASS]).toEqual(['stem:bass.wav'])
  })

  it('always returns all 10 slots, empty where nothing is linked', () => {
    const slots = resolveLiveSlotLanes([{ key: 'stem:drums.wav' }])
    expect(slots).toHaveLength(LIVE_SLOT_COUNT)
    expect(slots[BASS]).toEqual([])
  })

  it('drops lanes that belong to no slot', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'original' },
      { key: 'stem:weird.wav' },
      { key: 'stem:drums.wav', liveSlot: 'none' },
    ])
    expect(slots.every((s) => s.length === 0)).toBe(true)
  })

  it('keeps the click and cue lanes on their own buttons', () => {
    const slots = resolveLiveSlotLanes([{ key: 'click' }, { key: 'cue' }])
    expect(slots[slotIndexByName('click')]).toEqual(['click'])
    expect(slots[slotIndexByName('cue')]).toEqual(['cue'])
  })

  it('an unconfigured song groups exactly as it did before', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'stem:drums.wav' },
      { key: 'stem:bass.wav' },
      { key: 'stem:vocals.wav' },
      { key: 'stem:other.wav' },
    ])
    expect(slots[DRUMS]).toEqual(['stem:drums.wav'])
    expect(slots[BASS]).toEqual(['stem:bass.wav'])
    expect(slots[slotIndexByName('vocals')]).toEqual(['stem:vocals.wav'])
    expect(slots[slotIndexByName('other')]).toEqual(['stem:other.wav'])
  })
})

describe('nextGroupMuted — one press never splits the group', () => {
  const muted = (set: string[]) => (k: string) => set.includes(k)

  it('all on → press mutes all', () => {
    expect(nextGroupMuted(['a', 'b'], muted([]))).toBe(true)
  })

  it('all off → press unmutes all', () => {
    expect(nextGroupMuted(['a', 'b'], muted(['a', 'b']))).toBe(false)
  })

  it('mixed → press mutes all, so the next press brings the whole group back', () => {
    expect(nextGroupMuted(['a', 'b'], muted(['a']))).toBe(true)
    expect(nextGroupMuted(['a', 'b'], muted([]))).toBe(true)
  })

  it('an empty group is inert', () => {
    expect(nextGroupMuted([], muted([]))).toBe(false)
  })
})

describe('isGroupOn — the LED', () => {
  const muted = (set: string[]) => (k: string) => set.includes(k)

  it('lit when anything in the group sounds', () => {
    expect(isGroupOn(['a', 'b'], muted(['a']))).toBe(true)
    expect(isGroupOn(['a', 'b'], muted([]))).toBe(true)
  })

  it('dark when the whole group is muted, or empty', () => {
    expect(isGroupOn(['a', 'b'], muted(['a', 'b']))).toBe(false)
    expect(isGroupOn([], muted([]))).toBe(false)
  })
})

describe('effectiveSlotLink — what the picker shows', () => {
  it('shows the guessed slot when nothing is set', () => {
    expect(effectiveSlotLink('stem:drums.wav')).toBe('drums')
  })

  it("shows 'none' for a track the guess does not recognise", () => {
    expect(effectiveSlotLink('stem:percussion.wav')).toBe('none')
  })

  it('shows the explicit setting when there is one', () => {
    expect(effectiveSlotLink('stem:drums.wav', 'bass')).toBe('bass')
    expect(effectiveSlotLink('stem:drums.wav', 'none')).toBe('none')
  })

  it('ignores junk from an older or newer schema', () => {
    expect(effectiveSlotLink('stem:drums.wav', 'trumpet' as never)).toBe('drums')
  })
})

describe('slot name/index round-trip', () => {
  it('survives a name → index → name trip for every slot', () => {
    for (let i = 0; i < LIVE_SLOT_COUNT; i++) {
      const name = slotNameByIndex(i)
      expect(name).not.toBeNull()
      expect(slotIndexByName(name!)).toBe(i)
    }
  })

  it('rejects out-of-range indices and junk links', () => {
    expect(slotNameByIndex(-1)).toBeNull()
    expect(slotNameByIndex(LIVE_SLOT_COUNT)).toBeNull()
    expect(isLiveSlotLink('trumpet')).toBe(false)
    expect(isLiveSlotLink('none')).toBe(true)
    expect(isLiveSlotLink('drums')).toBe(true)
    expect(isLiveSlotLink('custom1')).toBe(true)
    expect(isLiveSlotLink('custom2')).toBe(true)
  })
})

describe('the live stage row and the MIDI buttons are ONE list', () => {
  /**
   * The defect this pins: the live stage rendered every mixer lane while the
   * pads drove the canonical slots, so the screen showed `drum-machine` /
   * `bass-machine` pills the controller had no button for, in a different order.
   * Both sides must resolve through `resolveLiveSlotLanes`.
   */
  const MIXER_LANES = [
    { key: 'original' },
    { key: 'stem:drums.wav' },
    { key: 'stem:bass.wav' },
    { key: 'stem:vocals.wav' },
    { key: 'drum-machine' },
    { key: 'bass-machine' },
    { key: 'chord-machine' },
    { key: 'arp-machine' },
    { key: 'click' },
    { key: 'cue' },
  ]

  it('generated machine lanes never occupy a live button', () => {
    const slots = resolveLiveSlotLanes(MIXER_LANES)
    const claimed = slots.flat()
    for (const machine of ['drum-machine', 'bass-machine', 'chord-machine', 'arp-machine']) {
      expect(claimed).not.toContain(machine)
    }
  })

  it('the full mix is not a live button either', () => {
    expect(resolveLiveSlotLanes(MIXER_LANES).flat()).not.toContain('original')
  })

  it('always yields exactly 10 slots, whatever the song contains', () => {
    expect(resolveLiveSlotLanes(MIXER_LANES).length).toBe(LIVE_SLOT_COUNT)
    expect(resolveLiveSlotLanes([]).length).toBe(LIVE_SLOT_COUNT)
  })

  it('slot order is FIXED — button 1 is Drums even in a song without drums', () => {
    const noDrums = resolveLiveSlotLanes([{ key: 'stem:bass.wav' }, { key: 'stem:vocals.wav' }])
    expect(slotNameByIndex(0)).toBe('drums')
    expect(noDrums[0]).toEqual([]) // empty, but still slot 0
    expect(noDrums[slotIndexByName('bass')]).toEqual(['stem:bass.wav'])
  })

  it('an explicit link moves the on-screen pill and the pad together', () => {
    // One resolution → the row and the controller cannot disagree by construction.
    const slots = resolveLiveSlotLanes([{ key: 'stem:percussion.wav', liveSlot: 'drums' }])
    expect(slots[DRUMS]).toEqual(['stem:percussion.wav'])
  })

  it('a machine lane pinned to a slot IS toggleable — the picker is the escape hatch', () => {
    const slots = resolveLiveSlotLanes([{ key: 'bass-machine', liveSlot: 'bass' }])
    expect(slots[BASS]).toEqual(['bass-machine'])
  })
})

describe('liveInitialMuted — the live button owns the lane, not the arranging mix', () => {
  const base = { savedMuted: false, liveStems: undefined, hasMusicalSlotLane: true }

  it('a linked lane IGNORES the arranging mute (the reported bug)', () => {
    // Muted while arranging, linked to Drums, and Drums is a standard stem.
    // It must SOUND on stage — the button is lit, so silence is a lie.
    expect(
      liveInitialMuted({
        ...base,
        key: 'stem:percussion.wav',
        liveSlot: 'drums',
        savedMuted: true,
        liveStems: ['drums', 'bass'],
      }),
    ).toBe(false)
  })

  it('and conversely: unmuted while arranging does not force it on', () => {
    // Linked to Vocals, which this project does NOT play live.
    expect(
      liveInitialMuted({
        ...base,
        key: 'stem:vocals.wav',
        liveSlot: 'vocals',
        savedMuted: false,
        liveStems: ['drums', 'bass'],
      }),
    ).toBe(true)
  })

  it('follows the project standard-stem set for each Demucs slot', () => {
    const liveStems: AutoStemName[] = ['drums', 'bass']
    const at = (key: string, liveSlot: LiveSlotLink) =>
      liveInitialMuted({ ...base, key, liveSlot, liveStems })
    expect(at('stem:drums.wav', 'drums')).toBe(false)
    expect(at('stem:bass.wav', 'bass')).toBe(false)
    expect(at('stem:vocals.wav', 'vocals')).toBe(true)
    expect(at('stem:other.wav', 'other')).toBe(true)
  })

  it('guitar, FX and Custom are audible — a lane only lands there deliberately', () => {
    expect(
      liveInitialMuted({ ...base, key: 'stem:gtr.wav', liveSlot: 'guitar', savedMuted: true }),
    ).toBe(false)
    expect(liveInitialMuted({ ...base, key: 'stem:fx.wav', liveSlot: 'fx', savedMuted: true })).toBe(
      false,
    )
    expect(
      liveInitialMuted({ ...base, key: 'arp-machine', liveSlot: 'custom1', savedMuted: true }),
    ).toBe(false)
    expect(
      liveInitialMuted({ ...base, key: 'chord-machine', liveSlot: 'custom2', savedMuted: true }),
    ).toBe(false)
  })

  it('cues AND the click start ON in live — deterministic, never inherited', () => {
    // The click used to keep each song's EDITING mute, so across a set some
    // songs clicked and some silently didn't — tracking nothing but editing
    // history, which on a stage reads as corruption. Live starts every
    // analysed song's click ON; the pill and the fail-closed gate govern from
    // there, per show, not per twenty saved editor states.
    expect(liveInitialMuted({ ...base, key: 'cue', savedMuted: true })).toBe(false)
    expect(liveInitialMuted({ ...base, key: 'click', savedMuted: true })).toBe(false)
    expect(liveInitialMuted({ ...base, key: 'click', savedMuted: false })).toBe(false)
  })

  it('an UNLINKED lane is muted in live, whatever the arranging mix said', () => {
    // This test used to assert the OPPOSITE ("machines are not hijacked" —
    // unlinked lanes kept their arranging mute). That contract WAS the bug: an
    // editor-audible bass lane with no live button kept sounding on a real
    // stage with all live buttons off, and nothing on the stage could
    // silence it. Mute-as-admission, codified as a test. Linking to a button
    // is the admission now; unlinked means not in the show.
    for (const key of ['drum-machine', 'drums-gen', 'bass-machine', 'chord-machine']) {
      expect(liveInitialMuted({ ...base, key, savedMuted: true })).toBe(true)
      expect(liveInitialMuted({ ...base, key, savedMuted: false })).toBe(true)
    }
  })

  it('a machine LINKED to a button becomes button-governed', () => {
    expect(
      liveInitialMuted({
        ...base,
        key: 'drum-machine',
        liveSlot: 'drums',
        savedMuted: true,
        liveStems: ['drums'],
      }),
    ).toBe(false)
  })

  it("'none' keeps a stem-looking name off the buttons and on its saved state", () => {
    expect(
      liveInitialMuted({ ...base, key: 'stem:drums.wav', liveSlot: 'none', savedMuted: true }),
    ).toBe(true)
  })

  it('the full mix stands down only while something else covers the song', () => {
    expect(liveInitialMuted({ ...base, key: 'original', hasMusicalSlotLane: true })).toBe(true)
    expect(liveInitialMuted({ ...base, key: 'original', hasMusicalSlotLane: false })).toBe(false)
  })
})

describe('buildLiveSlotViews — screen, LEDs and presses read ONE list', () => {
  const lane = (key: string, muted = false, active = false, color = '#111') => ({
    key,
    muted,
    active,
    color,
  })

  it('always returns 10 slots in canonical order, present or not', () => {
    const views = buildLiveSlotViews(resolveLiveSlotLanes([{ key: 'stem:bass.wav' }]), [
      lane('stem:bass.wav'),
    ])
    expect(views.length).toBe(LIVE_SLOT_COUNT)
    expect(views.map((v) => v.name)).toEqual([
      'drums',
      'bass',
      'vocals',
      'other',
      'guitar',
      'fx',
      'click',
      'cue',
      'custom1',
      'custom2',
    ])
    // Drums is still button 1 in a song with no drums — just not present.
    expect(views[0]!.present).toBe(false)
    expect(views[1]!.present).toBe(true)
  })

  it('index IS the button number, so pills and pads cannot disagree', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'stem:vocals.wav' },
      { key: 'stem:drums.wav' },
      { key: 'drum-machine' }, // no slot → no button
    ])
    const views = buildLiveSlotViews(slots, [
      lane('stem:vocals.wav'),
      lane('stem:drums.wav'),
      lane('drum-machine'),
    ])
    expect(views[slotIndexByName('drums')]!.keys).toEqual(['stem:drums.wav'])
    expect(views[slotIndexByName('vocals')]!.keys).toEqual(['stem:vocals.wav'])
    expect(views.flatMap((v) => v.keys)).not.toContain('drum-machine')
  })

  it('a lane the song does not have never lights a button', () => {
    // Linked in the saved settings, but absent from THIS song's lanes.
    const slots = resolveLiveSlotLanes([{ key: 'stem:guitar.wav', liveSlot: 'guitar' }])
    const views = buildLiveSlotViews(slots, []) // no lane state → not loaded
    expect(views[slotIndexByName('guitar')]!.present).toBe(false)
  })

  it('a grouped slot reads ON when ANY member sounds, and counts them', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'stem:drums.wav' },
      { key: 'stem:perc.wav', liveSlot: 'drums' },
    ])
    const views = buildLiveSlotViews(slots, [
      lane('stem:drums.wav', true),
      lane('stem:perc.wav', false),
    ])
    const drums = views[slotIndexByName('drums')]!
    expect(drums.count).toBe(2)
    expect(drums.on).toBe(true)
    expect(drums.keys).toEqual(['stem:drums.wav', 'stem:perc.wav'])
  })

  it('reads OFF only when every member is muted', () => {
    const slots = resolveLiveSlotLanes([
      { key: 'stem:drums.wav' },
      { key: 'stem:perc.wav', liveSlot: 'drums' },
    ])
    const views = buildLiveSlotViews(slots, [
      lane('stem:drums.wav', true),
      lane('stem:perc.wav', true),
    ])
    expect(views[slotIndexByName('drums')]!.on).toBe(false)
  })

  it('the glow follows what is actually sounding, not just what is unmuted', () => {
    const slots = resolveLiveSlotLanes([{ key: 'stem:bass.wav' }])
    const stopped = buildLiveSlotViews(slots, [lane('stem:bass.wav', false, false)])
    const playing = buildLiveSlotViews(slots, [lane('stem:bass.wav', false, true)])
    expect(stopped[slotIndexByName('bass')]!.active).toBe(false)
    expect(playing[slotIndexByName('bass')]!.active).toBe(true)
  })

  it('classifies click and cue so their buttons colour correctly', () => {
    const views = buildLiveSlotViews(resolveLiveSlotLanes([{ key: 'click' }, { key: 'cue' }]), [
      lane('click'),
      lane('cue'),
    ])
    expect(views[slotIndexByName('click')]!.kind).toBe('click')
    expect(views[slotIndexByName('cue')]!.kind).toBe('cue')
    expect(views[slotIndexByName('drums')]!.kind).toBe('stem')
  })

  it('labels every button, including empty ones, so the row never reflows', () => {
    const views = buildLiveSlotViews(resolveLiveSlotLanes([]), [])
    expect(views.map((v) => v.label)).toEqual([
      'Drums',
      'Bass',
      'Vocals',
      'Other',
      'Guitar',
      'FX',
      'Click',
      'Cue',
      'Custom 1',
      'Custom 2',
    ])
  })
})

describe('all buttons off means SILENCE, not the full mix coming back', () => {
  const withStems = resolveLiveSlotLanes([
    { key: 'original' },
    { key: 'stem:drums.wav' },
    { key: 'stem:vocals.wav' },
  ])

  it('a song WITH musical lanes keeps the full mix muted', () => {
    expect(hasMusicalSlotLane(withStems)).toBe(true)
    expect(
      liveInitialMuted({
        key: 'original',
        savedMuted: false,
        liveStems: undefined,
        hasMusicalSlotLane: hasMusicalSlotLane(withStems),
      }),
    ).toBe(true)
  })

  it('even when the project standard stems match NOTHING this song has', () => {
    // The old rule keyed off "is any stem audible by config" — with liveStems
    // set to guitar-less defaults that went false and the full mix played
    // underneath the stems, and kept playing with every button off.
    const onlyVocals = resolveLiveSlotLanes([{ key: 'original' }, { key: 'stem:vocals.wav' }])
    expect(
      liveInitialMuted({
        key: 'original',
        savedMuted: false,
        liveStems: ['drums', 'bass'], // this song has neither
        hasMusicalSlotLane: hasMusicalSlotLane(onlyVocals),
      }),
    ).toBe(true)
  })

  it('a song with NO musical lanes still plays its full mix', () => {
    const bare = resolveLiveSlotLanes([{ key: 'original' }, { key: 'click' }, { key: 'cue' }])
    expect(hasMusicalSlotLane(bare)).toBe(false)
    expect(
      liveInitialMuted({
        key: 'original',
        savedMuted: false,
        liveStems: undefined,
        hasMusicalSlotLane: hasMusicalSlotLane(bare),
      }),
    ).toBe(false)
  })

  it('click and cue alone do not count as covering the song', () => {
    expect(hasMusicalSlotLane(resolveLiveSlotLanes([{ key: 'click' }]))).toBe(false)
    expect(hasMusicalSlotLane(resolveLiveSlotLanes([{ key: 'cue' }]))).toBe(false)
  })

  it('a lane on ANY musical button counts, including guitar, FX and Custom', () => {
    for (const slot of [
      'drums',
      'bass',
      'vocals',
      'other',
      'guitar',
      'fx',
      'custom1',
      'custom2',
    ] as const) {
      const lanes = resolveLiveSlotLanes([{ key: 'stem:x.wav', liveSlot: slot }])
      expect(hasMusicalSlotLane(lanes)).toBe(true)
    }
  })

  it('a machine lane does NOT count unless it is linked to a button', () => {
    expect(hasMusicalSlotLane(resolveLiveSlotLanes([{ key: 'drum-machine' }]))).toBe(false)
    expect(
      hasMusicalSlotLane(resolveLiveSlotLanes([{ key: 'drum-machine', liveSlot: 'drums' }])),
    ).toBe(true)
  })
})

describe('click and cue are real live buttons', () => {
  it('both get a button and are marked with their own kind', () => {
    const slots = resolveLiveSlotLanes([{ key: 'click' }, { key: 'cue' }])
    const views = buildLiveSlotViews(slots, [
      { key: 'click', muted: true, active: false, color: '#fff' },
      { key: 'cue', muted: false, active: true, color: '#f50' },
    ])
    const click = views[slotIndexByName('click')]!
    const cue = views[slotIndexByName('cue')]!
    expect(click.present).toBe(true)
    expect(click.kind).toBe('click')
    expect(click.on).toBe(false) // muted
    expect(cue.present).toBe(true)
    expect(cue.kind).toBe('cue')
    expect(cue.on).toBe(true)
    expect(cue.active).toBe(true)
  })

  it('absent is distinguishable from off — different state, not just styling', () => {
    const views = buildLiveSlotViews(resolveLiveSlotLanes([{ key: 'click' }]), [
      { key: 'click', muted: true, active: false, color: '#fff' },
    ])
    const click = views[slotIndexByName('click')]!
    const cue = views[slotIndexByName('cue')]!
    expect(click.present && !click.on).toBe(true) // present but OFF
    expect(cue.present).toBe(false) // ABSENT
  })
})

describe('LIVE FAILS CLOSED: a lane on no button is not in the show (regression)', () => {
  /**
   * Reported from a real stage, at volume: "Calleth You Cometh I" kept playing
   * a bass lane with ALL EIGHT stem buttons off. The lane was not linked to any
   * live button, so no control on the stage could touch it — and the old rule
   * carried its ARRANGING-mixer mute into live, which is mute-as-admission,
   * the first failure the live-audio architecture names.
   *
   * The rule now: linked to a button → the button decides. Not linked → muted
   * in live, whatever the editor's mix said. Linking IS the admission.
   */
  const base = { liveStems: undefined, hasMusicalSlotLane: true }

  it('an unlinked machine lane is MUTED in live even if it was audible while editing', () => {
    for (const key of ['bass-machine', 'bass-gen', 'drums-gen', 'chord-machine', 'arp-machine']) {
      expect(
        liveInitialMuted({ key, savedMuted: false, ...base }),
        `${key} sounded with no button to silence it`,
      ).toBe(true)
    }
  })

  it('an unlinked extra take / unrecognised stem is muted too', () => {
    expect(liveInitialMuted({ key: 'stem:tambourine-take3.wav', savedMuted: false, ...base })).toBe(true)
  })

  it('LINKING a lane to a button admits it — and the button then decides', () => {
    // Linked to bass: audible exactly when the project's live stems include bass.
    expect(
      liveInitialMuted({
        key: 'bass-machine',
        liveSlot: 'bass',
        savedMuted: false,
        liveStems: ['bass', 'drums'],
        hasMusicalSlotLane: true,
      }),
    ).toBe(false)
    expect(
      liveInitialMuted({
        key: 'bass-machine',
        liveSlot: 'bass',
        savedMuted: false,
        liveStems: ['drums'],
        hasMusicalSlotLane: true,
      }),
    ).toBe(true)
  })

  it('the full mix keeps its own rule — silent when buttons own the song, audible when nothing else can play', () => {
    expect(liveInitialMuted({ key: 'original', savedMuted: false, liveStems: undefined, hasMusicalSlotLane: true })).toBe(true)
    expect(liveInitialMuted({ key: 'original', savedMuted: false, liveStems: undefined, hasMusicalSlotLane: false })).toBe(false)
  })
})

describe('a live choice is remembered per song', () => {
  /**
   * Reported: "if i go in and turn off custom 1 one time it needs to stay that
   * way. right now for some song custom1 and 2 is always turned on from the
   * start."
   *
   * Live deliberately ignores the ARRANGING mute, so a whole set opens from one
   * backing-track configuration regardless of editing history. But that also
   * threw away deliberate live decisions: pressing Custom 1 off was forgotten
   * the moment the song reloaded, every time.
   *
   * `savedLiveMuted` is the distinction. Absent = never decided, project
   * start-state applies. Present = the operator pressed the button and meant it.
   */
  const linked = (savedLiveMuted?: boolean) =>
    liveInitialMuted({
      key: 'chord-machine',
      liveSlot: 'custom1',
      savedMuted: false,
      savedLiveMuted,
      liveStems: undefined,
      liveSlots: undefined,
      hasMusicalSlotLane: true,
    })

  it('THE BUG: an untouched Custom 1 follows the project and starts ON', () => {
    expect(linked(undefined)).toBe(false)
  })

  it('turning it off is remembered', () => {
    expect(linked(true)).toBe(true)
  })

  it('turning it back ON is remembered too, even against a project default of off', () => {
    // `false` has to be stored, not treated as absent — otherwise "I switched
    // this on for this song" is indistinguishable from "never decided".
    expect(
      liveInitialMuted({
        key: 'chord-machine',
        liveSlot: 'custom1',
        savedMuted: false,
        savedLiveMuted: false,
        liveStems: undefined,
        liveSlots: [],
        hasMusicalSlotLane: true,
      }),
    ).toBe(false)
  })

  it('only applies to lanes ON a button — an unlinked lane still fails closed', () => {
    // The reason live ignores saved mute is that a lane with no button has no
    // control surface, so remembering "on" could strand audio nobody can stop.
    // A linked lane can always be switched back, so remembering is safe there
    // and only there.
    expect(
      liveInitialMuted({
        key: 'some-unlinked-lane',
        liveSlot: 'none',
        savedMuted: false,
        savedLiveMuted: false,
        liveStems: undefined,
        liveSlots: undefined,
        hasMusicalSlotLane: true,
      }),
    ).toBe(true)
  })

  it('a remembered stem choice beats the project start-state too', () => {
    expect(
      liveInitialMuted({
        key: 'stem:vocals.wav',
        liveSlot: 'vocals',
        savedMuted: false,
        savedLiveMuted: false,
        liveStems: ['drums', 'bass'],
        liveSlots: undefined,
        hasMusicalSlotLane: true,
      }),
    ).toBe(false)
  })
})
