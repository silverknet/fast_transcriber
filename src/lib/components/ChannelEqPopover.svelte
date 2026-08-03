<script lang="ts">
  /**
   * One mixer channel's EQ, in a popover off a small icon on the lane.
   *
   * Four fixed bands laid out low → high, matching the signal order and the way
   * a console strip reads. Each band is a vertical gain fader with its frequency
   * underneath, so the shape of the boost/cut is visible at a glance without
   * drawing a response curve.
   *
   * Edits are pushed up on every input so the change is heard immediately —
   * turning a knob and waiting is not mixing. The parent owns the value.
   */
  import {
    Popover,
    PopoverContent,
    PopoverTrigger,
  } from '$lib/components/ui/popover'
  import {
    EQ_BAND_IDS,
    EQ_BAND_LABELS,
    EQ_BAND_RANGE,
    EQ_BAND_TYPES,
    EQ_GAIN_LIMIT_DB,
    EQ_HPF_MAX,
    EQ_HPF_MIN,
    EQ_Q_MAX,
    EQ_Q_MIN,
    defaultChannelEq,
    isEqActive,
    type ChannelEq,
    type EqBandId,
  } from '$lib/audio/channelEq'
  import { SlidersVertical } from '@lucide/svelte'

  let {
    label,
    eq,
    onChange,
  }: {
    label: string
    eq: ChannelEq | undefined
    onChange: (next: ChannelEq | undefined) => void
  } = $props()

  /** Always edit against a complete EQ so every control has a value. */
  const current = $derived<ChannelEq>({ ...defaultChannelEq(), ...(eq ?? {}) })
  const active = $derived(isEqActive(eq))
  const bypassed = $derived(current.enabled === false)

  function patch(next: Partial<ChannelEq>) {
    onChange({ ...current, ...next })
  }

  function setBand(id: EqBandId, part: Partial<{ freq: number; gain: number; q: number }>) {
    const band = current[id] ?? { freq: EQ_BAND_RANGE[id].min, gain: 0 }
    patch({ [id]: { ...band, ...part } } as Partial<ChannelEq>)
  }

  /** Back to flat. Drops the whole EQ so nothing is stored or built. */
  function resetEq() {
    onChange(undefined)
  }

  const gainLabel = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`
  const freqLabel = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`)
</script>

<Popover>
  <PopoverTrigger
    class="shrink-0 rounded-[var(--radius)] p-1 transition-colors {active
      ? 'text-[color:var(--studio-orange)]'
      : 'text-muted-foreground hover:text-foreground'}"
    aria-label="{label} EQ"
    title={active ? `${label} EQ (active)` : `${label} EQ`}
  >
    <SlidersVertical class="size-3.5" aria-hidden="true" />
  </PopoverTrigger>

  <PopoverContent class="w-[19rem]">
    <div class="mb-2 flex items-center gap-2">
      <span class="text-[10px] font-black uppercase tracking-widest">EQ</span>
      <span class="text-muted-foreground truncate text-[11px]">{label}</span>
      <label class="ml-auto inline-flex items-center gap-1 text-[11px] font-bold" title="Bypass this channel's EQ">
        <input
          type="checkbox"
          class="accent-foreground size-3"
          checked={!bypassed}
          onchange={(e) => patch({ enabled: e.currentTarget.checked })}
        />
        On
      </label>
    </div>

    <!-- Four bands, low → high: gain vertically, frequency underneath. -->
    <div class="grid grid-cols-4 gap-2 {bypassed ? 'opacity-40' : ''}">
      {#each EQ_BAND_IDS as id (id)}
        {@const band = current[id] ?? { freq: EQ_BAND_RANGE[id].min, gain: 0 }}
        <div class="flex flex-col items-center gap-1">
          <span class="text-muted-foreground text-[9px] font-bold uppercase tracking-wider">
            {EQ_BAND_LABELS[id]}
          </span>
          <span class="font-mono text-[10px] font-bold tabular-nums">{gainLabel(band.gain)}</span>
          <input
            type="range"
            class="h-20 accent-[var(--studio-orange)]"
            style="writing-mode: vertical-lr; direction: rtl;"
            min={-EQ_GAIN_LIMIT_DB}
            max={EQ_GAIN_LIMIT_DB}
            step="0.5"
            value={band.gain}
            disabled={bypassed}
            aria-label="{EQ_BAND_LABELS[id]} gain"
            oninput={(e) => setBand(id, { gain: Number(e.currentTarget.value) })}
          />
          <input
            type="range"
            class="accent-foreground w-full"
            min={EQ_BAND_RANGE[id].min}
            max={EQ_BAND_RANGE[id].max}
            step="1"
            value={band.freq}
            disabled={bypassed}
            aria-label="{EQ_BAND_LABELS[id]} frequency"
            oninput={(e) => setBand(id, { freq: Number(e.currentTarget.value) })}
          />
          <span class="text-muted-foreground font-mono text-[9px] tabular-nums">{freqLabel(band.freq)}Hz</span>
          {#if EQ_BAND_TYPES[id] === 'peaking'}
            <input
              type="range"
              class="accent-foreground/60 w-full"
              min={EQ_Q_MIN}
              max={EQ_Q_MAX}
              step="0.1"
              value={band.q ?? 1}
              disabled={bypassed}
              aria-label="{EQ_BAND_LABELS[id]} width"
              title="Width (Q) {(band.q ?? 1).toFixed(1)}"
              oninput={(e) => setBand(id, { q: Number(e.currentTarget.value) })}
            />
          {/if}
        </div>
      {/each}
    </div>

    <!-- High-pass: the one filter that earns its place on every live channel. -->
    <div class="border-foreground/15 mt-3 flex items-center gap-2 border-t pt-2 {bypassed ? 'opacity-40' : ''}">
      <span class="text-muted-foreground w-12 shrink-0 text-[9px] font-bold uppercase tracking-wider">
        Low cut
      </span>
      <input
        type="range"
        class="accent-foreground h-1 min-w-0 flex-1"
        min="0"
        max={EQ_HPF_MAX}
        step="5"
        value={current.hpf ?? 0}
        disabled={bypassed}
        aria-label="High-pass frequency"
        oninput={(e) => {
          const v = Number(e.currentTarget.value)
          patch({ hpf: v < EQ_HPF_MIN ? 0 : v })
        }}
      />
      <span class="w-12 shrink-0 text-right font-mono text-[10px] font-bold tabular-nums">
        {(current.hpf ?? 0) < EQ_HPF_MIN ? 'Off' : `${Math.round(current.hpf ?? 0)}Hz`}
      </span>
    </div>

    <button
      type="button"
      class="border-foreground/40 hover:bg-muted mt-2 w-full rounded-[var(--radius)] border px-2 py-1 text-[11px] font-bold"
      onclick={resetEq}
    >
      Reset to flat
    </button>
  </PopoverContent>
</Popover>
