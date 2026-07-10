<script lang="ts">
  /**
   * Project settings — currently houses the auto stem-separation policy.
   *
   * When enabled, BarBro prepares the chosen stems for every (non-hidden)
   * song with audio in the background, at the chosen quality. The actual
   * work is driven by the scheduler in `$lib/client/autoStems.ts`; this
   * dialog only edits the manifest policy via `setProjectAutoStems`.
   */
  import { Button } from '$lib/components/ui/button'
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
  } from '$lib/components/ui/dialog'
  import { get } from 'svelte/store'
  import { project as projectStore } from '$lib/stores/project'
  import {
    setProjectAutoStems,
    setProjectDefaults,
    setProjectMastering,
    applyDefaultsToAllSongs,
  } from '$lib/project/commit'
  import {
    watchProjectForAutoStems,
    unwatchProjectForAutoStems,
    isProjectAutoStemsWatched,
  } from '$lib/client/desktopProjectFs'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import {
    AUTO_STEM_NAMES,
    type AutoStemName,
    type AutoStemQuality,
    type MasteringIntensity,
    type PreCountInCueMode,
  } from '$lib/project/types'
  import { Music4 } from '@lucide/svelte'

  let {
    open = $bindable(false),
    onOpenSetlistExport,
  } = $props<{
    open?: boolean
    onOpenSetlistExport?: () => void
  }>()

  /** Friendly labels — never expose model names / internals here. */
  const STEM_LABELS: Record<AutoStemName, string> = {
    vocals: 'Vocals',
    drums: 'Drums',
    bass: 'Bass',
    other: 'Other (guitars / keys)',
  }
  const QUALITY_OPTIONS: { value: AutoStemQuality; label: string; hint: string }[] = [
    { value: 'preview', label: 'Fast', hint: 'Quickest, roughest separation' },
    { value: 'balanced', label: 'Balanced', hint: 'Good quality, reasonable time' },
    { value: 'best', label: 'Best', hint: 'Highest quality, slowest' },
  ]

  let enabled = $state(false)
  let selected = $state<Record<AutoStemName, boolean>>({
    vocals: false,
    drums: false,
    bass: false,
    other: false,
  })
  let quality = $state<AutoStemQuality>('balanced')
  let countInBeats = $state(0)
  let cueMode = $state<PreCountInCueMode>('off')
  let cueText = $state('')
  // Project sound (mastering)
  type StemSoundForm = { intensity: MasteringIntensity; trimDb: number; tone: boolean }
  // Defaults aim "live ready" out of the box: rich bass, punchy clear drums.
  const DEFAULT_STEM_SOUND: Record<AutoStemName, StemSoundForm> = {
    vocals: { intensity: 'off', trimDb: 0, tone: false },
    drums: { intensity: 'light', trimDb: 0, tone: true },
    bass: { intensity: 'light', trimDb: 0, tone: true },
    other: { intensity: 'off', trimDb: 0, tone: false },
  }
  /** Stem-appropriate tone-shaping label (what 'shaped' means for each). */
  const TONE_LABELS: Record<AutoStemName, string> = {
    vocals: 'Clear',
    drums: 'Punchy & clear',
    bass: 'Rich',
    other: 'Clear',
  }
  let soundEnabled = $state(false)
  let soundMatchLoudness = $state(true)
  let soundMasterGlue = $state(true)
  let soundStems = $state<Record<AutoStemName, StemSoundForm>>(structuredClone(DEFAULT_STEM_SOUND))
  /** THIS machine: auto-prepare stems locally (per-machine, not shared). */
  let localPrepare = $state(false)
  let busy = $state(false)
  let error = $state('')
  let applyMsg = $state('')

  // Seed the form ONCE each time the dialog opens. The store is read via
  // `get()` (non-reactive) on purpose: autosave / cloud-status ticks mutate
  // `$projectStore` constantly, and a reactive read here re-ran the effect on
  // every tick — wiping the user's in-progress selections (e.g. picking a
  // pre-count-in radio snapped straight back to the saved value).
  let seeded = false
  $effect(() => {
    if (!open) {
      seeded = false
      return
    }
    if (seeded) return
    seeded = true
    const snap = get(projectStore)
    const cfg = snap.data?.autoStems
    enabled = cfg?.enabled ?? false
    quality = cfg?.quality ?? 'balanced'
    const set = new Set(cfg?.stems ?? [])
    selected = {
      vocals: set.has('vocals'),
      drums: set.has('drums'),
      bass: set.has('bass'),
      other: set.has('other'),
    }
    countInBeats = snap.data?.defaults?.countInBeats ?? 0
    const pc = snap.data?.defaults?.preCountInCue
    cueMode = pc?.mode ?? 'off'
    cueText = pc?.text ?? ''
    const ms = snap.data?.mastering
    soundEnabled = ms?.enabled ?? false
    soundMatchLoudness = ms?.matchLoudness ?? true
    soundMasterGlue = ms?.masterGlue ?? true
    const stemForm = structuredClone(DEFAULT_STEM_SOUND)
    for (const name of AUTO_STEM_NAMES) {
      const s = ms?.stems?.[name]
      if (!s) continue
      stemForm[name] = {
        intensity: s.intensity ?? 'off',
        trimDb: Math.max(-9, Math.min(9, Math.round(s.trimDb ?? 0))),
        tone: s.tone === 'shaped',
      }
    }
    soundStems = stemForm
    error = ''
    applyMsg = ''
    busy = false
    // This machine's opt-in — read from the sidecar's per-machine watch list.
    const osPath = snap.osPath
    if (osPath) void isProjectAutoStemsWatched(osPath).then((w) => (localPrepare = w))
  })

  const chosenStems = $derived(AUTO_STEM_NAMES.filter((n) => selected[n]))
  const noStemsButEnabled = $derived(enabled && chosenStems.length === 0)
  const songCount = $derived($projectStore.data?.songs.length ?? 0)
  const canExportSetlist = $derived(
    songCount > 0 && $desktopCompanionStatus.reachable && typeof onOpenSetlistExport === 'function',
  )
  const preCountInCue = $derived({
    mode: cueMode,
    ...(cueMode === 'custom' && cueText.trim() ? { text: cueText.trim() } : {}),
  })

  function requestSetlistExport() {
    if (!canExportSetlist) return
    open = false
    onOpenSetlistExport?.()
  }

  async function save() {
    if (busy) return
    busy = true
    error = ''
    try {
      // Shared project config (source of truth).
      await setProjectAutoStems({ enabled, stems: chosenStems, quality })
      await setProjectDefaults({ countInBeats: countInBeats > 0 ? countInBeats : 0, preCountInCue })
      {
        const stems: NonNullable<Parameters<typeof setProjectMastering>[0]['stems']> = {}
        for (const name of AUTO_STEM_NAMES) {
          const f = soundStems[name]
          stems[name] = {
            intensity: f.intensity,
            ...(f.trimDb !== 0 ? { trimDb: f.trimDb } : {}),
            ...(f.tone ? { tone: 'shaped' as const } : {}),
          }
        }
        await setProjectMastering({
          enabled: soundEnabled,
          matchLoudness: soundMatchLoudness,
          masterGlue: soundMasterGlue,
          stems,
        })
      }
      // This machine (local): opt in/out of auto-preparing stems here.
      const osPath = $projectStore.osPath
      if (osPath) {
        if (localPrepare) await watchProjectForAutoStems(osPath)
        else await unwatchProjectForAutoStems(osPath)
      }
      open = false
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save project settings.'
    } finally {
      busy = false
    }
  }

  async function applyCountInToAll() {
    if (busy) return
    busy = true
    error = ''
    applyMsg = ''
    try {
      // Persist the default first so "apply" writes the current value.
      await setProjectDefaults({ countInBeats: countInBeats > 0 ? countInBeats : 0, preCountInCue })
      const r = await applyDefaultsToAllSongs()
      applyMsg =
        r.errors > 0
          ? `Updated ${r.updated} song${r.updated === 1 ? '' : 's'} · ${r.errors} error(s)`
          : `Applied to ${r.updated} song${r.updated === 1 ? '' : 's'}.`
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not apply to all songs.'
    } finally {
      busy = false
    }
  }
