<script lang="ts">
  /**
   * ONE PERFORMER'S MONITOR BALANCE — edited where their cues live.
   *
   * Two scopes, one idea (the same pattern as the count-in):
   *
   *   MY DEFAULT   — the project-wide balance, follows them through the set.
   *                  Written via `setProjectPerformerMixes`, the only writer.
   *   THIS SONG    — an override on this performer's cue track in this `.smap`.
   *                  Only the levels they actually move are stored, so the rest
   *                  keep INHERITING the default as it changes later.
   *
   * The scope switch is explicit, not inferred: silently deciding "you probably
   * meant just this song" is how a drummer's whole-set click level ends up
   * changed by an edit made during one rehearsal of one song.
   */
  import { get } from 'svelte/store'
  import { onDestroy } from 'svelte'
  import { transport } from '$lib/audio/transport.svelte'
  import { stemNameForKey } from '$lib/audio/liveStemDefaults'
  import { levelForLane } from '$lib/project/performerMix'
  import { project as projectStore } from '$lib/stores/project'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { setProjectPerformerMixes } from '$lib/project/commit'
  import {
    hasSongOverride,
    resolvePerformerMix,
    type PerformerMix,
  } from '$lib/project/performerMix'
  import { AUTO_STEM_NAMES, type AutoStemName } from '$lib/project/types'
  import type { CueTrack } from '$lib/songmap/types'

  let { track }: { track: CueTrack } = $props()

  const performerId = $derived(track.performerId ?? null)
  const performerName = $derived(
    $projectStore.data?.performers?.find((p) => p.id === performerId)?.name ?? track.name,
  )
  const projectDefault = $derived(
    performerId ? $projectStore.data?.performerMixes?.[performerId] : undefined,
  )
  const songOverride = $derived(track.mix as PerformerMix | undefined)
  const resolved = $derived(resolvePerformerMix(projectDefault, songOverride))
  const overridden = $derived(hasSongOverride(songOverride))

  /** Which scope a slider write lands in. Explicit, never inferred. */
  let scope = $state<'default' | 'song'>('default')

  type LaneRow = { key: string; label: string; stem?: AutoStemName }
  const ROWS: LaneRow[] = [
    ...AUTO_STEM_NAMES.map((s) => ({
      key: `stem:${s}`,
      label: s.charAt(0).toUpperCase() + s.slice(1),
      stem: s,
    })),
    { key: 'original', label: 'Full mix' },
    { key: 'click', label: 'Click' },
    { key: 'cue', label: 'Cues' },
  ]

  function valueFor(row: LaneRow): number {
    if (row.stem) return resolved.stems[row.stem] ?? resolved.fallback
    if (row.key === 'original') return resolved.original
    if (row.key === 'click') return resolved.click
    return resolved.cue
  }

  /** The stored shape with one level changed — only that level, so inheritance
   *  keeps working for everything untouched. */
  function withLevel(base: PerformerMix | undefined, row: LaneRow, v: number): PerformerMix {
    const mix: PerformerMix = { stems: { ...(base?.stems ?? {}) } }
    if (base?.original !== undefined) mix.original = base.original
    if (base?.click !== undefined) mix.click = base.click
    if (base?.cue !== undefined) mix.cue = base.cue
    if (base?.fallback !== undefined) mix.fallback = base.fallback
    if (row.stem) mix.stems[row.stem] = v
    else if (row.key === 'original') mix.original = v
    else if (row.key === 'click') mix.click = v
    else mix.cue = v
    return mix
  }

  /** Debounced default write: sliders fire continuously; the manifest write is
   *  one commit after the gesture. */
  let pendingDefault: PerformerMix | null = null
  let defaultTimer: ReturnType<typeof setTimeout> | null = null
  function writeDefault(mix: PerformerMix) {
    pendingDefault = mix
    if (defaultTimer) clearTimeout(defaultTimer)
    defaultTimer = setTimeout(() => {
      const all = { ...(get(projectStore).data?.performerMixes ?? {}) }
      if (performerId && pendingDefault) {
        all[performerId] = pendingDefault
        void setProjectPerformerMixes(all).catch(() => {})
      }
      pendingDefault = null
    }, 400)
  }

  function onSlide(row: LaneRow, v: number) {
    if (!performerId) return
    if (scope === 'song') {
      patchSongMap((m) => ({
        ...m,
        cueTracks: m.cueTracks.map((t) =>
          t.id === track.id ? { ...t, mix: withLevel(t.mix as PerformerMix | undefined, row, v) } : t,
        ),
      }))
    } else {
      // Live-preview through the store so the sliders track, then commit once.
      writeDefault(withLevel(pendingDefault ?? projectDefault, row, v))
    }
  }

  function clearOverride() {
    patchSongMap((m) => ({
      ...m,
      cueTracks: m.cueTracks.map((t) => {
        if (t.id !== track.id) return t
        const { mix: _dropped, ...rest } = t
        return rest as CueTrack
      }),
    }))
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`

  // ── Audition: hear this mix through your own output ──────────────────────
  //
  // Applies the RESOLVED levels to the editor transport (stems + full mix) and
  // scales the click, via a snapshot-and-restore overlay — nothing saved is
  // touched, and switching songs or leaving the tab restores everything.
  // Honest limits, stated in the UI: this is your sound card, not their pack,
  // and the cue level applies in live mode (the editor does not speak cues).
  let auditionOn = $state(false)

  $effect(() => {
    if (!auditionOn) {
      transport.clearAudition()
      return
    }
    // Track `resolved` so slider moves are HEARD while auditioning.
    const gains: Record<string, number> = { original: resolved.original }
    for (const s of transport.stems) {
      gains[s.key] = levelForLane(resolved, s.key, stemNameForKey(s.key))
    }
    transport.auditionMix(gains, resolved.click)
    return () => transport.clearAudition()
  })
  onDestroy(() => transport.clearAudition())
</script>

{#if performerId}
  <section class="border-foreground/20 flex flex-col gap-2 rounded-[var(--radius)] border-2 p-3">
    <header class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-bold">{performerName}’s monitor mix</h3>
      <!-- The scope is the important decision — it gets real buttons, not a
           hidden mode. -->
      <button
        type="button"
        class="ml-auto inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-[11px] font-bold transition-colors {auditionOn
          ? 'border-[var(--studio-orange)] bg-[var(--studio-orange)] text-white'
          : 'border-foreground/30 text-foreground/70 hover:border-foreground'}"
        onclick={() => (auditionOn = !auditionOn)}
        aria-pressed={auditionOn}
        title={auditionOn
          ? 'You are hearing this mix (stems, full mix and click at their levels) through your own output. Click to go back to your normal editor sound.'
          : 'Hear this mix through your own output — stems, full mix and click at their levels. Cue level applies in live mode. Nothing is saved by listening.'}
      >
        {auditionOn ? '● Auditioning' : 'Audition'}
      </button>
      <div class="border-foreground/30 inline-flex overflow-hidden rounded-full border text-[11px] font-bold">
        <button
          type="button"
          class="px-2.5 py-1 {scope === 'default' ? 'bg-foreground text-background' : ''}"
          onclick={() => (scope = 'default')}
          title="Changes apply to every song in the project"
        >
          My default
        </button>
        <button
          type="button"
          class="px-2.5 py-1 {scope === 'song' ? 'bg-foreground text-background' : ''}"
          onclick={() => (scope = 'song')}
          title="Changes apply to this song only; everything else keeps following your default"
        >
          This song
        </button>
      </div>
    </header>

    <p class="text-muted-foreground text-[11px]">
      {#if overridden}
        This song <strong>overrides</strong> your default for the levels you moved here.
        <button type="button" class="underline" onclick={clearOverride}>Follow my default again</button>
      {:else}
        This song follows your default mix.
      {/if}
    </p>

    <div class="grid grid-cols-[6rem_1fr_3rem] items-center gap-x-2 gap-y-1">
      {#each ROWS as row (row.key)}
        <span class="text-xs font-semibold">{row.label}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={valueFor(row)}
          oninput={(e) => onSlide(row, Number(e.currentTarget.value))}
          class="accent-[var(--studio-orange)]"
          aria-label={`${row.label} level for ${performerName}`}
        />
        <span class="text-muted-foreground text-right font-mono text-[11px] tabular-nums">
          {pct(valueFor(row))}
        </span>
      {/each}
    </div>
  </section>
{:else}
  <p class="text-muted-foreground text-xs">
    Link this cue track to a performer to give them their own monitor mix.
  </p>
{/if}
