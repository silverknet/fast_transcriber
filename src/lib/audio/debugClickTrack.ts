import {
  createClickSoundResources,
  PROJECT_CLICK_SOUND,
  scheduleClickSound,
  type ClickSoundResources,
} from './clickSounds'

/** Previous BarBro sine beep, retained as an explicit fallback/reference. */
export function playLegacyMetronomeClick(
  ctx: BaseAudioContext,
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

const resourcesByContext = new WeakMap<BaseAudioContext, ClickSoundResources>()

function hybridResources(ctx: BaseAudioContext): ClickSoundResources | null {
  // Small unit-test contexts intentionally implement only the legacy graph.
  // Real browser contexts always provide these methods.
  if (
    typeof ctx.createBuffer !== 'function' ||
    typeof ctx.createBufferSource !== 'function' ||
    !Number.isFinite(ctx.sampleRate)
  ) {
    return null
  }
  let resources = resourcesByContext.get(ctx)
  if (!resources) {
    resources = createClickSoundResources(ctx)
    resourcesByContext.set(ctx, resources)
  }
  return resources
}

/** Project-wide realtime metronome voice. Accent = downbeat. */
export function playMetronomeClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  startTime: number,
  downbeat: boolean,
): void {
  const resources = hybridResources(ctx)
  if (!resources) {
    playLegacyMetronomeClick(ctx, destination, startTime, downbeat)
    return
  }
  scheduleClickSound({
    ctx,
    destination,
    resources,
    sound: PROJECT_CLICK_SOUND,
    startTime,
    downbeat,
  })
}
