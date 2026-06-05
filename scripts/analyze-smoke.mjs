#!/usr/bin/env node
/**
 * Live smoke test for the desktop sidecar's `/native/analyze-downbeats`
 * endpoint. Generates a synthetic 6-second 120 BPM click-track WAV in
 * memory, sends it to the sidecar, asserts the response shape, and
 * prints a one-line PASS/FAIL.
 *
 * Run:
 *   node scripts/analyze-smoke.mjs
 *
 * Exit code 0 = green. Non-zero = something on the analyzer path is
 * broken; the script prints the diagnostic.
 *
 * This is the *fastest* way to confirm the analyzer is alive without
 * spinning up the browser. If this passes but a user-facing analyze
 * still fails, the bug is on the web side (trim, fetch, layout
 * redirect, etc.) — not the sidecar.
 */
const SIDECAR_URL = 'http://127.0.0.1:47842'

// ── Generate a click track WAV in memory ──────────────────────────────────
function clickTrackWav(seconds = 6, sampleRate = 44100, bpm = 120) {
  const totalSamples = seconds * sampleRate
  const samplesPerBeat = sampleRate * (60 / bpm) // 0.5s @ 120 BPM = 22050
  const clickDurationSamples = Math.floor(sampleRate * 0.02) // 20 ms

  const headerSize = 44
  const dataSize = totalSamples * 2 // 16-bit mono
  const buffer = Buffer.alloc(headerSize + dataSize)

  // RIFF header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  // fmt subchunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // PCM subchunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // 1 channel
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  // data subchunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // Samples: brief 1 kHz tone burst at each beat.
  for (let i = 0; i < totalSamples; i++) {
    const sampleInBeat = i % samplesPerBeat
    let amp = 0
    if (sampleInBeat < clickDurationSamples) {
      const t = i / sampleRate
      amp = Math.sin(2 * Math.PI * 1000 * t) * 16000
    }
    buffer.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(amp))), headerSize + i * 2)
  }
  return buffer
}

// ── Probe ───────────────────────────────────────────────────────────────────
async function ping() {
  try {
    const r = await fetch(`${SIDECAR_URL}/ping`)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

async function analyze(wav) {
  const r = await fetch(`${SIDECAR_URL}/native/analyze-downbeats`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wav,
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '<no body>')
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`)
  }
  return r.json()
}

// ── Main ────────────────────────────────────────────────────────────────────
const probe = await ping()
if (!probe) {
  console.error('FAIL — sidecar unreachable at', SIDECAR_URL)
  console.error('       Start BarBro Desktop (or `cd desktop && npm run dev`) and retry.')
  process.exit(2)
}
console.log(`Sidecar: ${probe.name} v${probe.version}`)

const wav = clickTrackWav(6)
console.log(`Sending ${(wav.length / 1024).toFixed(0)} KB synthetic click track…`)
const t0 = Date.now()
let result
try {
  result = await analyze(wav)
} catch (e) {
  console.error('FAIL — analyzer error:', e.message)
  process.exit(3)
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

// ── Assertions ─────────────────────────────────────────────────────────────
const issues = []
if (result?.ok !== true) issues.push(`response.ok is not true (got ${result?.ok})`)
const beats = result?.data?.beats
if (!Array.isArray(beats)) issues.push('response.data.beats is not an array')
else if (beats.length === 0) issues.push('beats array is empty (analyzer found nothing in a clean click track — madmom is broken)')
else {
  const sample = beats[0]
  if (typeof sample?.time !== 'number') issues.push('beats[0].time is not a number')
  if (typeof sample?.beatInBar !== 'number') issues.push('beats[0].beatInBar is not a number')
  // Sanity: 6s of 120 BPM = 12 beats; allow some boundary slack.
  if (beats.length < 8 || beats.length > 16) {
    issues.push(`expected 8-16 beats in 6s @ 120 BPM, got ${beats.length}`)
  }
  // Bar-relative position should range 1..N
  const seenPositions = new Set(beats.map((b) => b.beatInBar))
  if (!seenPositions.has(1)) issues.push('no downbeat (beatInBar=1) in result')
}

if (issues.length > 0) {
  console.error(`FAIL after ${elapsed}s — ${issues.length} issue(s):`)
  for (const i of issues) console.error('  ·', i)
  console.error('Raw response:', JSON.stringify(result).slice(0, 400))
  process.exit(4)
}

console.log(`PASS  · ${beats.length} beats, took ${elapsed}s`)
console.log(`        sample: ${JSON.stringify(beats.slice(0, 3))}…`)
