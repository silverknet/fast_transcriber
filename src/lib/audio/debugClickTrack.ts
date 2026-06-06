/**
 * One-shot metronome click for the PlaybackController and any future
 * Web-Audio-scheduled cue paths. Accent = downbeat (bar 1), softer =
 * other beats.
 */
export function playMetronomeClick(
  ctx: AudioContext,
  destination: AudioNode,
  startTime: number,
  downbeat: boolean,
): void {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = 'sine'
  const freq = downbeat ? 1040 : 720
  const dur = downbeat ? 0.055 : 0.042
  const peak = downbeat ? 0.62 : 0.34

  osc.frequency.setValueAtTime(freq, startTime)
  g.gain.setValueAtTime(0, startTime)
  g.gain.linearRampToValueAtTime(peak, startTime + 0.0025)
  g.gain.exponentialRampToValueAtTime(0.0008, startTime + dur)

  osc.connect(g)
  g.connect(destination)
  osc.start(startTime)
  osc.stop(startTime + dur + 0.012)
}
