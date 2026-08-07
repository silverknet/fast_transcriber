<script lang="ts">
  /**
   * The clock face: a simplified dial, a swept arc, and the hand.
   *
   * Split out of the page so the ROTATION ANCHOR is testable. Everything here
   * turns about the centre of the dial (50,50 in view-box units); getting that
   * wrong makes the hand orbit some other point, which is easy to introduce and
   * impossible to catch in a unit test on the angle alone.
   *
   * The rotation centre is given ONCE, in the SVG `rotate(angle cx cy)`
   * attribute. There is deliberately no CSS `transform-origin` on these
   * elements: the `transform` attribute maps onto the CSS `transform` property,
   * so a `transform-origin` would be applied ON TOP of the centre already named
   * in `rotate()` and offset every rotation. That is exactly the bug this
   * component's test pins.
   */
  let {
    angle,
    startAngle,
    sweptFraction,
    urgent = false,
  }: {
    /** Hand angle, degrees clockwise from 12. */
    angle: number
    /** Where the sweep begins — the arc is drawn from here. */
    startAngle: number
    /** 0…1 of the full dial that has been swept. */
    sweptFraction: number
    urgent?: boolean
  } = $props()

  const R = 42
  const CIRC = 2 * Math.PI * R
  /** Major marks at 12 / 3 / 6 / 9 — a simplified face, not a real clock. */
  const MARKS = [0, 90, 180, 270]

  const dash = $derived(`${Math.max(0, Math.min(1, sweptFraction)) * CIRC} ${CIRC}`)
</script>

<svg viewBox="0 0 100 100" class="dial" class:urgent aria-hidden="true">
  <circle cx="50" cy="50" r={R} class="face" />

  <!-- The swept arc: drawn from 12 o'clock, rotated back to where the run began. -->
  <circle
    cx="50"
    cy="50"
    r={R}
    class="swept"
    stroke-dasharray={dash}
    transform="rotate({startAngle - 90} 50 50)"
  />

  {#each MARKS as deg (deg)}
    <line x1="50" y1="8" x2="50" y2="15" class="mark" transform="rotate({deg} 50 50)" />
  {/each}

  <line
    data-testid="hand"
    x1="50"
    y1="50"
    x2="50"
    y2="13"
    class="hand"
    transform="rotate({angle} 50 50)"
  />
  <circle cx="50" cy="50" r="2.4" class="pin" />
</svg>

<style>
  /* Deliberately smaller than the viewport: this page sits UNDER the app bar,
     and the readout and hint below still need room, so a dial sized to fill the
     screen would push them out of view. `max-height: 100%` plus `min-height: 0`
     let it shrink further inside a short container rather than overflow. */
  .dial {
    flex: 0 1 auto;
    min-height: 0;
    width: auto;
    height: min(52vh, 52vw);
    max-height: 100%;
    aspect-ratio: 1;
  }

  .face {
    fill: none;
    stroke: color-mix(in oklab, var(--foreground) 14%, transparent);
    stroke-width: 1.2;
  }

  .swept {
    fill: none;
    stroke: var(--foreground);
    stroke-width: 1.2;
    opacity: 0.2;
  }

  .mark {
    stroke: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
    stroke-width: 1.2;
    stroke-linecap: round;
  }

  .hand {
    stroke: var(--foreground);
    stroke-width: 1.6;
    stroke-linecap: round;
    opacity: 0.85;
  }

  .pin {
    fill: var(--foreground);
    opacity: 0.85;
  }

  /* The last few seconds. Deliberately understated — the ticking is already
     doing the work, so the face only warms rather than turning into an alarm. */
  .dial.urgent .hand,
  .dial.urgent .pin {
    stroke: var(--destructive);
    fill: var(--destructive);
    opacity: 1;
  }
  .dial.urgent .swept {
    stroke: var(--destructive);
    opacity: 0.28;
  }
</style>
