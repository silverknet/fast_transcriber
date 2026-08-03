/**
 * THE SOUND-PATH SENTINEL — no new way to make noise gets in unnoticed.
 *
 * The live-audio architecture (docs/goal-plan.md, Phase 1) requires "a
 * repository sentinel [that] detects production destination connections outside
 * the executor boundary". This is that sentinel, for the CURRENT system: it
 * pins every place production code can reach a speaker, and fails when a new
 * one appears.
 *
 * Why it earns its keep: the worst class of bug this app has had is sound with
 * no owner. The chord-jam voices played through their own audio path during
 * mixer and LIVE playback with no channel, no fader and no mute — nothing
 * visible anywhere. No unit test can fail on a *new* rogue path it has never
 * heard of; a census can.
 *
 * Two audited patterns:
 *
 *  - `new AudioContext(` — a HARDWARE output context. Every one is an
 *    independent output the mixer's gates cannot touch. (`OfflineAudioContext`
 *    is deliberately not counted: it renders to memory, not to air.)
 *  - `.connect(…destination` — an actual tap into a context's output.
 *
 * If this test just failed on your change: you added a way for the app to make
 * sound. Either route it through `MixerEngine` / the shared `audioDevice()`
 * graph so the mixer's mute/suppression gates apply — or, if it genuinely needs
 * its own path, add it to the allowlist WITH a justification, and account for
 * it in docs/architecture/audio-system-overview.md. Do not bump a number to
 * make CI green; the number is the point.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

/** file → { pattern → allowed count }, with why each entry may make sound. */
const ALLOWED: Record<string, { contexts?: number; destinations?: number; why: string }> = {
  // ── Engines (the sanctioned owners) ────────────────────────────────────
  'lib/audio/mixerEngine.ts': {
    destinations: 2,
    why: 'THE mixer output stage: stereo tail + split merger. The place sound is supposed to leave.',
  },
  'lib/audio/transport.svelte.ts': {
    destinations: 2,
    why: 'Editor transport: click master + its shifter-latency splice, on the shared context.',
  },
  'lib/audio/playbackController.svelte.ts': {
    destinations: 2,
    why: 'Home/trim playback engine: source + click, one shared context.',
  },
  // ── Editor-scoped voices on the shared device ──────────────────────────
  'lib/audio/liveCueScheduler.ts': {
    destinations: 1,
    why: 'Constructor connects its gain to a destination the CALLER chooses (mixer passes its cue bus).',
  },
  'lib/audio/chordKick.ts': {
    destinations: 3,
    why: 'Chord-audition kick voice, editor-only audition path.',
  },
  'lib/audio/clientPitchShift.ts': {
    destinations: 2,
    why: 'Preview path for the pitch shifter.',
  },
  'lib/audio/mastering.ts': {
    destinations: 2,
    why: 'Master chain tail wiring inside the engine graph.',
  },
  'lib/audio/clickSounds.ts': {
    destinations: 2,
    why: 'Click voice layers connect to the destination node they are HANDED, not to a context.',
  },
  'lib/audio/debugClickTrack.ts': {
    destinations: 1,
    why: 'Metronome voice, connects to the caller-provided master gain.',
  },
  'lib/audio/bassNormalizeGain.ts': {
    destinations: 1,
    why: 'Offline analysis graph (renders to memory).',
  },
  'lib/audio/renderBassVoice.ts': {
    destinations: 1,
    why: 'Offline bass render (to memory).',
  },
  // ── Probes and rig verification (deliberately independent outputs) ─────
  'lib/audio/multichannelProbe.ts': {
    contexts: 1,
    destinations: 1,
    why: 'The throwaway probe context — MUST be separate so a failed probe cannot silence the app.',
  },
  'lib/audio/outputDevice.ts': {
    contexts: 1,
    why: 'Reads maxChannelCount from a throwaway context; closes it immediately.',
  },
  'lib/audio/rigTestSignal.ts': {
    destinations: 1,
    why: 'The level-capped rig test tone, connected to a caller-provided tap.',
  },
  // ── Pages/components with their own decode or audition contexts ────────
  'lib/components/DrumTrackPanel.svelte': {
    contexts: 1,
    destinations: 2,
    why: 'Drum kit audition panel.',
  },
  'lib/components/WaveformPlayer.svelte': {
    contexts: 1,
    why: 'Decode context for waveform peaks.',
  },
  'lib/components/XAirSettingsPanel.svelte': {
    contexts: 1,
    why: 'Disposable probe reading destination.maxChannelCount (the multichannel gate). Closed immediately; never plays.',
  },
  'routes/edit/+page.svelte': { contexts: 1, why: 'Editor decode context.' },
  'routes/set/+page.svelte': { contexts: 1, why: 'Set page decode context.' },
  'routes/rig/+page.svelte': {
    destinations: 1,
    why: 'Rig page test-tone tap on the shared device (the meter watches the same node).',
  },
  'routes/debug/colors/+page.svelte': { contexts: 1, why: 'Debug page.' },
  'routes/project/debug/ending/+page.svelte': {
    contexts: 1,
    destinations: 1,
    why: 'Debug page for song endings — its own throwaway context, never reached from Live.',
  },
  'routes/debug/click-sounds/+page.svelte': { destinations: 2, why: 'Click sound debug page.' },
}

