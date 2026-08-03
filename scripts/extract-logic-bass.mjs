#!/usr/bin/env node
/**
 * Pull a multisampled bass out of the local Logic Sound Library.
 *
 *     node scripts/extract-logic-bass.mjs electric
 *     node scripts/extract-logic-bass.mjs upright
 *
 * Writes `static/bass/<set>/<midi>.wav` — mono 44.1 kHz PCM16, the format the
 * sampler expects. The audio is gitignored: Apple's licence covers using these
 * sounds in your own productions, not shipping them inside an app, so the set
 * simply does not appear on a machine without Logic.
 *
 * WHY A SCRIPT AND NOT A ONE-OFF: the Fingerstyle set was written off as
 * unusable because a first look landed on its `5IFNF*` files — 22 short
 * unpitched noises (slides, fret squeaks) whose names carry nothing. The 94
 * `IBFIL*` files beside them DO encode pitch, and every one of them was
 * verified against detected pitch before this was written (A1 → 55.5 Hz →
 * MIDI 33, scientific notation, exact match on every file checked).
 *
 * Requires `ffmpeg` on PATH.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const NOTE_INDEX = new Map(NOTES.map((n, i) => [n, i]))

const LIB = path.join(homedir(), 'Music', 'Logic Pro Library.bundle', 'Samples')

/**
 * Each set names its source folder and how its filenames encode pitch.
 * `pattern` must capture (note, octave); files that do not match are skipped,
 * which is exactly how the unpitched noise files get ignored.
 */
const SETS = {
  electric: {
    dir: path.join(LIB, 'z_Legacy', 'Bass', 'Fingerstyle Electric Bass'),
    pattern: /^IBFILA1([A-G]#?)(-?\d)X(\d+)\.aif$/i,
    ext: '.aif',
  },
  upright: {
    dir: path.join(LIB, 'z_Legacy', 'Bass', 'Upright Jazz Bass'),
    pattern: /^KBLONS1([A-G]#?)(-?\d)X(\d+)\.aif$/i,
    ext: '.aif',
  },
}

/** Scientific pitch: C-1 is 0, so A1 is 33 — verified against detected pitch. */
function midiOf(note, octave) {
  const idx = NOTE_INDEX.get(note.toUpperCase())
  if (idx === undefined) return null
  return (octave + 1) * 12 + idx
}

function main() {
  const name = process.argv[2]
  const set = SETS[name]
  if (!set) {
    console.error(`usage: extract-logic-bass.mjs <${Object.keys(SETS).join('|')}>`)
    process.exit(2)
  }
  if (!existsSync(set.dir)) {
    console.error(`Not found: ${set.dir}\nThis needs the Logic Sound Library installed.`)
    process.exit(1)
  }
  const outDir = path.join(process.cwd(), 'static', 'bass', name)
  mkdirSync(outDir, { recursive: true })

  // Earliest take per pitch — one take throughout keeps the instrument
  // consistent, where mixing takes makes neighbouring notes sound like
  // different basses.
  const best = new Map()
  for (const file of readdirSync(set.dir)) {
    const m = set.pattern.exec(file)
    if (!m) continue
    const midi = midiOf(m[1], Number(m[2]))
    if (midi === null) continue
    const take = Number(m[3])
    const prev = best.get(midi)
    if (!prev || take < prev.take) best.set(midi, { file, take })
  }
  if (best.size === 0) {
    console.error('No pitched samples matched — has the library layout changed?')
    process.exit(1)
  }

  const midis = [...best.keys()].sort((a, b) => a - b)
  for (const midi of midis) {
    const src = path.join(set.dir, best.get(midi).file)
    const dst = path.join(outDir, `${midi}.wav`)
    // Mono 44.1k PCM16, silence trimmed off the front so the note speaks the
    // instant it is triggered, and peak-normalized so one root is not twice
    // the level of its neighbour.
    execFileSync('ffmpeg', [
      '-nostdin', '-y', '-loglevel', 'error',
      '-i', src,
      '-af', 'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0,dynaudnorm=f=500:g=3:p=0.9:m=1,alimiter=limit=0.95',
      '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le',
      dst,
    ])
  }
  const names = midis.map((m) => `${NOTES[m % 12]}${Math.floor(m / 12) - 1}`)
  console.log(`Wrote ${midis.length} samples to static/bass/${name}/`)
  console.log(`  roots: [${midis.join(', ')}]`)
  console.log(`  notes: ${names.join(' ')}`)
  console.log(`\nPaste the roots into SAMPLE_SOUNDS in src/lib/audio/bassSounds.ts.`)
}

main()
