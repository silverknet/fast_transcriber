<script lang="ts">
  import { transport } from '$lib/audio/transport.svelte'
  import { formatTime } from '$lib/audio/formatTime'
  import { audioSession } from '$lib/stores/audioSession'
  import { Pause, Play, Square } from '@lucide/svelte'

  type EditMode = 'overview' | 'grid' | 'sections' | 'chords' | 'cue' | 'lyrics' | 'leadsheet'

  let { editMode }: { editMode: EditMode } = $props()
</script>

<!-- Persistent transport — rendered ONCE, above every editing panel, so a
     single play button keeps the song playing continuously as the user
     switches tabs (grid → sections → chords → cue → lyrics → lead sheet).
     Exception: on Overview, `MixerView` owns playback via its own engine, so
     these controls are disabled to avoid two engines sounding at once.
     TODO(M1b-next): fold mixer+live onto the shared transport. -->
{#if $audioSession.file}
  <div
    class="border-foreground bg-background flex flex-wrap items-center gap-3 border-2 px-3 py-2 font-mono"
    role="group"
    aria-label="Transport"
  >
    <button
      type="button"
      class="border-foreground inline-flex h-9 w-9 items-center justify-center border-2 transition-colors disabled:opacity-40 {transport.isPlaying
        ? 'bg-[var(--studio-orange)] text-background'
        : 'hover:bg-foreground hover:text-background'}"
      onclick={() => transport.togglePlay()}
      disabled={editMode === 'overview' || !transport.ready}
      aria-label={transport.isPlaying ? 'Pause' : 'Play'}
      title={transport.isPlaying ? 'Pause' : 'Play'}
    >
      {#if transport.isPlaying}
        <Pause class="size-4" aria-hidden="true" />
      {:else}
        <Play class="size-4" aria-hidden="true" />
      {/if}
    </button>
    <button
      type="button"
      class="border-foreground hover:bg-foreground hover:text-background inline-flex h-9 w-9 items-center justify-center border-2 transition-colors disabled:opacity-40"
      onclick={() => transport.stop()}
      disabled={editMode === 'overview' || !transport.ready}
      aria-label="Stop"
      title="Stop and go to selection start"
    >
      <Square class="size-4" aria-hidden="true" />
    </button>
    <span class="text-sm font-bold tabular-nums">
      <span class="text-[var(--studio-orange)]">{formatTime(transport.songTimeSec)}</span>
      <span class="text-muted-foreground">/ {formatTime(transport.durationSec)}</span>
    </span>
    <label
      class="border-foreground/40 hover:bg-foreground/5 ml-auto inline-flex cursor-pointer items-center gap-1.5 border-2 px-2 py-1 text-xs {editMode ===
      'overview'
        ? 'pointer-events-none opacity-40'
        : ''}"
      title="Play clicks alongside the audio (and count-in if configured)"
    >
      <input
        type="checkbox"
        bind:checked={transport.playWithClick}
        disabled={editMode === 'overview'}
        class="accent-foreground size-3.5"
      />
      <span class="font-bold uppercase tracking-wider">Click</span>
    </label>
    {#if editMode === 'overview'}
      <span class="text-muted-foreground w-full text-[11px] sm:w-auto">Mixer controls playback here</span>
    {/if}
  </div>
{/if}
