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
  import { setProjectAutoStems } from '$lib/project/commit'
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
  let busy = $state(false)
  let error = $state('')

  // Seed the form from the manifest each time the dialog opens.
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
    error = ''
    busy = false
  })

  const chosenStems = $derived(AUTO_STEM_NAMES.filter((n) => selected[n]))
  const noStemsButEnabled = $derived(enabled && chosenStems.length === 0)

  async function save() {
    if (busy) return
    busy = true
    error = ''
    try {
      await setProjectAutoStems({ enabled, stems: chosenStems, quality })
      open = false
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save project settings.'
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

    <div class="flex flex-col gap-5 pt-1">
      <section class="flex flex-col gap-3">
        <label class="flex items-start gap-3">
          <input type="checkbox" bind:checked={enabled} class="accent-foreground mt-0.5 size-4" />
          <span class="flex flex-col">
            <span class="text-sm font-semibold">Prepare stems automatically</span>
            <span class="text-muted-foreground text-xs">
              BarBro keeps the chosen stems ready for every song with audio,
              working in the background. Needs the desktop companion running.
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
                <input
                  type="checkbox"
                  bind:checked={selected[name]}
                  class="accent-foreground size-3.5"
                />
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
      </section>

      {#if noStemsButEnabled}
        <p class="text-amber-600 text-xs">Pick at least one stem, or turn the feature off.</p>
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
