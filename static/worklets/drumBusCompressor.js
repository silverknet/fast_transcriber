/**
 * The drum bus "glue" compressor, as an AudioWorklet.
 *
 * This is a VERBATIM port of `applyBusCompression` in
 * `src/lib/audio/drumBus.ts` — same stereo-linked peak detector, same
 * one-pole attack/release, same gain law, no knee and no makeup gain.
 *
 * It exists because Web Audio's `DynamicsCompressorNode` uses a different
 * detector and a 30 dB default knee, so it would not sound the same. The
 * offline renderer and the live mixer track have to agree, so the loop is
 * duplicated rather than approximated. If you change the constants in
 * `drumBus.ts`, change them here too — `drumBusLive.browser.test.ts` compares
 * the two and will fail if they drift.
 *
 * Served from `static/`, so it is reachable at `/worklets/drumBusCompressor.js`.
 */

const THRESHOLD = 0.35 // linear (~ -9 dBFS on the pre-normalize bus)
const RATIO = 3
const ATTACK_SEC = 0.005
const RELEASE_SEC = 0.12

class DrumBusCompressor extends AudioWorkletProcessor {
  constructor() {
    super()
    // One-pole coefficients, derived once from the real render quantum rate.
    this.attack = Math.exp(-1 / (ATTACK_SEC * sampleRate))
    this.release = Math.exp(-1 / (RELEASE_SEC * sampleRate))
    // Envelope persists ACROSS blocks — resetting per block would retrigger
    // the attack 375 times a second and destroy the glue.
    this.env = 0
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0) return true

    const l = input[0]
    // Mono input still needs a right channel to read; fall back to left.
    const r = input.length > 1 ? input[1] : input[0]
    const outL = output[0]
    const outR = output.length > 1 ? output[1] : null
    if (!l || !outL) return true

    const frames = l.length
    for (let i = 0; i < frames; i++) {
      const a = Math.abs(l[i])
      const b = Math.abs(r[i])
      const x = a > b ? a : b
      this.env =
        x > this.env
          ? this.attack * this.env + (1 - this.attack) * x
          : this.release * this.env + (1 - this.release) * x

      let gain = 1
      if (this.env > THRESHOLD) {
        gain = Math.pow(this.env / THRESHOLD, 1 / RATIO - 1)
      }
      outL[i] = l[i] * gain
      if (outR) outR[i] = r[i] * gain
    }
    return true
  }
}

registerProcessor('drum-bus-compressor', DrumBusCompressor)
