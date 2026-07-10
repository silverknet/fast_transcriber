/**
 * Client-side audio pitch-shift via `signalsmith-stretch` (MIT, JS/WASM).
 *
 * Renders a NEW `AudioBuffer` shifted by N semitones, in-browser, using an
 * `OfflineAudioContext` + the Signalsmith Stretch AudioWorklet. This replaces
 * the old sidecar (Rubber Band / librosa) round-trip:
 *   - free to ship (MIT, no licensed binary),
 *   - no sidecar dependency, and
 *   - no full-file WAV encode/transfer/decode latency.
 *
 * Pitch shift only (playback `rate = 1`), so the output length matches the
 * input. The worklet has an intrinsic processing latency; we render a tail of
 * extra silence and trim the leading latency so the result stays sample-aligned
 * with the original (critical — playback position, clicks and the grid all
 * assume shifted audio lines up with the source).
 */
import SignalsmithStretch from 'signalsmith-stretch'

/** Extra seconds rendered past the input so the worklet's tail isn't clipped. */
const TAIL_SEC = 0.5

/** Per-source cache: AudioBuffer identity → (semitones → shifted buffer). */
const cache = new WeakMap<AudioBuffer, Map<number, AudioBuffer>>()

/** The worklet's fixed processing latency (samples), probed once per sample rate. */
const latencyCache = new Map<number, Promise<number>>()

/**
 * Return `input` pitch-shifted by `semitones`. A shift of 0 (or non-finite)
 * returns the original buffer unchanged. Results are cached per source buffer +
 * semitone value, so re-selecting a previously used shift is instant.
 */
export async function pitchShiftAudioBuffer(
  input: AudioBuffer,
  semitones: number,
): Promise<AudioBuffer> {
  const st = Math.round(semitones)
  if (!Number.isFinite(st) || st === 0) return input

  const bySt = cache.get(input) ?? new Map<number, AudioBuffer>()
  const cached = bySt.get(st)
  if (cached) return cached

  const out = await renderShift(input, st)
  bySt.set(st, out)
  cache.set(input, bySt)
  return out
}

async function renderShift(input: AudioBuffer, semitones: number): Promise<AudioBuffer> {
  const channels = input.numberOfChannels
  const sampleRate = input.sampleRate
  const tail = Math.ceil(sampleRate * TAIL_SEC)

  const offline = new OfflineAudioContext(channels, input.length + tail, sampleRate)
  const node = await SignalsmithStretch(offline, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [channels],
  })

  // Live-input mode: feed the source through the stretch node and pitch-shift
  // the stream. This is deterministic in an OfflineAudioContext (the source
  // node's start time drives processing), avoiding the buffer-mode port-message
  // timing that produced silence.
  const src = offline.createBufferSource()
  src.buffer = input
  src.connect(node)
  node.connect(offline.destination)

  // One scheduled change setting the shift. Fire WITHOUT awaiting: in an
  // OfflineAudioContext the worklet only runs during `startRendering()`, so a
  // port round-trip would deadlock; the message is queued and drained before
  // the first process() quantum.
  void node.schedule({ output: 0, active: true, semitones })
  src.start(0)

  const [rendered, lead] = await Promise.all([offline.startRendering(), latencySamples(sampleRate)])
  return trimLead(rendered, lead, input.length, offline)
}

/**
 * Trim the worklet's FIXED processing latency off the head so the shifted output
 * lines up sample-for-sample with the source, and clamp to the original length.
 * A fixed offset is correct for any content (silence-detection would wrongly
 * chop a soft intro).
 */
function trimLead(
  rendered: AudioBuffer,
  lead: number,
  targetLen: number,
  ctx: OfflineAudioContext,
): AudioBuffer {
  const channels = rendered.numberOfChannels
  const out = ctx.createBuffer(channels, targetLen, rendered.sampleRate)
  for (let c = 0; c < channels; c++) {
    const src = rendered.getChannelData(c)
    const dst = out.getChannelData(c)
    const avail = Math.max(0, src.length - lead)
    const n = Math.min(targetLen, avail)
    dst.set(src.subarray(lead, lead + n))
    // Any shortfall (tail shorter than targetLen) stays zero-padded.
  }
  return out
}

/** The stretch node's fixed latency in samples, measured once per sample rate. */
function latencySamples(sampleRate: number): Promise<number> {
  let p = latencyCache.get(sampleRate)
  if (!p) {
    p = probeLatency(sampleRate)
    latencyCache.set(sampleRate, p)
  }
  return p
}

/**
 * Render a brief impulse burst through the node (0-semitone passthrough) and
 * find where it re-appears — that delay is the node's constant latency, which we
 * trim off every real render to keep shifted audio aligned with clicks/grid.
 */
async function probeLatency(sampleRate: number): Promise<number> {
  try {
    const n = Math.ceil(sampleRate)
    const offline = new OfflineAudioContext(1, n, sampleRate)
    const node = await SignalsmithStretch(offline, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    const buf = offline.createBuffer(1, n, sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < 400; i++) d[i] = 1 // brief burst at t=0
    const src = offline.createBufferSource()
    src.buffer = buf
    src.connect(node)
    node.connect(offline.destination)
    void node.schedule({ output: 0, active: true, semitones: 0 })
    src.start(0)
    const out = await offline.startRendering()
    const o = out.getChannelData(0)
    const limit = Math.min(o.length, Math.ceil(sampleRate * TAIL_SEC))
    for (let i = 0; i < limit; i++) if (Math.abs(o[i]!) > 0.05) return i
    return 0
  } catch {
    return 0
  }
}
