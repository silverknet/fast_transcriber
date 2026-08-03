<script lang="ts">
  /**
   * ARE MY EDITS ACTUALLY BEING SAVED? — answered from evidence, always visible.
   *
   * Green quiet text = the last save landed (disk write acknowledged, or cloud
   * push with the server's own revision number). Amber = edits in the debounce
   * window. RED = a save FAILED or edits have been pending longer than any
   * healthy debounce — with the exact reason, e.g. "the desktop app has this
   * project open". The red state exists because its absence once cost half an
   * hour of chord corrections, silently.
   */
  import { onMount } from 'svelte'
  import { persistStatus, persistVerdict } from '$lib/stores/persistStatus'

  let now = $state(Date.now())
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 3000)
    return () => clearInterval(id)
  })

  const verdict = $derived(persistVerdict($persistStatus, now))
  const clock = (t: number) =>
    new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const detail = $derived.by(() => {
    const s = $persistStatus
    if (s.disk && !s.disk.ok) return s.disk.error ?? 'The last save to disk failed.'
    if (s.cloud && !s.cloud.ok) return s.cloud.error ?? 'The last save to the cloud failed.'
    if (verdict === 'danger') return 'Edits have not been saved anywhere for a while — stop and check before editing more.'
    const parts: string[] = []
    if (s.disk?.ok) parts.push(`Disk ✓ ${clock(s.disk.at)}`)
    if (s.cloud?.ok) parts.push(`Cloud ✓ rev ${s.cloud.revision ?? '?'} ${clock(s.cloud.at)}`)
    return parts.join(' · ')
  })
</script>

{#if verdict === 'danger'}
  <span
    class="inline-flex max-w-[26rem] items-center gap-1.5 rounded border-2 border-red-600 bg-red-600/10 px-2 py-0.5 text-[11px] font-black text-red-600 dark:text-red-400"
    role="alert"
  >
    <span class="size-2 shrink-0 animate-pulse rounded-full bg-red-600"></span>
    EDITS NOT SAVED — {detail}
  </span>
{:else if verdict === 'saving'}
  <span class="text-muted-foreground text-[11px] font-bold">Saving…</span>
{:else if detail}
  <span class="text-muted-foreground text-[11px]" title="When your edits last provably landed.">{detail}</span>
{/if}