const CONTEXT_RE = /new AudioContext\(/g
const DEST_RE = /\.connect\([A-Za-z_.]*destination/g

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|svelte)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

function census(): Map<string, { contexts: number; destinations: number }> {
  const found = new Map<string, { contexts: number; destinations: number }>()
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    const contexts = text.match(CONTEXT_RE)?.length ?? 0
    const destinations = text.match(DEST_RE)?.length ?? 0
    if (contexts || destinations) {
      found.set(file.slice(SRC.length + 1).replace(/\\/g, '/'), { contexts, destinations })
    }
  }
  return found
}

describe('sound-path sentinel', () => {
  const found = census()

  it('no file makes sound that the allowlist does not account for', () => {
    const rogue: string[] = []
    for (const [file, counts] of found) {
      const allowed = ALLOWED[file]
      if (!allowed) {
        rogue.push(`${file} (contexts ${counts.contexts}, destination taps ${counts.destinations}) — NEW sound path with no owner`)
        continue
      }
      if (counts.contexts > (allowed.contexts ?? 0)) {
        rogue.push(`${file} — hardware AudioContexts grew: ${allowed.contexts ?? 0} → ${counts.contexts}`)
      }
      if (counts.destinations > (allowed.destinations ?? 0)) {
        rogue.push(`${file} — destination taps grew: ${allowed.destinations ?? 0} → ${counts.destinations}`)
      }
    }
    expect(
      rogue,
      `New audio output path(s). Route through MixerEngine/audioDevice so the mixer's gates apply, or allowlist WITH justification:\n  ${rogue.join('\n  ')}`,
    ).toEqual([])
  })

  it('the allowlist is not padded with entries that no longer exist', () => {
    // A stale allowance is a pre-approved hole. Shrinkage must be banked.
    const stale: string[] = []
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      const counts = found.get(file)
      if (!counts) {
        stale.push(`${file} — allowlisted but matches nothing; remove the entry`)
        continue
      }
      if ((allowed.contexts ?? 0) > counts.contexts) {
        stale.push(`${file} — allows ${allowed.contexts} context(s), only ${counts.contexts} exist; tighten`)
      }
      if ((allowed.destinations ?? 0) > counts.destinations) {
        stale.push(`${file} — allows ${allowed.destinations} tap(s), only ${counts.destinations} exist; tighten`)
      }
    }
    expect(stale, stale.join('\n')).toEqual([])
  })

  it('every allowlist entry says why it may make sound', () => {
    for (const [file, entry] of Object.entries(ALLOWED)) {
      expect(entry.why.length, `${file} needs a real justification`).toBeGreaterThan(10)
    }
  })
})
