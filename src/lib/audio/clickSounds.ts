export const CLICK_SOUND_OPTIONS = [
  {
    id: 'studio-beep',
    name: 'Studio beep',
    description: 'Clean two-tone beep with a clear high downbeat.',
  },
  {
    id: 'woodblock',
    name: 'Woodblock',
    description: 'Short woody knock with very little high-frequency fatigue.',
  },
  {
    id: 'rim',
    name: 'Rim click',
    description: 'Dry stick-and-rim snap that cuts through guitars.',
  },
  {
    id: 'clave',
    name: 'Clave',
    description: 'Hard, pitched transient with a compact tail.',
  },
  {
    id: 'cowbell',
    name: 'Cowbell',
    description: 'Metallic midrange attack that survives dense mixes.',
  },
  {
    id: 'digital-tick',
    name: 'Digital tick',
    description: 'Very short electronic pulse with minimal spill.',
  },
  {
    id: 'noise-snap',
    name: 'Noise snap',
    description: 'Bright unpitched snap for loud stage monitoring.',
  },
  {
    id: 'hybrid',
    name: 'Hybrid',
    description: 'A low knock and bright tick layered together.',
  },
] as const

export type ClickSoundId = (typeof CLICK_SOUND_OPTIONS)[number]['id']

/** The click voice heard everywhere outside the sound-comparison lab. */
export const PROJECT_CLICK_SOUND: ClickSoundId = 'hybrid'

export type ClickSoundResources = {
  noise: AudioBuffer
}

type ScheduleClickInput = {
  ctx: BaseAudioContext
  destination: AudioNode
  resources: ClickSoundResources
  sound: ClickSoundId
  startTime: number
  downbeat: boolean
}

/** Build once per audio context and reuse for every noise-based click. */
export function createClickSoundResources(ctx: BaseAudioContext): ClickSoundResources {
  const frameCount = Math.max(1, Math.round(ctx.sampleRate * 0.12))
  const noise = ctx.createBuffer(1, frameCount, ctx.sampleRate)
  const samples = noise.getChannelData(0)
  let previous = 0
  let seed = 0x2f6e2b1
  for (let i = 0; i < samples.length; i += 1) {
    // A slightly correlated signal is less brittle than pure white noise.
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const white = (seed / 0xffffffff) * 2 - 1
    previous = previous * 0.18 + white * 0.82
    samples[i] = previous
  }
  return { noise }
}

function connectTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  startTime: number,
  opts: {
    type: OscillatorType
    frequency: number
    endFrequency?: number
    peak: number
    attack: number
    duration: number
  },
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = opts.type
  osc.frequency.setValueAtTime(opts.frequency, startTime)
  if (opts.endFrequency && opts.endFrequency !== opts.frequency) {
    osc.frequency.exponentialRampToValueAtTime(opts.endFrequency, startTime + opts.duration)
  }
  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.exponentialRampToValueAtTime(opts.peak, startTime + opts.attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + opts.duration)
  osc.connect(gain)
  gain.connect(destination)
  osc.start(startTime)
  osc.stop(startTime + opts.duration + 0.015)
}

function connectNoise(
  ctx: BaseAudioContext,
  destination: AudioNode,
  resources: ClickSoundResources,
  startTime: number,
  opts: {
    filter: BiquadFilterType
    frequency: number
    q?: number
    peak: number
    attack: number
    duration: number
  },
): void {
  const source = ctx.createBufferSource()
  const filter = ctx.createBiquadFilter()
  const gain = ctx.createGain()
  source.buffer = resources.noise
  filter.type = opts.filter
  filter.frequency.setValueAtTime(opts.frequency, startTime)
  filter.Q.setValueAtTime(opts.q ?? 0.7, startTime)
  gain.gain.setValueAtTime(0.0001, startTime)
  gain.gain.exponentialRampToValueAtTime(opts.peak, startTime + opts.attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + opts.duration)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(destination)
  source.start(startTime)
  source.stop(startTime + opts.duration + 0.015)
}

