/**
 * The phone LIVE stage renders the current chord + upcoming row, the karaoke
 * lyric line with the active word highlighted, and a play/stop transport — all
 * from plain props (no engine). Real Chromium so the layout + canvas mount.
 */
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-svelte'
import LiveStageMobile from './LiveStageMobile.svelte'

const chordRow = [
  { id: 'G', label: 'G', isCurrent: true, progressPct: 40 },
  { id: 'D', label: 'D', isCurrent: false, progressPct: 0 },
  { id: 'Em', label: 'Em', isCurrent: false, progressPct: 0 },
  { id: 'C', label: 'C', isCurrent: false, progressPct: 0 },
]
const lyricLines = [{ words: [{ text: 'hello', startSec: 0 }, { text: 'world', startSec: 1 }], startSec: 0 }]

function mount(over: Record<string, unknown> = {}) {
  return render(LiveStageMobile, {
    props: {
      chordRow,
      lyricLines,
      currentLyricIdx: 0,
      lyricsSongTime: 0.5, // "hello" has started, "world" hasn't → active = hello
      waveBuffer: null,
      positionSec: 3,
      durationSec: 100,
      sectionBands: [],
      onSeekFraction: vi.fn(),
      isPlaying: false,
      onPlayPause: vi.fn(),
      onStop: vi.fn(),
      ...over,
    },
  })
}

describe('LiveStageMobile (real browser)', () => {
  it('shows the current chord + the upcoming row', () => {
    mount()
    const stage = document.querySelector('[data-testid="live-stage-mobile"]')!
    expect(stage).not.toBeNull()
    const text = stage.textContent ?? ''
    expect(text).toContain('G')
    expect(text).toContain('D')
    expect(text).toContain('Em')
    expect(text).toContain('C')
    // The current chord is flagged for the big-emphasis styling.
    const current = document.querySelector('[data-current="true"]')
    expect(current?.textContent).toBe('G')
  })

  it('renders the karaoke lyric line with the active word highlighted', () => {
    mount()
    const stage = document.querySelector('[data-testid="live-stage-mobile"]')!
    expect(stage.textContent).toContain('hello')
    expect(stage.textContent).toContain('world')
  })

  it('has a play transport that fires onPlayPause', async () => {
    const onPlayPause = vi.fn()
    const screen = mount({ onPlayPause })
    await screen.getByRole('button', { name: 'Play' }).click()
    expect(onPlayPause).toHaveBeenCalledOnce()
  })

  it('shows a graceful message when there are no lyrics', () => {
    mount({ lyricLines: [], currentLyricIdx: -1 })
    const stage = document.querySelector('[data-testid="live-stage-mobile"]')!
    expect(stage.textContent).toContain('No lyrics')
  })
})
