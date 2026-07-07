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
  import { project as projectStore } from '$lib/stores/project'
  import { setProjectAutoStems, setProjectDefaults, applyDefaultsToAllSongs } from '$lib/project/commit'
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
  } from '$lib/project/types'

  let { open = $bindable(false) } = $props<{ open?: boolean }>()

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
  /** THIS machine: auto-prepare stems locally (per-machine, not shared). */
  let localPrepare = $state(false)
  let busy = $state(false)
  let error = $state('')
  let applyMsg = $state('')

  // Seed the form from the manifest (+ this machine's watch state) on open.
  $effect(() => {
    if (!open) return
    const cfg = $projectStore.data?.autoStems
    enabled = cfg?.enabled ?? false
    quality = cfg?.quality ?? 'balanced'
    const set = new Set(cfg?.stems ?? [])
    selected = {
      vocals: set.has('vocals'),
      drums: set.has('drums'),
      bass: set.has('bass'),
      other: set.has('other'),
    }
    countInBeats = $projectStore.data?.defaults?.countInBeats ?? 0
    error = ''
    applyMsg = ''
    busy = false
    // This machine's opt-in — read from the sidecar's per-machine watch list.
    const osPath = $projectStore.osPath
    if (osPath) void isProjectAutoStemsWatched(osPath).then((w) => (localPrepare = w))
  })

  const chosenStems = $derived(AUTO_STEM_NAMES.filter((n) => selected[n]))
  const noStemsButEnabled = $derived(enabled && chosenStems.length === 0)

  async function save() {
    if (busy) return
    busy = true
    error = ''
    try {
      // Shared project config (source of truth).
      await setProjectAutoStems({ enabled, stems: chosenStems, quality })
      await setProjectDefaults({ countInBeats: countInBeats > 0 ? countInBeats : 0 })
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
      await setProjectDefaults({ countInBeats: countInBeats > 0 ? countInBeats : 0 })
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
  <DialogContent class="max-w-md">
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