/** Schedule one candidate sound. Downbeats are distinct without being much louder. */
export function scheduleClickSound(input: ScheduleClickInput): void {
  const { ctx, destination, resources, sound, startTime, downbeat } = input
  const accentPitch = downbeat ? 1.22 : 1
  const accentGain = downbeat ? 1 : 0.72

  switch (sound) {
    case 'studio-beep':
      connectTone(ctx, destination, startTime, {
        type: 'sine',
        frequency: 760 * accentPitch,
        endFrequency: 690 * accentPitch,
        peak: 0.55 * accentGain,
        attack: 0.002,
        duration: downbeat ? 0.065 : 0.047,
      })
      connectTone(ctx, destination, startTime, {
        type: 'triangle',
        frequency: 1520 * accentPitch,
        peak: 0.16 * accentGain,
        attack: 0.001,
        duration: 0.025,
      })
      break

    case 'woodblock':
      connectTone(ctx, destination, startTime, {
        type: 'triangle',
        frequency: 980 * accentPitch,
        endFrequency: 650 * accentPitch,
        peak: 0.7 * accentGain,
        attack: 0.001,
        duration: 0.045,
      })
      connectTone(ctx, destination, startTime, {
        type: 'sine',
        frequency: 490 * accentPitch,
        endFrequency: 420 * accentPitch,
        peak: 0.24 * accentGain,
        attack: 0.001,
        duration: 0.055,
      })
      break

    case 'rim':
      connectNoise(ctx, destination, resources, startTime, {
        filter: 'bandpass',
        frequency: downbeat ? 4300 : 3600,
        q: 1.7,
        peak: 0.86 * accentGain,
        attack: 0.0008,
        duration: 0.026,
      })
      connectTone(ctx, destination, startTime, {
        type: 'triangle',
        frequency: 1780 * accentPitch,
        endFrequency: 1280 * accentPitch,
        peak: 0.32 * accentGain,
        attack: 0.0008,
        duration: 0.03,
      })
      break

    case 'clave':
      connectTone(ctx, destination, startTime, {
        type: 'sine',
        frequency: 2050 * accentPitch,
        endFrequency: 1680 * accentPitch,
        peak: 0.68 * accentGain,
        attack: 0.0008,
        duration: 0.038,
      })
      connectTone(ctx, destination, startTime, {
        type: 'triangle',
        frequency: 2920 * accentPitch,
        peak: 0.2 * accentGain,
        attack: 0.0005,
        duration: 0.021,
      })
      break

    case 'cowbell':
      connectTone(ctx, destination, startTime, {
        type: 'square',
        frequency: 560 * accentPitch,
        peak: 0.26 * accentGain,
        attack: 0.001,
        duration: downbeat ? 0.095 : 0.07,
      })
      connectTone(ctx, destination, startTime, {
        type: 'square',
        frequency: 845 * accentPitch,
        peak: 0.19 * accentGain,
        attack: 0.001,
        duration: downbeat ? 0.08 : 0.058,
      })
      break

    case 'digital-tick':
      connectTone(ctx, destination, startTime, {
        type: 'square',
        frequency: 1320 * accentPitch,
        endFrequency: 980 * accentPitch,
        peak: 0.34 * accentGain,
        attack: 0.0005,
        duration: 0.018,
      })
      break

    case 'noise-snap':
      connectNoise(ctx, destination, resources, startTime, {
        filter: 'highpass',
        frequency: downbeat ? 3300 : 2700,
        peak: 0.78 * accentGain,
        attack: 0.0005,
        duration: downbeat ? 0.045 : 0.032,
      })
      break

    case 'hybrid':
      connectTone(ctx, destination, startTime, {
        type: 'triangle',
        frequency: 620 * accentPitch,
        endFrequency: 390 * accentPitch,
        peak: 0.54 * accentGain,
        attack: 0.001,
        duration: 0.052,
      })
      connectNoise(ctx, destination, resources, startTime, {
        filter: 'bandpass',
        frequency: downbeat ? 5200 : 4300,
        q: 1.2,
        peak: 0.55 * accentGain,
        attack: 0.0005,
        duration: 0.022,
      })
      break
  }
}
