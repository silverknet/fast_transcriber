/**
 * Transpose must work EVERYWHERE, and must skip exactly the right things.
 *
 * This has now broken three separate ways, each silent:
 *   - the mixer's `setPlaybackRate` was deleted, so Overview never transposed;
 *   - `transposeAudioEnabled` (the AUDIO pitch-shift gate) was also gating MIDI
 *     NOTE transpose, so the generated bass lane stayed in the old key;
 *   - nothing rebuilt the MIDI lanes when the transpose changed, so they kept
 *     playing the old key while the stems moved.
 *
 * The rules, in one place:
 *   AUDIO lanes  → follow the engine's playback rate (varispeed).
 *   MIDI lanes   → move their NOTES; never re-pitch their audio.
 *   DRUMS        → neither. A transposed snare is just a worse snare.
 *
 * Source-scraped because the wiring spans components that need an AudioContext
 * and a project to mount.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The full argument list of `fn(...)`, brace-balanced.
 *
 * A naive /fn\(([^)]*)\)/ stops at the first `)`, which for a call containing
 * a nested call captures only the prefix — and then happily "passes" while the
 * real arguments go unchecked. That exact hole let a drum-transpose regression
 * through this file's first draft.
 */
function tagProps(src: string, tag: string): string | null {
  const at = src.indexOf(`<${tag}`)
  if (at < 0) return null
  // Walk to the end of the opening tag, ignoring '>' inside {...} expressions.
  let depth = 0
  for (let i = at + tag.length + 1; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return src.slice(at + tag.length + 1, i)
  }
  return null
}

function callArgs(src: string, fn: string): string | null {
  const at = src.indexOf(`${fn}(`)
  if (at < 0) return null
  let depth = 0
  for (let i = at + fn.length; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) return src.slice(at + fn.length + 1, i)
    }
  }
  return null
}

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const mixer = () => read('./MixerView.svelte')
const store = () => read('../stores/transposeSettings.svelte.ts')

/** Every file that could plausibly hold transpose knowledge. */
const SURFACES: [string, () => string][] = [
  ['transposeSettings.svelte.ts', store],
  ['MixerView.svelte', mixer],
  ['MixerPanel.svelte', () => read('./editor/MixerPanel.svelte')],
  ['edit/+page.svelte', () => read('../../routes/edit/+page.svelte')],
]
const editPage = () => read('../../routes/edit/+page.svelte')

describe('transpose: the slow render path stays off', () => {
  it('is disabled in the editor', () => {
    expect(editPage()).toMatch(/const transposeAudioEnabled: boolean = false/)
  })

  it('is disabled in the mixer', () => {
    // `true` here blocks the load behind "Preparing transposed …" and THROWS for
    // any song without a local project folder — which reads as no audio at all.
    expect(mixer()).toMatch(/const transposeAudioEnabled: boolean = false/)
  })
})

describe('transpose: every playback surface applies it', () => {
  it('the editor drives its transport from the semitone', () => {
    expect(editPage()).toContain('transport.setTransposeSemitones(')
    expect(editPage()).toContain('transport.setTempoHold(')
  })

  it('the mixer drives its own engine', () => {
    expect(mixer()).toContain('setPlaybackRate')
  })

  it('the editor keeps the varispeed toggle and the artifacts dial', () => {
    const s = editPage()
    expect(s).toContain('setVarispeedAudio')
    expect(s).toContain('setTempoHold')
    expect(s).toContain('heldTempoPercent')
  })
})

