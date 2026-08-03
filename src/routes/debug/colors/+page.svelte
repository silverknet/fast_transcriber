<script lang="ts">
  /**
   * Colour lab — compare section palettes on a sample song waveform AND on the
   * real APC pads (laid out exactly like live mode). Edit the custom palette,
   * then copy its JSON and send it to me to bake in.
   */
  import { onMount } from 'svelte'
  import WaveformCanvas from '$lib/components/WaveformCanvas.svelte'
  import { APC_PALETTE } from '$lib/hardware/apcPalette'
  import { SECTION_KIND_COLOR } from '$lib/songmap/sectionColors'
  import { LIVE_SLOT_PAD_COUNT, sectionToPad, STEM_ON_VELOCITY } from '$lib/hardware/liveMidiMap'
  import { midiStatus, ensureMidi, sendPadRaw, sendPadDim, clearAllLeds } from '$lib/hardware/midiService'

  type Palette = Record<string, string>

  // A representative song so every palette is judged on the same structure.
  const EXAMPLE = [
    { kind: 'intro', label: 'Intro', startFrac: 0.0, endFrac: 0.07, amp: 0.28 },
    { kind: 'verse', label: 'Verse', startFrac: 0.07, endFrac: 0.22, amp: 0.55 },
    { kind: 'preChorus', label: 'Pre', startFrac: 0.22, endFrac: 0.28, amp: 0.66 },
    { kind: 'chorus', label: 'Chorus', startFrac: 0.28, endFrac: 0.43, amp: 0.92 },
    { kind: 'verse', label: 'Verse', startFrac: 0.43, endFrac: 0.55, amp: 0.55 },
    { kind: 'chorus', label: 'Chorus', startFrac: 0.55, endFrac: 0.7, amp: 0.92 },
    { kind: 'bridge', label: 'Bridge', startFrac: 0.7, endFrac: 0.8, amp: 0.48 },
    { kind: 'chorus', label: 'Chorus', startFrac: 0.8, endFrac: 0.93, amp: 0.95 },
    { kind: 'outro', label: 'Outro', startFrac: 0.93, endFrac: 1.0, amp: 0.34 },
  ]

  const PRESETS: { name: string; colors: Palette }[] = [
    { name: 'Studio (current)', colors: { ...SECTION_KIND_COLOR } },
    {
      // Saturated, maximum hue separation.
      name: 'Bold',
      colors: {
        intro: '#7c3aed', verse: '#2563eb', preChorus: '#0d9488', chorus: '#ea580c', bridge: '#dc2626',
        solo: '#db2777', riff: '#65a30d', break: '#475569', outro: '#c026d3', custom: '#52525b',
      },
    },
    {
      // Light + soft.
      name: 'Pastel',
      colors: {
        intro: '#c4b5fd', verse: '#93c5fd', preChorus: '#99f6e4', chorus: '#fed7aa', bridge: '#fca5a5',
        solo: '#f9a8d4', riff: '#d9f99d', break: '#cbd5e1', outro: '#f5d0fe', custom: '#d4d4d8',
      },
    },
    {
      // Dark + rich.
      name: 'Deep',
      colors: {
        intro: '#4c1d95', verse: '#1e3a8a', preChorus: '#134e4a', chorus: '#7c2d12', bridge: '#7f1d1d',
        solo: '#831843', riff: '#365314', break: '#1e293b', outro: '#701a75', custom: '#27272a',
      },
    },
  ]

  let custom = $state<Palette>({ ...SECTION_KIND_COLOR })
  let buffer = $state<AudioBuffer | null>(null)

  function rgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  /** Closest APC palette velocity to a screen colour (skips near-black entries). */
  function nearestVelocity(hex: string): number {
    const [r, g, b] = rgb(hex)
    let best = 21
    let bestD = Infinity
    for (let v = 1; v < 128; v++) {
      const [pr, pg, pb] = rgb(APC_PALETTE[v]!)
      if (pr + pg + pb < 40) continue // skip blacks so nothing maps to "off"
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
      if (d < bestD) {
        bestD = d
        best = v
      }
    }
    return best
  }

  function bandsFor(colors: Palette) {
    return EXAMPLE.map((s, i) => ({
      startFrac: s.startFrac,
      endFrac: s.endFrac,
      label: s.label,
      index: i,
      color: colors[s.kind] ?? '#71717a',
    }))
  }

  function sendToAkai(colors: Palette) {
    clearAllLeds()
    // Stems row, like live mode: turquoise — some on (bright), some muted (dim).
    for (let i = 0; i < LIVE_SLOT_PAD_COUNT; i++) {
      if (i % 3 === 0) sendPadDim(i, STEM_ON_VELOCITY)
      else sendPadRaw(i, STEM_ON_VELOCITY, 'solid')
    }
    EXAMPLE.forEach((s, i) => {
      const pad = sectionToPad(i)
      if (pad != null) sendPadRaw(pad, nearestVelocity(colors[s.kind] ?? '#71717a'))
    })
  }

  const customJson = $derived(
    JSON.stringify(
      {
        SECTION_KIND_COLOR: custom,
        SECTION_KIND_VELOCITY: Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, nearestVelocity(v)])),
      },
      null,
      2,
    ),
  )

  onMount(() => {
    if ('requestMIDIAccess' in navigator) void ensureMidi()
    // Build a synthetic song waveform whose loudness follows the structure.
    try {
      const ctx = new AudioContext()
      const sr = ctx.sampleRate
      const n = sr * 24
      const buf = ctx.createBuffer(1, n, sr)
      const data = buf.getChannelData(0)
      for (const s of EXAMPLE) {
        const from = Math.floor(s.startFrac * n)
        const to = Math.floor(s.endFrac * n)
        for (let i = from; i < to; i++) data[i] = (Math.random() * 2 - 1) * s.amp * (0.5 + 0.5 * Math.random())
      }
      buffer = buf
      void ctx.close()
    } catch {
      /* no audio context — the bands still render, just without a wave */
    }
  })
