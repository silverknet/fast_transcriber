<script lang="ts">
  /**
   * A 45-second timer. Space starts it, the hand sweeps from quarter past round
   * to 00, the ticking closes in, and a bell lands on zero.
   *
   * Completely orthogonal to the rest of BarBro: its own `AudioContext`, no
   * store, no `.smap`, no mixer, no `$lib` import. Delete the folder and nothing
   * else changes.
   *
   * The audio is pre-scheduled on the audio clock at the moment you press space
   * (see `timerSound.ts`); the animation frame only READS elapsed time from that
   * same clock, so the hand can never drift away from the ticks.
   */
  import TimerDial from './TimerDial.svelte'
  import { handAngleDeg, isFinished, remainingSec, TIMER_SECONDS } from './timerModel'
  import { BELL_TAIL_SEC, startTimerSound, type TimerSound } from './timerSound'

  type Phase = 'idle' | 'running' | 'done'

  let phase = $state<Phase>('idle')
  let elapsedSec = $state(0)
  let sound: TimerSound | null = null
  let frame = 0
  let root = $state<HTMLElement | null>(null)
  let isFullscreen = $state(false)

  const angle = $derived(handAngleDeg(elapsedSec))
  const startAngle = handAngleDeg(0)
  const secondsLeft = $derived(phase === 'idle' ? TIMER_SECONDS : remainingSec(elapsedSec))
  /** The swept arc, as a fraction of the whole dial. */
  const sweptFraction = $derived((angle - startAngle) / 360)
  /** Last five seconds: the face picks up the urgency the ticks already have. */
  const urgent = $derived(phase === 'running' && secondsLeft <= 5)

  function stopRun() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    sound?.stop()
    sound = null
  }

  function reset() {
    stopRun()
    phase = 'idle'
    elapsedSec = 0
  }

  function start() {
    stopRun()
    elapsedSec = 0
    phase = 'running'
    sound = startTimerSound()

    const tick = () => {
      const s = sound
      if (!s) return
      // Elapsed comes from the AUDIO clock, not from rAF deltas — the ticks are
      // already committed to it, so anything else would slide against them.
      elapsedSec = Math.max(0, s.ctx.currentTime - s.startedAt)
      if (isFinished(elapsedSec)) {
        elapsedSec = TIMER_SECONDS
        phase = 'done'
        // The bell is already scheduled; let it ring out, then release the context.
        const finished = sound
        sound = null
        frame = 0
        setTimeout(() => finished?.stop(), BELL_TAIL_SEC * 1000)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }

  /** Space is the whole interface: start, or stop what is running. */
  function toggle() {
    if (phase === 'running') reset()
    else start()
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await root?.requestFullscreen()
    } catch {
      /* refused — not worth surfacing on a debug page */
    }
  }

  // Keyboard + fullscreen state are non-reactive sinks, which is what $effect is for.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        void toggleFullscreen()
      }
    }
    const onFs = () => (isFullscreen = !!document.fullscreenElement)
    window.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
    }
  })

  $effect(() => () => stopRun())
</script>

<svelte:head><title>45s timer</title></svelte:head>

<div
  bind:this={root}
  class="timer-root"
  role="button"
  tabindex="0"
  onclick={toggle}
  onkeydown={(e) => e.key === 'Enter' && toggle()}
>
  <TimerDial {angle} {startAngle} {sweptFraction} {urgent} />

  <div class="readout" class:urgent>{secondsLeft}</div>

  <div class="hint">
    {#if phase === 'idle'}
      Press <kbd>space</kbd> to start · <kbd>F</kbd> full screen
    {:else if phase === 'running'}
      <kbd>space</kbd> to stop
    {:else}
      Done · <kbd>space</kbd> to run again
    {/if}
  </div>

  <div class="controls">
    <button onclick={(e) => { e.stopPropagation(); void toggleFullscreen() }}>
      {isFullscreen ? 'Exit full screen' : 'Full screen'}
    </button>
  </div>
</div>

<style>
  /* No palette of its own — these are the app's theme tokens from `app.css`,
     so the page follows whatever light/dark the rest of BarBro is showing. */
  .timer-root {
    /* NOT a fixed overlay: `AppMenuBar` sits above this route and already
       carries the light/dark toggle. Filling the scroll area (rather than the
       viewport) is what keeps the whole timer under the bar without scrolling. */
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    min-height: 100%;
    padding: 1.25rem 1rem 3.25rem;
    background: var(--background);
    color: var(--foreground);
    cursor: pointer;
    user-select: none;
    font-variant-numeric: tabular-nums;
  }

  .timer-root:fullscreen {
    min-height: 100dvh;
    padding: 2rem;
  }

  .readout {
    font-size: clamp(1.5rem, 5vh, 2.5rem);
    font-weight: 500;
    letter-spacing: 0.01em;
    line-height: 1;
    color: color-mix(in oklab, var(--foreground) 70%, transparent);
  }
  .readout.urgent {
    color: var(--destructive);
  }

  .hint {
    font-size: 0.7rem;
    color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
    letter-spacing: 0.02em;
  }

  kbd {
    border: 1px solid color-mix(in oklab, var(--foreground) 18%, transparent);
    border-radius: 3px;
    padding: 0.05rem 0.28rem;
    font: inherit;
  }

  .controls {
    position: absolute;
    right: 0.75rem;
    bottom: 0.75rem;
  }

  .controls button {
    background: transparent;
    border: 1px solid color-mix(in oklab, var(--foreground) 15%, transparent);
    border-radius: var(--radius);
    color: color-mix(in oklab, var(--muted-foreground) 75%, transparent);
    padding: 0.25rem 0.6rem;
    font: inherit;
    font-size: 0.7rem;
    cursor: pointer;
  }
  .controls button:hover {
    color: var(--foreground);
    border-color: color-mix(in oklab, var(--foreground) 35%, transparent);
  }
</style>
