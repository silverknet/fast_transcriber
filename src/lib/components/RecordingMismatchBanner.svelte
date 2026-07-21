<script lang="ts">
  /**
   * Shown when this machine's audio is a DIFFERENT RECORDING from the one the
   * song was shared with — not merely a different file. Everyone supplies their
   * own audio, so a WAV vs an MP3 of the same master is normal and silent here;
   * a different cut is not, because every bar and beat is stored as a time into
   * the audio and would land in the wrong place.
   *
   * Purely advisory: it never blocks editing and can be dismissed for the
   * session. The fix lives outside this banner — get the same file from whoever
   * shared the song, via an audio package.
   */
  import { AlertTriangle, X } from '@lucide/svelte'
  import { Button } from '$lib/components/ui/button'
  import { songMap } from '$lib/stores/songMap'
  import { checkRecordingMatchesShared, formatDurationShort } from '$lib/project/recordingCheck'

  let dismissed = $state(false)

  const check = $derived(checkRecordingMatchesShared($songMap))
  const mismatch = $derived(check.status === 'different' ? check : null)
</script>

{#if mismatch && !dismissed}
  <div
    class="border-foreground bg-destructive/10 mx-auto flex w-full max-w-6xl items-start gap-3 border-2 px-4 py-3"
    role="alert"
    aria-live="polite"
  >
    <AlertTriangle class="text-destructive mt-0.5 size-5 shrink-0" aria-hidden="true" />
    <div class="min-w-0 flex-1">
      <div class="text-sm font-bold">This is a different version of the song</div>
      <div class="text-muted-foreground mt-0.5 text-xs">
        {#if mismatch.reason === 'length'}
          Your audio is {formatDurationShort(mismatch.localDurationSec)} long, but the shared song
          uses a {formatDurationShort(mismatch.sharedDurationSec)} version. The bars and beats were
          made for that one, so they won't line up with your file.
        {:else}
          Your audio is the same length as the shared song but sounds like a different mix or
          take. The bars and beats were made for that version, so they may not line up.
        {/if}
      </div>
      <div class="text-muted-foreground mt-1.5 text-xs">
        Ask whoever shared the song for their audio package, then import it — everything will line
        up again. A different file format or quality of the same recording is fine and won't show
        this message.
      </div>
    </div>
    <Button
      variant="outline"
      size="icon-xs"
      class="shrink-0 border-2"
      onclick={() => (dismissed = true)}
      aria-label="Dismiss for this session"
      title="Dismiss for this session"
    >
      <X aria-hidden="true" />
    </Button>
  </div>
{/if}
