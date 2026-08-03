<script lang="ts" module>
  import type { SynthPatch } from '$lib/audio/keysSynth'

  type Knob = {
    label: string
    get: (p: SynthPatch) => number
    set: (p: SynthPatch, v: number) => void
    min: number
    max: number
    step: number
    fmt: (v: number) => string
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`
  const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
  const ms = (v: number) => `${Math.round(v * 1000)}ms`

  // Tone + FX knobs, shared by the keys and the bass panels.
  const KNOBS: Knob[] = [
    { label: 'Bright', get: (p) => p.filter.cutoffHz, set: (p, v) => (p.filter.cutoffHz = v), min: 200, max: 8000, step: 50, fmt: (v) => `${hz(v)}Hz` },
    { label: 'Width', get: (p) => p.oscB.detune, set: (p, v) => ((p.oscB.detune = v), (p.oscA.detune = -v)), min: 0, max: 30, step: 1, fmt: (v) => `${Math.round(v)}¢` },
    { label: 'Attack', get: (p) => p.env.attack, set: (p, v) => (p.env.attack = v), min: 0, max: 0.5, step: 0.005, fmt: ms },
    { label: 'Release', get: (p) => p.env.release, set: (p, v) => (p.env.release = v), min: 0.05, max: 1.5, step: 0.01, fmt: ms },
    { label: 'Chorus', get: (p) => p.fx.chorus, set: (p, v) => (p.fx.chorus = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Analog', get: (p) => p.fx.analog ?? 0.14, set: (p, v) => (p.fx.analog = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Move', get: (p) => p.lfo.depth, set: (p, v) => (p.lfo.depth = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Drive', get: (p) => p.fx.drive ?? 0, set: (p, v) => (p.fx.drive = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Phaser', get: (p) => p.fx.phaser ?? 0, set: (p, v) => (p.fx.phaser = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Wah', get: (p) => p.fx.wah ?? 0, set: (p, v) => (p.fx.wah = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Twinkle', get: (p) => p.fx.shimmer ?? 0, set: (p, v) => (p.fx.shimmer = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Delay', get: (p) => p.fx.delayMix, set: (p, v) => (p.fx.delayMix = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Reverb', get: (p) => p.fx.reverbMix, set: (p, v) => (p.fx.reverbMix = v), min: 0, max: 1, step: 0.01, fmt: pct },
    { label: 'Size', get: (p) => p.fx.reverbSize, set: (p, v) => (p.fx.reverbSize = v), min: 0.3, max: 6, step: 0.1, fmt: (v) => `${v.toFixed(1)}s` },
    { label: 'Predelay', get: (p) => p.fx.reverbPredelay ?? 0, set: (p, v) => (p.fx.reverbPredelay = v), min: 0, max: 0.2, step: 0.002, fmt: ms },
    { label: 'Damp', get: (p) => p.fx.reverbDamp ?? 14000, set: (p, v) => (p.fx.reverbDamp = v), min: 800, max: 14000, step: 100, fmt: (v) => `${hz(v)}Hz` },
    { label: 'Hi-pass', get: (p) => p.fx.highpassHz ?? 20, set: (p, v) => (p.fx.highpassHz = v), min: 20, max: 800, step: 5, fmt: (v) => `${hz(v)}Hz` },
  ]
</script>

<script lang="ts">
  // A compact grid of tone/FX sliders bound to a `SynthPatch`. Mutating the patch
  // in place + reassigning propagates to the parent's `$bindable` state, which
  // pushes it to the live synth.
  // `onchanged` is optional: the Chords tab watches the patch with its own
  // effect, but a host that has to re-schedule a mixer lane needs to know the
  // edit came from a knob rather than from any other reactive tick.
  let {
    patch = $bindable(),
    onchanged,
  }: { patch: SynthPatch; onchanged?: () => void } = $props()

  function onKnob(k: (typeof KNOBS)[number], value: number) {
    k.set(patch, value)
    patch = patch // notify the parent bind
    onchanged?.()
  }
</script>

<div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
  {#each KNOBS as k (k.label)}
    <label class="flex flex-col gap-0.5">
      <span class="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
        <span class="text-muted-foreground">{k.label}</span>
        <span class="font-mono tabular-nums">{k.fmt(k.get(patch))}</span>
      </span>
      <input
        type="range"
        min={k.min}
        max={k.max}
        step={k.step}
        value={k.get(patch)}
        oninput={(e) => onKnob(k, +e.currentTarget.value)}
        class="w-full accent-[var(--studio-orange)]"
        aria-label={k.label}
      />
    </label>
  {/each}
</div>