</script>

<Dialog bind:open>
  <DialogContent class="max-w-lg">
    <DialogHeader>
      <DialogTitle>Project settings</DialogTitle>
    </DialogHeader>

    <div class="flex max-h-[75vh] flex-col gap-5 overflow-y-auto pt-1">
      <!-- ── Project config — the shared source of truth ─────────────────── -->
      <section class="flex flex-col gap-3">
        <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          Project · shared with collaborators
        </h3>

        <label class="flex items-start gap-3">
          <input type="checkbox" bind:checked={enabled} class="accent-foreground mt-0.5 size-4" />
          <span class="flex flex-col">
            <span class="text-sm font-semibold">Use prepared stems</span>
            <span class="text-muted-foreground text-xs">
              The set of stems this project targets. Whether they're generated on
              <em>your</em> machine is a separate choice below.
            </span>
          </span>
        </label>

        <fieldset
          class="flex flex-col gap-2 pl-7 transition-opacity"
          class:opacity-40={!enabled}
          disabled={!enabled}
        >
          <legend class="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wider">
            Stems
          </legend>
          <div class="grid grid-cols-2 gap-1.5">
            {#each AUTO_STEM_NAMES as name (name)}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" bind:checked={selected[name]} class="accent-foreground size-3.5" />
                {STEM_LABELS[name]}
              </label>
            {/each}
          </div>

          <legend class="text-muted-foreground mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider">
            Quality
          </legend>
          <div class="flex flex-col gap-1.5">
            {#each QUALITY_OPTIONS as opt (opt.value)}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="auto-stem-quality"
                  value={opt.value}
                  checked={quality === opt.value}
                  onchange={() => (quality = opt.value)}
                  class="accent-foreground size-3.5"
                />
                <span class="font-medium">{opt.label}</span>
                <span class="text-muted-foreground text-xs">— {opt.hint}</span>
              </label>
            {/each}
          </div>
        </fieldset>

        <!-- Count-in default -->
        <div class="border-foreground/10 flex flex-col gap-1.5 border-t pt-3">
          <label class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-semibold">Count-in</span>
            <input
              type="number"
              min="0"
              max="16"
              bind:value={countInBeats}
              class="border-foreground/30 bg-background w-16 border-2 px-2 py-1 text-sm tabular-nums focus:border-foreground focus:outline-none"
            />
            <span class="text-muted-foreground text-xs">clicks before each song (0 = none)</span>
          </label>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-7 text-xs"
              onclick={applyCountInToAll}
              disabled={busy}
            >
              Apply to all songs
            </Button>
            {#if applyMsg}<span class="text-muted-foreground text-xs">{applyMsg}</span>{/if}
          </div>
          <span class="text-muted-foreground text-[11px]">
            Saving sets the default for new songs; “Apply to all” also writes it to every existing
            song. You can still override the count-in per song in the editor.
          </span>
        </div>

        <!-- Pre-count-in spoken cue -->
        <div class="border-foreground/10 flex flex-col gap-1.5 border-t pt-3">
          <span class="text-sm font-semibold">Spoken count-in</span>
          <span class="text-muted-foreground text-xs">
            Before the clicks, a voice announces the song and count length, then counts the beats in
            time (e.g. “Valerie… 8… one, two, three…”).
          </span>
          <div class="mt-1 flex flex-col gap-1.5">
            {#each [{ value: 'off', label: 'Off', hint: 'Clicks only' }, { value: 'title', label: 'Announce the song', hint: 'Uses each song’s cue title' }, { value: 'custom', label: 'Custom phrase', hint: 'Same words for every song' }] as opt (opt.value)}
              <label class="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="pre-count-in-cue"
                  value={opt.value}
                  checked={cueMode === opt.value}
                  onchange={() => (cueMode = opt.value as PreCountInCueMode)}
                  class="accent-foreground size-3.5"
                />
                <span class="font-medium">{opt.label}</span>
                <span class="text-muted-foreground text-xs">— {opt.hint}</span>
              </label>
            {/each}
          </div>
          {#if cueMode === 'custom'}
            <input
              type="text"
              bind:value={cueText}
              placeholder="e.g. Here we go"
              maxlength="60"
              class="border-foreground/30 bg-background mt-1 border-2 px-2 py-1 text-sm focus:border-foreground focus:outline-none"
            />
          {/if}
          <span class="text-muted-foreground text-[11px]">
            The count length is taken from the count-in above. Override the spoken words per song in
            the Cue section.
          </span>
        </div>

        <!-- Project sound (mastering) -->
        <div class="border-foreground/10 flex flex-col gap-2 border-t pt-3">
          <label class="flex items-start gap-3">
            <input type="checkbox" bind:checked={soundEnabled} class="accent-foreground mt-0.5 size-4" />
            <span class="flex flex-col">
              <span class="text-sm font-semibold">Project sound</span>
              <span class="text-muted-foreground text-xs">
                Keep drums, bass and the rest sitting at the same level in every song — applied in
                the mixer and to exported mixes.
              </span>
            </span>
          </label>

          <fieldset
            class="flex flex-col gap-2 pl-7 transition-opacity"
            class:opacity-40={!soundEnabled}
            disabled={!soundEnabled}
          >
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={soundMatchLoudness} class="accent-foreground size-3.5" />
              <span class="font-medium">Match loudness across songs</span>
            </label>

            <div class="mt-1 flex flex-col gap-2">
              {#each AUTO_STEM_NAMES as name (name)}
                <div class="border-foreground/15 flex flex-col gap-1.5 border p-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-semibold">{STEM_LABELS[name]}</span>
                    <label class="flex cursor-pointer items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        bind:checked={soundStems[name].tone}
                        class="accent-foreground size-3.5"
                      />
                      <span class="font-medium">{TONE_LABELS[name]}</span>
                    </label>
                  </div>
                  <label class="flex items-center gap-2">
                    <span class="text-muted-foreground w-10 text-[10px] font-bold uppercase tracking-wider">Level</span>
                    <input
                      type="range"
                      min="-9"
                      max="9"
                      step="1"
                      bind:value={soundStems[name].trimDb}
                      class="accent-foreground h-1 min-w-0 flex-1"
                      aria-label={`${STEM_LABELS[name]} level`}
                    />
                    <span class="w-14 text-right font-mono text-xs tabular-nums">
                      {soundStems[name].trimDb > 0 ? '+' : ''}{soundStems[name].trimDb} dB
                    </span>
                  </label>
                  <div class="flex items-center gap-2">
                    <span class="text-muted-foreground w-10 text-[10px] font-bold uppercase tracking-wider">Even</span>
                    <div class="flex gap-1" role="radiogroup" aria-label={`Even out ${STEM_LABELS[name]}`}>
                      {#each [{ v: 'off', l: 'Off' }, { v: 'light', l: 'Light' }, { v: 'firm', l: 'Firm' }] as opt (opt.v)}
                        <button
                          type="button"
                          class="border-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {soundStems[name].intensity === opt.v
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-foreground/30 hover:border-foreground'}"
                          onclick={() => (soundStems[name].intensity = opt.v as MasteringIntensity)}
                          aria-pressed={soundStems[name].intensity === opt.v}
                        >
                          {opt.l}
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
            <span class="text-muted-foreground text-[11px]">
              Level raises or lowers just that stem in every song. “Even” smooths its dynamics so
              e.g. every bass note lands with similar weight. The named toggle shapes the tone —
              rich low end for bass, punch and clarity for drums.
            </span>

            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={soundMasterGlue} class="accent-foreground size-3.5" />
              <span class="font-medium">Glue &amp; protect the master</span>
              <span class="text-muted-foreground text-xs">— gentle bus compression + limiter</span>
            </label>
          </fieldset>
        </div>
      </section>

      <!-- ── This computer — per-machine, never shared ───────────────────── -->
      <section class="border-foreground/10 flex flex-col gap-2 border-t pt-4">
        <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          This computer
        </h3>
        <label class="flex items-start gap-3">
          <input
            type="checkbox"
            bind:checked={localPrepare}
            class="accent-foreground mt-0.5 size-4"
            disabled={!$desktopCompanionStatus.reachable}
          />
          <span class="flex flex-col">
            <span class="text-sm font-semibold">Prepare stems automatically on this computer</span>
            <span class="text-muted-foreground text-xs">
              Only affects this machine. Leave it off if you'd rather wait for a shared audio
              package than have your computer run stem-splitting — it never changes the project or
              anyone else's machine.
            </span>
          </span>
        </label>
        {#if !$desktopCompanionStatus.reachable}
          <p class="text-muted-foreground pl-7 text-[11px]">BarBro Desktop must be running for this.</p>
        {/if}
      </section>

      <section class="border-foreground/10 flex flex-col gap-2 border-t pt-4">
        <h3 class="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          Export
        </h3>
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">Setlist · Ableton Live 12</p>
            <p class="text-muted-foreground text-xs">
              One .als with a scene per song. Click track is re-rendered fresh on every export.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0 gap-1"
            disabled={!canExportSetlist}
            onclick={requestSetlistExport}
            title={songCount === 0
              ? 'Add at least one song before exporting.'
              : !$desktopCompanionStatus.reachable
                ? 'Setlist export needs the BarBro desktop client running.'
                : 'Open the export dialog'}
          >
            <Music4 class="size-3.5" aria-hidden="true" />
            Export .als
          </Button>
        </div>
      </section>

      {#if noStemsButEnabled}
        <p class="text-amber-600 text-xs">Pick at least one stem, or turn “Use prepared stems” off.</p>
      {/if}
      {#if error}
        <p class="text-destructive text-xs">{error}</p>
      {/if}

      <div class="flex justify-end gap-2">
        <Button type="button" class="" variant="ghost" onclick={() => (open = false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" class="" onclick={save} disabled={busy || noStemsButEnabled}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