describe('transpose: the value actually reaches the mixer', () => {
  /**
   * THE bug this file originally missed entirely.
   *
   * Every wire below existed and every other check here passed, while transpose
   * did nothing at all — because `/edit` rendered `<MixerPanel>` WITHOUT
   * `transposeSemitones`, so it defaulted to null and MixerView fell back to the
   * song's `transpose.baseSemitones` (0). A grep for "is the wiring there"
   * cannot catch a value that is simply never handed over, which is why the
   * assertions here are about the CHAIN, end to end.
   *
   * These are still source checks. They are not proof that audio changes pitch;
   * only listening is. They exist so this specific silent break cannot recur.
   */
  it('/edit hands its personal transpose to the mixer panel', () => {
    const props = tagProps(editPage(), 'MixerPanel')
    expect(props, '<MixerPanel> not found in /edit').not.toBeNull()
    expect(props).toContain('transposeSemitones')
  })

  it('/edit also hands over the varispeed switch and the dial', () => {
    // Otherwise toggling the switch does nothing until the mixer remounts.
    const props = tagProps(editPage(), 'MixerPanel') ?? ''
    expect(props).toContain('varispeedAudio')
    expect(props).toContain('tempoHold')
  })

  it('MixerPanel forwards all three to MixerView', () => {
    const props = tagProps(read('./editor/MixerPanel.svelte'), 'MixerView')
    expect(props, '<MixerView> not found in MixerPanel').not.toBeNull()
    expect(props).toContain('transposeSemitonesOverride={transposeSemitones}')
    expect(props).toContain('varispeedAudio')
    expect(props).toContain('tempoHold')
  })

  it('ONE module knows where the transpose is stored', () => {
    // The point of the store: no second copy of this knowledge. Two components
    // reading the same localStorage keys is what let the editor and the mixer
    // silently disagree, and what left the live stage at concert pitch.
    const owners = ['barbro::xpose::', 'barbro:transposeVarispeed', 'barbro:transposeTempoHold']
      .map((key) => ({
        key,
        files: SURFACES.filter(([, read]) => read().includes(key)).map(([name]) => name),
      }))
    for (const { key, files } of owners) {
      expect(files, `${key} is known by more than the store: ${files.join(', ')}`).toEqual([
        'transposeSettings.svelte.ts',
      ])
    }
  })
})

describe('transpose: MIDI lanes move their notes', () => {
  it('the bass machine lane is built with the transpose', () => {
    expect(mixer()).toMatch(/createBassMachineInstrument\([^)]*transposeSemitones/s)
  })

  it('the chord and arp lanes are built with the transpose', () => {
    const s = mixer()
    expect(s).toMatch(/createChordMachineInstrument\([^)]*'keys',\s*transposeSemitones/s)
    expect(s).toMatch(/createChordMachineInstrument\([^)]*'arp',\s*transposeSemitones/s)
  })

  it('note transpose is NOT gated on the audio pitch-shift flag', () => {
    // These are two unrelated things; conflating them silently froze the
    // generated bass lane at the written pitch.
    expect(mixer()).not.toMatch(/transposeAudioEnabled\s*\?\s*transposeSemitones\s*:\s*0/)
  })

  it('changing the transpose rebuilds the pitched lanes', () => {
    const s = mixer()
    expect(s).toContain('PITCHED_MACHINE_LANES')
    // Drums must NOT be in that list.
    const list = /const PITCHED_MACHINE_LANES = \[([^\]]*)\]/.exec(s)?.[1] ?? ''
    expect(list).toContain('bass-machine')
    expect(list).not.toContain('drum-machine')
  })
})

describe('transpose: drums are exempt', () => {
  it('the drum lane is built WITHOUT a transpose argument', () => {
    const s = mixer()
    const call = callArgs(s, 'createDrumMachineInstrument')
    expect(call, 'drum instrument call not found').not.toBeNull()
    expect(call).not.toContain('transposeSemitones')
  })

  it('drum samples never follow the playback rate', () => {
    const s = read('../audio/drumMidiInstrument.ts')
    expect(s).toContain('src.playbackRate.value = 1')
    expect(s).not.toMatch(/src\.playbackRate\.value\s*=\s*rate/)
  })

  it('no drum module applies a note transpose', () => {
    for (const f of ['../audio/drumPart.ts', '../audio/drumMachineTrack.ts']) {
      expect(read(f), f).not.toContain('transposeMidiNote')
    }
  })
})

describe('transpose: MIDI voices are not double-shifted', () => {
  it('the bass voice does not re-pitch by the playback rate', () => {
    // Notes are already transposed; multiplying by the rate too lands a +2
    // transpose about 4 semitones up.
    const s = read('../audio/bassVoiceGraph.ts')
    expect(s).not.toMatch(/osc\.frequency\.value\s*=\s*f0\s*\*\s*rate/)
    expect(s).not.toMatch(/playbackRate\.value\s*=\s*2\s*\*\*[^\n]*\*\s*rate/)
  })
})
