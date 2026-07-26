<script lang="ts">
  /**
   * Debug-only floating switcher across the Song Edit design-exploration
   * versions, so they're easy to compare side by side. Not used in the shipping
   * app. Overlay pill — never chrome — so it doesn't interfere with judging each
   * layout under the real navbar.
   */
  import { page } from '$app/stores'

  const links = [
    { href: '/debug/song-editor', label: 'Index' },
    { href: '/debug/song-editor/version-1', label: '1 · DAW' },
    { href: '/debug/song-editor/version-2', label: '2 · Inspector' },
    { href: '/debug/song-editor/version-3', label: '3 · Layers' },
    { href: '/debug/song-editor/version-4', label: '4 · Lanes' },
    { href: '/debug/song-editor/version-5', label: '5 · Document' },
  ]
  let current = $derived($page.url.pathname)
</script>

<nav class="sen" aria-label="Song Edit versions">
  <span class="sen-tag">DESIGN</span>
  {#each links as l (l.href)}
    <a
      class="sen-link"
      class:active={current === l.href}
      href={l.href}
      aria-current={current === l.href ? 'page' : undefined}
    >
      {l.label}
    </a>
  {/each}
</nav>

<style>
  .sen {
    position: fixed;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 0.15rem;
    max-width: calc(100vw - 24px);
    flex-wrap: wrap;
    justify-content: center;
    padding: 0.3rem 0.4rem 0.3rem 0.3rem;
    border-radius: 999px;
    background: var(--studio-ink);
    box-shadow: 0 8px 30px color-mix(in oklch, black 35%, transparent);
    font-family: var(--font-sans);
  }
  .sen-tag {
    font-size: 0.58rem;
    font-weight: 950;
    letter-spacing: 0.1em;
    color: color-mix(in oklch, var(--studio-paper) 55%, transparent);
    padding: 0 0.45rem;
  }
  .sen-link {
    font-size: 0.74rem;
    font-weight: 800;
    color: color-mix(in oklch, var(--studio-paper) 80%, transparent);
    text-decoration: none;
    padding: 0.28rem 0.65rem;
    border-radius: 999px;
    white-space: nowrap;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  .sen-link:hover {
    color: var(--studio-paper);
    background: color-mix(in oklch, var(--studio-paper) 14%, transparent);
  }
  .sen-link.active {
    background: var(--studio-orange);
    color: #1a1a1a;
  }
</style>
