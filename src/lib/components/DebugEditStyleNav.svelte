<script lang="ts">
  /**
   * Debug-only floating switcher across the edit-mode STYLE explorations, so you
   * can flip between them in place while the REAL app navbar shows above. Not
   * used in the shipping app. Deliberately an overlay pill — never chrome — so
   * it doesn't interfere with judging each design under the real AppMenuBar.
   */
  import { page } from '$app/stores'

  const links = [
    { href: '/debug/edit-style', label: 'Overview' },
    { href: '/debug/edit-style/current', label: 'Current' },
    { href: '/debug/edit-style/base', label: 'Base' },
    { href: '/debug/edit-style/brutal', label: 'Brutalist' },
    { href: '/debug/edit-style/editorial', label: 'Editorial' },
    { href: '/debug/edit-style/daw', label: 'Pro-tool' },
    { href: '/debug/edit-style/soft', label: 'Soft' },
  ]
  let current = $derived($page.url.pathname)
</script>

<nav class="esn" aria-label="Edit-style variants">
  <span class="esn-tag">DEBUG</span>
  {#each links as l (l.href)}
    <a
      class="esn-link"
      class:active={current === l.href}
      href={l.href}
      aria-current={current === l.href ? 'page' : undefined}
    >
      {l.label}
    </a>
  {/each}
</nav>

<style>
  .esn {
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
  .esn-tag {
    font-size: 0.58rem;
    font-weight: 950;
    letter-spacing: 0.1em;
    color: color-mix(in oklch, var(--studio-paper) 55%, transparent);
    padding: 0 0.45rem;
  }
  .esn-link {
    font-size: 0.76rem;
    font-weight: 800;
    color: color-mix(in oklch, var(--studio-paper) 80%, transparent);
    text-decoration: none;
    padding: 0.28rem 0.7rem;
    border-radius: 999px;
    white-space: nowrap;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }
  .esn-link:hover {
    color: var(--studio-paper);
    background: color-mix(in oklch, var(--studio-paper) 14%, transparent);
  }
  .esn-link.active {
    background: var(--studio-orange);
    color: #1a1a1a;
  }
</style>