</script>

<div class="mx-auto flex max-w-4xl flex-col gap-6 p-4">
  <div class="flex items-center gap-3">
    <h1 class="text-xl font-black">Colour lab</h1>
    <span class="size-2.5 rounded-full {$midiStatus.apc ? 'bg-green-500' : 'bg-muted-foreground/40'}"></span>
    <span class="text-sm font-bold">{$midiStatus.apc ? 'APC connected' : 'Controller not connected'}</span>
    {#if !$midiStatus.connected}
      <button class="border-2 border-black px-2 py-0.5 text-xs font-bold" onclick={() => void ensureMidi()}>Connect</button>
    {/if}
    <button class="ml-auto border-2 border-black px-2 py-0.5 text-xs font-bold" onclick={() => clearAllLeds()}>Clear pads</button>
  </div>

  <!-- Preset palettes: each on the sample waveform + a send-to-Akai button -->
  {#each PRESETS as preset (preset.name)}
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-black uppercase tracking-wide">{preset.name}</h2>
        <div class="flex gap-2">
          <button class="border-2 border-black px-2 py-0.5 text-xs font-bold" onclick={() => sendToAkai(preset.colors)}>
            ▶ Show on Akai
          </button>
          <button class="border-2 border-black/40 px-2 py-0.5 text-xs font-bold" onclick={() => (custom = { ...preset.colors })}>
            Use as custom
          </button>
        </div>
      </div>
      <WaveformCanvas
        class="ring-foreground/10 w-full bg-muted/35 ring-1"
        {buffer}
        color="#94a3b8"
        height={72}
        positionSec={12}
        durationSec={24}
        sectionBands={bandsFor(preset.colors)}
        showSectionLabels={true}
        onSeekFraction={() => {}}
      />
    </section>
  {/each}

  <!-- Custom palette: editable, live waveform + send-to-Akai -->
  <section class="flex flex-col gap-2 border-t-2 border-black/10 pt-4">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-black uppercase tracking-wide">Custom (edit me)</h2>
      <button class="border-2 border-black px-2 py-0.5 text-xs font-bold" onclick={() => sendToAkai(custom)}>▶ Show on Akai</button>
    </div>
    <WaveformCanvas
      class="ring-foreground/10 w-full bg-muted/35 ring-1"
      {buffer}
      color="#94a3b8"
      height={80}
      positionSec={12}
      durationSec={24}
      sectionBands={bandsFor(custom)}
      showSectionLabels={true}
      onSeekFraction={() => {}}
    />
    <div class="mt-1 grid grid-cols-[7rem_2.5rem_1fr_3rem] items-center gap-2 text-sm">
      {#each Object.keys(custom) as kind (kind)}
        <div class="font-bold">{kind}</div>
        <input type="color" bind:value={custom[kind]} class="h-7 w-full cursor-pointer" />
        <div class="h-6 rounded" style="background: {custom[kind]}"></div>
        <div
          class="flex h-6 items-center justify-center rounded text-[10px] font-black"
          style="background: {APC_PALETTE[nearestVelocity(custom[kind])]}; color: {rgb(APC_PALETTE[nearestVelocity(custom[kind])]!).reduce((a, b) => a + b, 0) > 380 ? '#000' : '#fff'}"
          title="nearest APC pad colour"
        >
          v{nearestVelocity(custom[kind])}
        </div>
      {/each}
    </div>
  </section>

  <!-- Export -->
  <section class="flex flex-col gap-2">
    <h2 class="text-sm font-black uppercase tracking-wide">Custom values — copy + send to me</h2>
    <textarea class="border-2 border-black p-2 font-mono text-xs" rows="14" readonly>{customJson}</textarea>
  </section>
</div>
