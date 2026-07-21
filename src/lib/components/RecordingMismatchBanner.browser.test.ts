/**
 * The recording-mismatch warning must be SILENT for the everyday case (a
 * bandmate holding a different encoding of the same master) and loud only for a
 * genuinely different cut. A banner that cries wolf gets ignored, which is the
 * failure mode this whole feature exists to avoid.
 */
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import RecordingMismatchBanner from './RecordingMismatchBanner.svelte'
import { setSongMap } from '$lib/stores/songMap'
import { createEmptySongMap } from '$lib/songmap/factory'
import type { AudioFingerprint } from '$lib/audio/audioFingerprint'
import type { SongMap } from '$lib/songmap/types'

function fp(durationSec: number, shape: number[]): AudioFingerprint {
  return {
    version: 1,
    durationSec,
    envelope: Array.from({ length: 64 }, (_, i) => shape[Math.floor((i / 64) * shape.length)]!),
  }
}

const MASTER = fp(222, [10, 120, 240, 120, 240, 60, 255, 30])
const TRANSCODE = fp(222.03, [12, 118, 238, 122, 242, 58, 255, 32])
const OTHER_MIX = fp(222, [240, 30, 60, 255, 10, 200, 90, 150])
const LONGER_CUT = fp(251, [10, 120, 240, 120, 240, 60, 255, 30])

/** Rendered text with markup whitespace collapsed — template line breaks
 *  otherwise split phrases across newlines and defeat a naive match. */
function alertText(): string {
  return (document.querySelector('[role="alert"]')?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function load(local?: AudioFingerprint, shared?: AudioFingerprint): void {
  const base = createEmptySongMap({ now: () => '2020-01-01T00:00:00.000Z' })
  setSongMap({
    ...base,
    audio: local
      ? { fileName: 'a.wav', trim: { startSec: 0, endSec: 1 }, source: 'upload', fingerprint: local }
      : undefined,
    expectedAudio: shared ? { fileName: 'shared.wav', fingerprint: shared } : undefined,
  } as SongMap)
}

describe('recording mismatch banner (real browser)', () => {
  it('stays silent for a different encoding of the same master', async () => {
    load(MASTER, TRANSCODE)
    render(RecordingMismatchBanner)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('stays silent when the song is not shared', async () => {
    load(MASTER, undefined)
    render(RecordingMismatchBanner)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('stays silent when there is nothing to compare', async () => {
    load(undefined, undefined)
    render(RecordingMismatchBanner)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('warns with BOTH durations when the cut is a different length', async () => {
    load(MASTER, LONGER_CUT)
    const screen = render(RecordingMismatchBanner)
    await expect.element(screen.getByRole('alert')).toBeInTheDocument()
    const text = alertText()
    expect(text).toContain('3:42')
    expect(text).toContain('4:11')
  })

  it('warns about a different mix when the lengths agree', async () => {
    load(MASTER, OTHER_MIX)
    render(RecordingMismatchBanner)
    expect(alertText()).toMatch(/different mix or take/i)
  })

  it('never leaks internals into the copy', async () => {
    load(MASTER, OTHER_MIX)
    render(RecordingMismatchBanner)
    const text = alertText().toLowerCase()
    // Whole words only — "sha" is a substring of "shared song", which is fine.
    for (const re of [/\bfingerprints?\b/, /\bsha\b/, /sha256/, /\bhash(es|ed)?\b/, /\benvelope\b/, /\bcorrelation\b/]) {
      expect(text, `leaked ${re}`).not.toMatch(re)
    }
  })

  it('can be dismissed for the session', async () => {
    load(MASTER, OTHER_MIX)
    const screen = render(RecordingMismatchBanner)
    await screen.getByRole('button', { name: /dismiss/i }).click()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
})
