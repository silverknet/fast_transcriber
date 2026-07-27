<script lang="ts">
  import EditSectionToolbar from '$lib/components/EditSectionToolbar.svelte'
  import DrumTrackPanel from '$lib/components/DrumTrackPanel.svelte'
  import MixerView from '$lib/components/MixerView.svelte'
  import { songMap } from '$lib/stores/songMap'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { fingerprintCueTrackInputs } from '$lib/songmap/cueTrackFingerprint'
  import { cueRender } from '$lib/audio/cueRender.svelte'

  // Transpose-aware key label is cross-tab state (also drawn in the song header),
  // so it stays owned by the shell and is passed down.
  let { keyLabel }: { keyLabel: string | null } = $props()

  // The BarBro Band tools (drum/bass kit picker) are a big panel — hidden by
  // default in the Overview; remembered per browser.
  let showBandTools = $state(
    typeof localStorage !== 'undefined' && localStorage.getItem('barbro::edit::bandTools') === '1',
  )
  function toggleBandTools() {
    showBandTools = !showBandTools
    try {
      localStorage.setItem('barbro::edit::bandTools', showBandTools ? '1' : '0')
    } catch {
      /* private mode */
    }
  }

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
    <EditSectionToolbar
      title="Overview"
      helpText="Original audio, stems, and cues load as separate lanes. Volume, mute, and solo settings are saved with the song, and every lane stays aligned for playback and export. Click on a waveform to seek."
    />

    <div class="flex shrink-0 justify-end">
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground rounded-[var(--radius)] px-2 py-0.5 text-xs font-bold transition-colors"
        onclick={toggleBandTools}
        aria-expanded={showBandTools}
      >
        {showBandTools ? 'Hide' : 'Show'} BarBro Band tools
      </button>
    </div>

    {#if showBandTools}
      <div class="shrink-0">
        <DrumTrackPanel onChanged={() => mixerReloadSignal++} />
      </div>
    {/if}

    <!-- The mixer fills the remaining height; its lane list scrolls internally
         only when there are more lanes than fit. -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <MixerView reloadSignal={mixerReloadSignal} />
    </div>
  </section>
{/if}
