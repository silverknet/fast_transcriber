/**
 * Short metronome-style clicks for debug playback (downbeat vs other beats).
 * Call from an rAF loop synced to HTMLMediaElement.currentTime.
 */

export type BeatClickPoint = {
  timeSec: number
  downbeat: boolean
}

export function beatsToClickPoints(
  beats: { timeSec: number; indexInBar: number }[],
): BeatClickPoint[] {
  return [...beats]
    .map((b) => ({
      timeSec: b.timeSec,
      downbeat: b.indexInBar === 0,
    }))
    .sort((a, b) => a.timeSec - b.timeSec)
}

/**
 * One shot: accent = downbeat (bar 1), softer = other beats.
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
  const dur = downbeat ? 0.052 : 0.038
  const peak = downbeat ? 0.42 : 0.2

  osc.frequency.setValueAtTime(freq, startTime)
  g.gain.setValueAtTime(0, startTime)
  g.gain.linearRampToValueAtTime(peak, startTime + 0.0025)
  g.gain.exponentialRampToValueAtTime(0.0008, startTime + dur)

  osc.connect(g)
  g.connect(destination)
  osc.start(startTime)
  osc.stop(startTime + dur + 0.012)
}
