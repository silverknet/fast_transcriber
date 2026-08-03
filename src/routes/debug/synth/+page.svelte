<script lang="ts">
  /**
   * Design your own synth (oscillators, filter, envelope, movement, FX), load
   * built-in presets, and save your own. Play it with the APC Key 25 keybed or
   * the on-screen keyboard. Low-latency dedicated AudioContext — see `keysSynth.ts`.
   */
  import { onDestroy } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import {
    KeysSynth,
    BUILTIN_PRESETS,
    DEFAULT_PATCH,
    structuredClonePatch,
    type SynthPatch,
    type OscType,
  } from '$lib/audio/keysSynth'
  import { loadUserPresets, saveUserPreset, deleteUserPreset } from '$lib/audio/synthPresets'
  import KeysSynthController from '$lib/components/KeysSynthController.svelte'
  import { ensureMidi, onMidiInput } from '$lib/hardware/midiService'
  import { isApcKey25KeysPortName } from '$lib/hardware/apcKey25'
  import { Button } from '$lib/components/ui/button'

  const synth = new KeysSynth()
  let enabled = $state(false)
  let starting = $state(false)
  let error = $state('')
  let volume = $state(0.8)
  let latencyMs = $state(0)
  let bufMs = $state(0)
  let latencyTimer: ReturnType<typeof setInterval> | null = null
  const pressed = new SvelteSet<number>()

  // ── latency breakdown: how long a MIDI note takes device → our handler ──
  let midiLast = $state(0)
  let midiAvg = $state(0)
  let midiMax = $state(0)
  let midiCount = $state(0)
  let midiTsOk = $state(true) // false if the browser gives a useless timeStamp
  let midiSamples: number[] = []
  let midiUnsub: (() => void) | null = null

  function measureMidi(ev: MIDIMessageEvent) {
    const data = ev.data
    if (!data || data.length < 3) return
    const name = (ev.target as { name?: string | null } | null)?.name ?? null
    if (!isApcKey25KeysPortName(name)) return
    if ((data[0]! & 0xf0) !== 0x90 || (data[2]! & 0x7f) === 0) return // note-on only
    const delta = performance.now() - ev.timeStamp
    if (!Number.isFinite(delta) || delta < -1 || delta > 1000) {
      midiTsOk = false // timeStamp not in the performance-clock epoch on this browser
      return
    }
    midiTsOk = true
    midiLast = delta
    midiSamples.push(delta)
    if (midiSamples.length > 40) midiSamples.shift()
    midiAvg = midiSamples.reduce((a, b) => a + b, 0) / midiSamples.length
    midiMax = Math.max(...midiSamples)
    midiCount = midiSamples.length
  }

  let patch = $state<SynthPatch>(structuredClonePatch(BUILTIN_PRESETS[0]!))
  let userPresets = $state<SynthPatch[]>(loadUserPresets())
  let selected = $state<string>(BUILTIN_PRESETS[0]!.name)

  const OSC_TYPES: OscType[] = ['sine', 'triangle', 'sawtooth', 'square']

  // Sync reactive UI state into the (non-reactive) audio engine.
  $effect(() => synth.setPatch(patch))
  $effect(() => synth.setVolume(volume))

  function loadPreset(name: string) {
    const p = [...BUILTIN_PRESETS, ...userPresets].find((x) => x.name === name)
    if (p) {
      patch = structuredClonePatch(p)
      selected = name
    }
  }
  function savePatch() {
    const name = (typeof prompt === 'function' ? prompt('Save synth as:', patch.name) : patch.name)?.trim()
    if (!name) return
    patch = { ...structuredClonePatch(patch), name }
    userPresets = saveUserPreset(patch)
    selected = name
  }
  const isUserPreset = $derived(userPresets.some((p) => p.name === patch.name))
  function removePatch() {
    if (!isUserPreset) return
    userPresets = deleteUserPreset(patch.name)
  }

  async function enable() {
    if (enabled || starting) return
    starting = true
    error = ''
    try {
      await synth.resume()
      await ensureMidi().catch(() => {})
      enabled = true
      midiUnsub = onMidiInput(measureMidi)
      latencyTimer = setInterval(() => {
        latencyMs = synth.outputLatencyMs
        bufMs = synth.baseLatencyMs
      }, 250)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not start audio.'
    } finally {
      starting = false
    }
  }

  // ── on-screen keyboard (notes 48..72 = the APC keybed span) ──
  const LO = 48
  const HI = 72
  const isBlack = (n: number) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12)
  const notes = Array.from({ length: HI - LO + 1 }, (_, i) => LO + i)
  const whiteNotes = notes.filter((n) => !isBlack(n))
  const blackKeys = notes
    .filter((n) => isBlack(n))
    .map((n) => ({ note: n, whitesBefore: whiteNotes.filter((w) => w < n).length }))
  const noteName = (n: number) => ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((n % 12) + 12) % 12]

  function press(note: number, ev: PointerEvent) {
    if (!enabled) return
    ;(ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId)
    synth.noteOn(note, 100)
    pressed.add(note)
  }
  function release(note: number) {
    if (!pressed.has(note)) return
    synth.noteOff(note)
    pressed.delete(note)
  }

  onDestroy(() => {
    if (latencyTimer) clearInterval(latencyTimer)
    midiUnsub?.()
    void synth.close()
  })
