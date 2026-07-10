/**
 * Ambient types for `signalsmith-stretch` (MIT, JS/WASM) — the package ships no
 * `.d.ts`. Only the surface we use is declared. See its README for the full API.
 */
declare module 'signalsmith-stretch' {
  export interface StretchScheduleOptions {
    output?: number
    active?: boolean
    input?: number
    rate?: number
    semitones?: number
    tonalityHz?: number
    formantSemitones?: number
    formantCompensation?: boolean
    formantBaseHz?: number
    loopStart?: number
    loopEnd?: number
  }

  export interface StretchNode extends AudioWorkletNode {
    inputTime: number
    /** Append input sample buffers (one Float32Array per channel). */
    addBuffers(channels: Float32Array[]): Promise<number>
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number } | void>
    schedule(opts: StretchScheduleOptions): Promise<void>
    start(when?: number): Promise<void>
    stop(when?: number): Promise<void>
    configure(opts: Record<string, unknown>): Promise<void>
    latency(): Promise<number>
    setUpdateInterval(seconds: number, callback?: (t: number) => void): Promise<void>
  }

  const SignalsmithStretch: (
    audioContext: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ) => Promise<StretchNode>
  export default SignalsmithStretch
}
