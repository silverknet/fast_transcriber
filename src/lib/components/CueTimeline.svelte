<script lang="ts">
  /**
   * Visual cue editor. The song is section-coloured blocks positioned by time;
   * each shows small icons for what it has — a speech cue, a count-in. Click a
   * section to open a popover to set its spoken text (auto-filled with the name),
   * toggle count-in, or (later) record your own voice.
   */
  import { MessageSquare, Hash, Mic, X } from '@lucide/svelte'

  type Section = {
    id: string
    label: string
    startSec: number
    endSec: number
    color: string
    speechOn: boolean
    countOn: boolean
    speechText: string
  }
  type Cue = { id: string; text: string; timeSec: number; color: string }

  let {
    sections = [],
    customCues = [],
    duration = 0,
    onToggleSpeech,
    onToggleCount,
    onSetSpeechText,
    onInsertAtSec,
  } = $props<{
    sections?: Section[]
    customCues?: Cue[]
    duration?: number
    onToggleSpeech?: (sectionId: string) => void
    onToggleCount?: (sectionId: string) => void
    onSetSpeechText?: (sectionId: string, text: string) => void
    onInsertAtSec?: (sec: number) => void
  }>()

  let openId = $state<string | null>(null)
  // Sort by time so blocks are always in song order regardless of input order.
  const ordered = $derived([...sections].sort((a, b) => a.startSec - b.startSec))
  const open = $derived(ordered.find((s) => s.id === openId) ?? null)

  function frac(sec: number): number {
    return duration > 0 ? Math.max(0, Math.min(1, sec / duration)) : 0
  }
  function leftPct(s: Section): number {
    return frac(s.startSec) * 100
  }
  function widthPct(s: Section): number {
    return Math.max(1.5, (frac(s.endSec) - frac(s.startSec)) * 100)
  }

  function onTimelineClick(e: MouseEvent) {
    if (!onInsertAtSec || duration <= 0) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onInsertAtSec(((e.clientX - rect.left) / rect.width) * duration)
  }
</script>

<div class="relative w-full select-none">
  <!-- custom one-off cues as ticks above -->
  <div class="relative h-4">
    {#each customCues as cue (cue.id)}
      <div class="text-muted-foreground absolute top-0 -translate-x-1/2" style="left: {frac(cue.timeSec) * 100}%" title={cue.text}>
        <MessageSquare class="size-3" />
      </div>
    {/each}
  </div>

  <!-- Section blocks (positioned by time); click to edit -->
  <div class="border-foreground relative h-14 w-full overflow-hidden border-2">
    {#if ordered.length === 0}
      <div class="text-muted-foreground flex h-full w-full items-center justify-center text-xs">
        Add sections first — cues attach to them.
      </div>
    {/if}
    {#each ordered as s (s.id)}
      <button
        type="button"
        class="absolute inset-y-0 flex flex-col items-start justify-between border-r border-black/25 px-1.5 py-1 text-left transition-[filter] hover:brightness-110 {openId ===
        s.id
          ? 'ring-foreground z-10 ring-2 ring-inset'
          : ''}"
        style="left: {leftPct(s)}%; width: {widthPct(s)}%; background: {s.color};"
        onclick={(e) => {
          e.stopPropagation()
          openId = openId === s.id ? null : s.id
        }}
        title={`Edit cues for “${s.label}”`}
      >
        <span
          class="max-w-full truncate text-[10px] font-black uppercase tracking-wide"
          style="color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.55);"
        >
          {s.label}
        </span>
        <span class="flex gap-1 text-white" style="text-shadow: 0 1px 2px rgba(0,0,0,0.55);">
          <MessageSquare class="size-3.5 {s.speechOn ? '' : 'opacity-30'}" />
          <Hash class="size-3.5 {s.countOn ? '' : 'opacity-30'}" />
        </span>
      </button>
    {/each}
  </div>

  <!-- Popover for the open section -->
  {#if open}
    <div
      class="border-foreground bg-background absolute z-50 w-72 border-2 p-3 shadow-xl"
      style="top: 4.75rem; left: clamp(0px, calc({leftPct(open)}% - 4.5rem), calc(100% - 18.5rem));"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="text-xs font-black uppercase tracking-wide" style="color: {open.color}">{open.label}</span>
        <button type="button" class="text-muted-foreground hover:text-foreground" onclick={() => (openId = null)} aria-label="Close">
          <X class="size-4" />
        </button>
      </div>

      <!-- Spoken cue -->
      <label class="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={open.speechOn} class="accent-foreground" onchange={() => onToggleSpeech?.(open.id)} />
        <MessageSquare class="size-4" /> Spoken cue
      </label>
      <input
        type="text"
        value={open.speechText}
        placeholder={open.label}
        disabled={!open.speechOn}
        class="border-foreground/40 bg-background mt-1 w-full border-2 px-2 py-1 text-sm disabled:opacity-40"
        oninput={(e) => onSetSpeechText?.(open.id, (e.currentTarget as HTMLInputElement).value)}
      />

      <!-- Count-in -->
      <label class="mt-3 flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={open.countOn} class="accent-foreground" onchange={() => onToggleCount?.(open.id)} />
        <Hash class="size-4" /> Count-in
      </label>

      <!-- Record your own (placeholder) -->
      <button
        type="button"
        class="border-foreground/30 text-muted-foreground mt-3 flex w-full items-center justify-center gap-2 border-2 border-dashed px-2 py-1.5 text-xs font-bold"
        disabled
        title="Record your own voice — coming soon"
      >
        <Mic class="size-3.5" /> Record your own (soon)
      </button>
    </div>
  {/if}

  <!-- Thin click strip to drop a custom cue -->
  <button
    type="button"
    class="border-foreground/40 text-muted-foreground mt-2 h-6 w-full cursor-copy border text-[11px] hover:bg-muted/40"
    onclick={onTimelineClick}
    title="Click to add a custom cue at this point"
  >
    + custom cue
  </button>
</div>