</script>

<svelte:head><title>Synth designer — BarBro debug</title></svelte:head>

<KeysSynthController {enabled} {synth} />

<main class="bg-background text-foreground min-h-dvh px-6 py-8">
  <div class="mx-auto max-w-4xl">
    <header class="mb-5">
      <p class="text-muted-foreground text-xs font-black uppercase tracking-wider">Debug · instrument</p>
      <h1 class="text-3xl font-black">Synth designer</h1>
      <p class="text-muted-foreground mt-1 max-w-prose text-sm">
        Build your own sound with the controls, load a built-in preset, or save your own. Play it with the
        APC Key 25 keyboard or the keys below.
      </p>
    </header>

    <!-- Transport + presets -->
    <div class="border-foreground/15 bg-card flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <Button class="min-w-24" onclick={enable} disabled={enabled || starting}>
        {enabled ? '● Live' : starting ? 'Starting…' : 'Enable'}
      </Button>

      <label class="flex items-center gap-2 text-sm font-semibold">
        Preset
        <select
          value={selected}
          onchange={(e) => loadPreset((e.currentTarget as HTMLSelectElement).value)}
          class="border-foreground/20 bg-background max-w-52 rounded-md border px-2 py-1 text-sm"
        >
          <optgroup label="Built-in">
            {#each BUILTIN_PRESETS as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
          </optgroup>
          {#if userPresets.length}
            <optgroup label="Your presets">
              {#each userPresets as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
            </optgroup>
          {/if}
        </select>
      </label>

      <Button class="" variant="outline" size="sm" onclick={savePatch}>Save…</Button>
      {#if isUserPreset}
        <Button class="" variant="ghost" size="sm" onclick={removePatch}>Delete</Button>
      {/if}

      <label class="ml-auto flex items-center gap-2 text-sm font-semibold">
        Volume
        <input type="range" min="0" max="1" step="0.01" bind:value={volume} class="w-28 accent-[var(--studio-orange)]" />
      </label>
      <span class="text-muted-foreground font-mono text-xs">
        {enabled ? `~${latencyMs.toFixed(1)} ms · buf ${bufMs.toFixed(1)}` : '—'}
      </span>
    </div>

    {#if error}<p class="text-destructive mt-3 text-sm">{error}</p>{/if}

    <!-- Latency breakdown -->
    {#if enabled}
      <div class="border-foreground/15 mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border p-3 font-mono text-xs sm:grid-cols-4">
        <div><span class="text-muted-foreground">audio out</span> <b>{latencyMs.toFixed(1)} ms</b> <span class="text-muted-foreground">(buf {bufMs.toFixed(1)})</span></div>
        <div>
          <span class="text-muted-foreground">MIDI device→code</span>
          {#if midiCount === 0}<b class="text-muted-foreground">play a key…</b>
          {:else if !midiTsOk}<b class="text-muted-foreground">n/a</b>
          {:else}<b>{midiAvg.toFixed(1)} ms</b> <span class="text-muted-foreground">avg</span>{/if}
        </div>
        <div>
          <span class="text-muted-foreground">MIDI last / max</span>
          {#if midiCount > 0 && midiTsOk}<b>{midiLast.toFixed(1)} / {midiMax.toFixed(1)} ms</b>{:else}<b class="text-muted-foreground">—</b>{/if}
        </div>
        <div>
          <span class="text-muted-foreground">≈ total software→sound</span>
          <b class="text-[var(--studio-orange)]">{(latencyMs + (midiTsOk ? midiAvg : 0)).toFixed(1)} ms</b>
        </div>
      </div>
      <p class="text-muted-foreground mt-2 text-xs">
        Play the <b>APC keys</b> to fill the MIDI numbers, then compare with the <b>on-screen keys</b> (no MIDI).
        If on-screen feels snappier, the gap is Web-MIDI delivery. On Bluetooth output, <code>audio out</code>
        will be huge — wired only.
      </p>
    {/if}

    <!-- Keyboard -->
    <div class="mt-5 select-none">
      <div class="relative flex touch-none" role="group" aria-label="Keyboard">
        {#each whiteNotes as n (n)}
          <button
            type="button"
            class="border-foreground/25 relative h-40 flex-1 rounded-b-md border bg-white {pressed.has(n)
              ? '!bg-[var(--studio-orange)]'
              : ''}"
            onpointerdown={(e) => press(n, e)}
            onpointerup={() => release(n)}
            onpointerleave={() => release(n)}
            onpointercancel={() => release(n)}
            aria-label={`${noteName(n)}${Math.floor(n / 12) - 1}`}
          >
            <span class="text-foreground/40 pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] font-bold">
              {noteName(n) === 'C' ? `C${Math.floor(n / 12) - 1}` : ''}
            </span>
          </button>
        {/each}
        {#each blackKeys as bk (bk.note)}
          <button
            type="button"
            class="absolute top-0 z-10 h-24 rounded-b-md border border-black bg-neutral-900 {pressed.has(bk.note)
              ? '!bg-[var(--studio-orange)]'
              : ''}"
            style="width: calc(100% / {whiteNotes.length} * 0.62); left: calc(100% / {whiteNotes.length} * {bk.whitesBefore} - (100% / {whiteNotes.length} * 0.31));"
            onpointerdown={(e) => press(bk.note, e)}
            onpointerup={() => release(bk.note)}
            onpointerleave={() => release(bk.note)}
            onpointercancel={() => release(bk.note)}
            aria-label={`${noteName(bk.note)}${Math.floor(bk.note / 12) - 1}`}
          ></button>
        {/each}
      </div>
    </div>

    <!-- Patch editor -->
    <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <fieldset class="border-foreground/15 rounded-lg border p-3">
        <legend class="text-muted-foreground px-1 text-[11px] font-black uppercase tracking-wider">Osc A</legend>
        <select bind:value={patch.oscA.type} class="border-foreground/20 bg-background mt-1 w-full rounded-md border px-2 py-1 text-xs">
          {#each OSC_TYPES as t (t)}<option value={t}>{t}</option>{/each}
        </select>
        <label class="mt-1 block text-xs font-semibold">Level <b class="font-mono">{Math.round(patch.oscA.level * 100)}%</b>
          <input type="range" min="0" max="1" step="0.02" bind:value={patch.oscA.level} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Detune <b class="font-mono">{patch.oscA.detune} ¢</b>
          <input type="range" min="-1200" max="1200" step="1" bind:value={patch.oscA.detune} class="w-full accent-[var(--studio-orange)]" /></label>
      </fieldset>

      <fieldset class="border-foreground/15 rounded-lg border p-3">
        <legend class="text-muted-foreground px-1 text-[11px] font-black uppercase tracking-wider">Osc B</legend>
        <select bind:value={patch.oscB.type} class="border-foreground/20 bg-background mt-1 w-full rounded-md border px-2 py-1 text-xs">
          {#each OSC_TYPES as t (t)}<option value={t}>{t}</option>{/each}
        </select>
        <label class="mt-1 block text-xs font-semibold">Level <b class="font-mono">{Math.round(patch.oscB.level * 100)}%</b>
          <input type="range" min="0" max="1" step="0.02" bind:value={patch.oscB.level} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Detune <b class="font-mono">{patch.oscB.detune} ¢</b>
          <input type="range" min="-1200" max="1200" step="1" bind:value={patch.oscB.detune} class="w-full accent-[var(--studio-orange)]" /></label>
      </fieldset>

      <fieldset class="border-foreground/15 rounded-lg border p-3">
        <legend class="text-muted-foreground px-1 text-[11px] font-black uppercase tracking-wider">Filter</legend>
        <label class="mt-1 block text-xs font-semibold">Cutoff <b class="font-mono">{Math.round(patch.filter.cutoffHz)} Hz</b>
          <input type="range" min="120" max="14000" step="20" bind:value={patch.filter.cutoffHz} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Resonance <b class="font-mono">{patch.filter.resonance.toFixed(1)}</b>
          <input type="range" min="0.1" max="16" step="0.1" bind:value={patch.filter.resonance} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Vel→cutoff <b class="font-mono">{Math.round(patch.filter.velToCutoff * 100)}%</b>
          <input type="range" min="0" max="1" step="0.02" bind:value={patch.filter.velToCutoff} class="w-full accent-[var(--studio-orange)]" /></label>
      </fieldset>

      <fieldset class="border-foreground/15 rounded-lg border p-3">
        <legend class="text-muted-foreground px-1 text-[11px] font-black uppercase tracking-wider">Amp envelope</legend>
        <label class="mt-1 block text-xs font-semibold">Attack <b class="font-mono">{Math.round(patch.env.attack * 1000)} ms</b>
          <input type="range" min="0" max="2" step="0.005" bind:value={patch.env.attack} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Decay <b class="font-mono">{Math.round(patch.env.decay * 1000)} ms</b>
          <input type="range" min="0" max="3" step="0.01" bind:value={patch.env.decay} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Sustain <b class="font-mono">{Math.round(patch.env.sustain * 100)}%</b>
          <input type="range" min="0" max="1" step="0.02" bind:value={patch.env.sustain} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Release <b class="font-mono">{Math.round(patch.env.release * 1000)} ms</b>
          <input type="range" min="0.02" max="4" step="0.02" bind:value={patch.env.release} class="w-full accent-[var(--studio-orange)]" /></label>
      </fieldset>

      <fieldset class="border-foreground/15 rounded-lg border p-3">
        <legend class="text-muted-foreground px-1 text-[11px] font-black uppercase tracking-wider">Movement + gain</legend>
        <label class="mt-1 block text-xs font-semibold">LFO rate <b class="font-mono">{patch.lfo.rateHz.toFixed(2)} Hz</b>
          <input type="range" min="0.05" max="6" step="0.05" bind:value={patch.lfo.rateHz} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">LFO depth <b class="font-mono">{Math.round(patch.lfo.depth * 100)}%</b>
          <input type="range" min="0" max="1" step="0.02" bind:value={patch.lfo.depth} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Patch gain <b class="font-mono">{Math.round(patch.gain * 100)}%</b>
          <input type="range" min="0" max="1" step="0.02" bind:value={patch.gain} class="w-full accent-[var(--studio-orange)]" /></label>
      </fieldset>

      <fieldset class="border-foreground/15 rounded-lg border p-3">
        <legend class="text-muted-foreground px-1 text-[11px] font-black uppercase tracking-wider">FX — chorus + reverb</legend>
        <label class="mt-1 block text-xs font-semibold">Chorus <b class="font-mono">{Math.round(patch.fx.chorus * 100)}%</b>
          <input type="range" min="0" max="1" step="0.02" bind:value={patch.fx.chorus} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Reverb mix <b class="font-mono">{Math.round(patch.fx.reverbMix * 100)}%</b>
          <input type="range" min="0" max="1" step="0.02" bind:value={patch.fx.reverbMix} class="w-full accent-[var(--studio-orange)]" /></label>
        <label class="mt-1 block text-xs font-semibold">Reverb size <b class="font-mono">{patch.fx.reverbSize.toFixed(1)} s</b>
          <input type="range" min="0.3" max="6" step="0.1" bind:value={patch.fx.reverbSize} class="w-full accent-[var(--studio-orange)]" /></label>
      </fieldset>

      <fieldset class="border-foreground/15 col-span-2 rounded-lg border p-3 sm:col-span-3">
        <legend class="text-muted-foreground px-1 text-[11px] font-black uppercase tracking-wider">FX — delay</legend>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label class="block text-xs font-semibold">Mix <b class="font-mono">{Math.round(patch.fx.delayMix * 100)}%</b>
            <input type="range" min="0" max="1" step="0.02" bind:value={patch.fx.delayMix} class="w-full accent-[var(--studio-orange)]" /></label>
          <label class="block text-xs font-semibold">Time <b class="font-mono">{Math.round(patch.fx.delayTime * 1000)} ms</b>
            <input type="range" min="0.05" max="0.9" step="0.01" bind:value={patch.fx.delayTime} class="w-full accent-[var(--studio-orange)]" /></label>
          <label class="block text-xs font-semibold">Feedback <b class="font-mono">{Math.round(patch.fx.delayFeedback * 100)}%</b>
            <input type="range" min="0" max="0.9" step="0.02" bind:value={patch.fx.delayFeedback} class="w-full accent-[var(--studio-orange)]" /></label>
        </div>
      </fieldset>
    </div>
  </div>
</main>
