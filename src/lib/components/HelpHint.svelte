<script lang="ts">
  import { onMount } from 'svelte'
  import CircleHelp from '@lucide/svelte/icons/circle-help'

  let {
    label = 'Help',
    text,
    side = 'right',
    class: className = '',
  } = $props<{
    label?: string
    text: string
    side?: 'left' | 'right'
    class?: string
  }>()

  let root = $state<HTMLSpanElement | undefined>()
  let pinned = $state(false)
  let hovering = $state(false)
  let focused = $state(false)
  let open = $derived(pinned || hovering || focused)

  function close() {
    pinned = false
    hovering = false
    focused = false
  }

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!pinned || !root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  })
</script>

<span
  bind:this={root}
  role="presentation"
  class="relative inline-flex {className}"
  onmouseenter={() => (hovering = true)}
  onmouseleave={() => (hovering = false)}
  onfocusin={() => (focused = true)}
  onfocusout={() => (focused = false)}
>
  <button
    type="button"
    class="text-muted-foreground hover:text-foreground focus-visible:ring-ring/70 inline-flex size-6 items-center justify-center rounded-[var(--radius)] outline-none transition-colors focus-visible:ring-2"
    aria-label={label}
    aria-expanded={open}
    onclick={(event) => {
      event.stopPropagation()
      pinned = !pinned
      focused = pinned
    }}
  >
    <CircleHelp class="size-4" aria-hidden="true" />
  </button>
  {#if open}
    <span
      role="tooltip"
      class="brutalist-shadow-sm border-foreground bg-popover text-popover-foreground absolute top-8 z-50 w-64 rounded-[var(--radius)] border-2 px-3 py-2 text-left text-xs leading-relaxed normal-case tracking-normal {side === 'right'
        ? 'left-0'
        : 'right-0'}"
    >
      {text}
    </span>
  {/if}
</span>
