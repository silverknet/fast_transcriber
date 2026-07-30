<script lang="ts">
  import DrumTrackPanel from '$lib/components/DrumTrackPanel.svelte'
  import MixerView from '$lib/components/MixerView.svelte'
  import type { MixerControls } from '$lib/components/editor/TransportBar.svelte'
  import { songMap } from '$lib/stores/songMap'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { fingerprintCueTrackInputs } from '$lib/songmap/cueTrackFingerprint'
  import { cueRender } from '$lib/audio/cueRender.svelte'

  // Transpose-aware key label is cross-tab state (also drawn in the song header),
  // so it stays owned by the shell and is passed down.
  let {
    keyLabel,
    playbackMode = $bindable(false),
    controls = $bindable(null),
  }: {
    keyLabel: string | null
    playbackMode?: boolean
    /** Published up so the shell's single transport can drive this engine. */
    controls?: MixerControls | null
  } = $props()

  /** Which stem generator the mixer's "Add track" menu opened, if any. */
  let generatorPanel = $state<'drums' | 'bass' | null>(null)

  // `reloadSignal` forces `MixerView` to re-scan + re-load its lanes (e.g. after
  // a fresh cue render adds a cue lane, or a drum-kit change swaps a stem).
  let mixerReloadSignal = $state(0)

  // Auto-render cues once they exist — no manual "Generate" needed. When a cue
  // track has content but its rendered WAV is missing/stale, and the voice
  // engine is ready, render it (debounced so editing text doesn't spam TTS).
  // The fingerprint guard stops it retrying the same content on failure. This
  // effect only runs while the Overview is mounted (its only consumer), so it's
  // now the panel's own lifecycle rather than an `editMode`-gated page effect.
  let cueAutoRenderTimer: ReturnType<typeof setTimeout> | null = null
  let cueAutoRenderFp = ''
  $effect(() => {
    const sm = $songMap
    const track = cueRender.overviewCueTrack
    const canRender =
      cueRender.overviewHasCueContent &&
      !cueRender.overviewCueRendered &&
      $desktopCompanionStatus.reachable &&
      cueRender.piperCueReady
    if (cueAutoRenderTimer) {
      clearTimeout(cueAutoRenderTimer)
      cueAutoRenderTimer = null
    }
    if (!sm || !track || !canRender || cueRender.cueGenBusy) return
    const fp = fingerprintCueTrackInputs(sm, track)
    if (fp === cueAutoRenderFp) return
    cueAutoRenderTimer = setTimeout(() => {
      cueAutoRenderFp = fp
      void cueRender.generateCueTrackWav().then(() => mixerReloadSignal++)
    }, 1200)
  })
</script>

{#if $songMap}
  {@const sm = $songMap}
  <section class="flex min-h-0 w-full flex-1 flex-col" aria-label="Overview">
    {#if generatorPanel}
      <div class="shrink-0">
        <div class="flex justify-end">
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground rounded-[var(--radius)] px-2 py-0.5 text-xs font-bold transition-colors"
            onclick={() => (generatorPanel = null)}
          >
            Close generator
          </button>
        </div>
        <DrumTrackPanel show={generatorPanel} onChanged={() => mixerReloadSignal++} />
      </div>
    {/if}

    <!-- The mixer fills the remaining height; its lane list scrolls internally
         only when there are more lanes than fit. -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <MixerView reloadSignal={mixerReloadSignal} bind:playbackMode bind:generatorPanel bind:controls />
    </div>
  </section>
{/if}
