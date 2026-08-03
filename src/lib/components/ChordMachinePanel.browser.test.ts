/**
 * The chords/arp machine editor in real Chromium.
 *
 * What matters here is different from the drum and bass panels: those write
 * into the `.smap`, so their tests assert store shape. This one writes into the
 * `chordJam` singleton — the SAME state the Chords tab drives — so the tests
 * assert that a knob move lands there and that the host is told to re-schedule.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { render } from 'vitest-browser-svelte'
import ChordMachinePanel from './ChordMachinePanel.svelte'
import { chordJam } from '$lib/audio/chordJam.svelte'

function setup(voice: 'keys' | 'arp') {
  let changes = 0
  let removed = 0
  const screen = render(ChordMachinePanel, {
    voice,
    onChanged: () => {
      changes++
    },
    onRemove: () => {
      removed++
    },
  })
  return { screen, changed: () => changes, removed: () => removed }
}

beforeEach(() => {
  // A known baseline; these are per-device settings, not per-song.
  chordJam.keysOn = true
  chordJam.arpOn = true
  chordJam.keysOctave = 0
  chordJam.arpOctave = 0
  chordJam.arpOctaves = 1
  chordJam.arpSwing = 0
  chordJam.arpRate = '1/8'
  chordJam.arpDirection = 'up'
  chordJam.keysVolume = 0.5
  chordJam.arpVolume = 0.5
})

describe('chords panel', () => {
  it('renders the chord voice, not the arp one', async () => {
    const { screen } = setup('keys')
    await expect.element(screen.getByRole('heading', { name: 'Chords' })).toBeInTheDocument()
    await expect.element(screen.getByLabelText('Chord sound')).toBeInTheDocument()
    expect(screen.container.querySelector('[aria-label="Arp swing"]')).toBeNull()
  })

  it('an octave nudge lands in chordJam and tells the host', async () => {
    const { screen, changed } = setup('keys')
    await screen.getByLabelText('Octave up').click()
    expect(chordJam.keysOctave).toBe(1)
    expect(changed()).toBeGreaterThan(0)
  })

  it('does not nudge past the allowed range', async () => {
    chordJam.keysOctave = 2 // JAM_OCT_MAX
    const { screen } = setup('keys')
    await expect.element(screen.getByLabelText('Octave up')).toBeDisabled()
  })

  it('changing the sound swaps the patch, not just the name', async () => {
    const { screen, changed } = setup('keys')
    const before = chordJam.keysPatch.name
    const select = screen.getByLabelText('Chord sound')
    const options = [...screen.container.querySelectorAll<HTMLOptionElement>('option')].map(
      (o) => o.value,
    )
    const other = options.find((o) => o !== chordJam.keysInstrument)
    expect(other, 'needs a second instrument to pick').toBeTruthy()
    await select.selectOptions(other!)
    expect(chordJam.keysInstrument).toBe(other)
    // The patch must follow the picker — otherwise the lane keeps the old sound.
    expect(chordJam.keysPatch.name).not.toBe(before)
    expect(changed()).toBeGreaterThan(0)
  })

  it('the trash button asks the mixer to drop the lane', async () => {
    const { screen, removed } = setup('keys')
    await screen.getByTitle('Remove the chords track').click()
    expect(removed()).toBe(1)
  })

  it('removing the lane leaves the Chords tab preview switch alone', async () => {
    // Regression: this used to flip `chordJam.keysOn`, so deleting a mixer
    // track silently turned off "hear chords" in the editor too.
    const { screen } = setup('keys')
    chordJam.keysOn = true
    await screen.getByTitle('Remove the chords track').click()
    expect(chordJam.keysOn).toBe(true)
  })
})

describe('arp panel', () => {
  it('renders the arp controls, including the two the lane used to ignore', async () => {
    const { screen } = setup('arp')
    await expect.element(screen.getByRole('heading', { name: 'Arp' })).toBeInTheDocument()
    // Octave span and swing exist in the Chords tab; the mixer lane was
    // hardcoding 1 and 0 until they were threaded through.
    await expect.element(screen.getByLabelText('Arp octave span')).toBeInTheDocument()
    await expect.element(screen.getByLabelText('Arp swing')).toBeInTheDocument()
  })

  it('rate and direction land in chordJam', async () => {
    const { screen } = setup('arp')
    await screen.getByLabelText('Arp rate').selectOptions('1/16')
    expect(chordJam.arpRate).toBe('1/16')
    await screen.getByLabelText('Arp direction').selectOptions('down')
    expect(chordJam.arpDirection).toBe('down')
  })

  it('octave span lands as a NUMBER, not the string a select yields', async () => {
    // A string here would silently disable the knob: `octaves ?? 1` passes it
    // through and the arithmetic in octavePool would go wrong.
    const { screen } = setup('arp')
    await screen.getByLabelText('Arp octave span').selectOptions('3')
    expect(chordJam.arpOctaves).toBe(3)
    expect(typeof chordJam.arpOctaves).toBe('number')
  })

  it('edits the arp voice, leaving the chord voice alone', async () => {
    const { screen } = setup('arp')
    await screen.getByLabelText('Octave up').click()
    expect(chordJam.arpOctave).toBe(1)
    expect(chordJam.keysOctave).toBe(0)
  })

  it('its trash button reports the arp lane, not the chords one', async () => {
    const { screen, removed } = setup('arp')
    await screen.getByTitle('Remove the arp track').click()
    expect(removed()).toBe(1)
  })
})
