<script lang="ts">
  /**
   * Docked stems strip — a real part of the shell (a bottom bar in the edit
   * content column, sibling to the top strip), NOT a floating overlay. Toggle
   * the song's separated stems on/off live during playback. Mirrors live mode:
   * with EVERY stem on the original full mix plays; turning any off plays just
   * the ones left on. Reads the shared transport directly; the parent decides
   * when to show it, and it renders nothing when the song has no stems (so it
   * takes no layout height).
   */
  import { transport } from '$lib/audio/transport.svelte'

  const stems = $derived(transport.stems)
  const allOn = $derived(stems.length > 0 && stems.every((s) => s.enabled))
  const noneOn = $derived(stems.length > 0 && stems.every((s) => !s.enabled))
</script>

{#if stems.length > 0}
  <div
    class="border-foreground bg-card flex shrink-0 flex-wrap items-center justify-end gap-2 border-t-2 px-3 py-1.5"
  >
    <span class="text-muted-foreground mr-auto font-mono text-[10px] uppercase tracking-wider">
      {#if allOn}
        Playing original mix
      {:else if noneOn}
        Silent — all stems off
      {:else}
        Playing selected stems
      {/if}
    </span>

    <span class="font-mono text-[11px] font-black uppercase tracking-wider">Stems</span>
    {#each stems as s (s.key)}
      <button
        type="button"
        onclick={() => transport.setStemEnabled(s.key, !s.enabled)}
        aria-pressed={s.enabled}
        class="border-foreground border-2 px-2 py-0.5 text-xs font-bold transition-colors {s.enabled
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-muted'}"
        title={s.enabled ? `Turn ${s.label} off` : `Turn ${s.label} on`}
      >
        {s.label}
      </button>
    {/each}
  </div>
{/if}
