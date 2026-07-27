<script lang="ts">
  import { untrack } from 'svelte'
  import { get } from 'svelte/store'
  import EditSectionToolbar from '$lib/components/EditSectionToolbar.svelte'
  import { patchSongMap, songMap } from '$lib/stores/songMap'
  import { project as projectStore } from '$lib/stores/project'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import { parseChordSheet } from '$lib/chords/sheet/parseChordSheet'
  import { shouldReseedLyricsDraft } from '$lib/editor/liveEditGuards'
  import { alignLyricsToTranscription, tokenizeLyrics } from '$lib/lyrics/align'
  import { detectLyricsLanguage } from '$lib/lyrics/detectLyricsLanguage'
  import { selectBestStemSet, refreshProjectInfo } from '$lib/project/commit'
  import { readProjectSongAsset } from '$lib/client/desktopProjectFs'
  import { vocalPresenceFromBuffer } from '$lib/audio/vocalPresence'
  import {
    getLyricsSetupStatus,
    setupLyricsDeps,
    enqueueLyricsTranscription,
    subscribeToJobEvents,
    pickOpenFileViaDesktop,
    type LyricsTranscriptionEvent,
    type LyricsTranscriptionWord,
  } from '$lib/client/desktopBridge'
  import { importVocalStem, type AlignmentVerdict } from '$lib/client/importVocalStem'
  import { uploadSongCloudAudio } from '$lib/client/cloudAudioSync'

  let { activeDraftLabel }: { activeDraftLabel: string } = $props()

  // ── Lyrics tab ─────────────────────────────────────────────────────────
  // Paste → clean ([Chorus] markers etc.) → save into `sm.lyrics.sourceText`.
  // Timing (`lyrics.words`) comes from "Fit to song" (Phase C); editing the
  // text after an alignment clears the words — their timing is stale.
  let lyricsDraft = $state('')
  /** Which song the draft was seeded for — re-seed on song switch. */
  let lyricsSeededFor = ''
  /** The stored text the draft was last seeded from — lets a LIVE remote lyrics
   *  edit reseed the same song without clobbering text the user is typing. */
  let lyricsSeededText = ''
  let lyricsFocused = $state(false)
  $effect(() => {
    const sm = $songMap
    if (!sm) return
    const key = `${$projectStore.activeSongId ?? 'session'}::${sm.metadata.title}`
    const stored = sm.lyrics?.sourceText ?? ''
    untrack(() => {
      if (
        !shouldReseedLyricsDraft({
          keyChanged: lyricsSeededFor !== key,
          storedText: stored,
          seededText: lyricsSeededText,
          draft: lyricsDraft,
          focused: lyricsFocused,
        })
      )
        return
      lyricsSeededFor = key
      lyricsSeededText = stored
      lyricsDraft = stored
    })
  })

  // Chord-sheet awareness: a paste that carries chord lines (Ultimate-Guitar
  // style, chords above lyrics) yields both lyrics AND placeable chords. For
  // plain lyrics `sheetParsed.lyricsText` equals `cleanLyricsText().text`.
  const sheetParsed = $derived(parseChordSheet(lyricsDraft))
  const lyricsCleanedPreview = $derived({
    text: sheetParsed.lyricsText,
    lines: sheetParsed.lyricsText.split('\n').filter((l) => l.length > 0),
  })
  const lyricsSaved = $derived($songMap?.lyrics ?? null)
  const lyricsDraftMatchesSaved = $derived(
    (lyricsSaved?.sourceText ?? '') === lyricsCleanedPreview.text,
  )
  let lyricsSaveMsg = $state('')

  function saveLyrics() {
    const cleaned = {
      text: sheetParsed.lyricsText,
      lines: lyricsCleanedPreview.lines,
    }
    const p = patchSongMap((m) => {
      if (!cleaned.text) {
        const { lyrics: _lyrics, ...rest } = m
        return rest as typeof m
      }
      const sameText = m.lyrics?.sourceText === cleaned.text
      return {
        ...m,
        lyrics: sameText && m.lyrics
          ? m.lyrics // unchanged text keeps existing word timing
          : { words: [], sourceText: cleaned.text },
      }
    })
    if (!p.ok) {
      lyricsSaveMsg = p.errors.join('; ')
      return
    }
    lyricsDraft = cleaned.text
    // Track what we now consider "saved" so a later LIVE remote edit reseeds.
    lyricsSeededText = cleaned.text
    lyricsSaveMsg = cleaned.text
      ? `Saved ${cleaned.lines.length} line${cleaned.lines.length === 1 ? '' : 's'}.`
      : 'Lyrics removed.'
  }

  // ── "Fit to song": transcribe the vocal → align imported words to it ──
  let lyricsFitBusy = $state(false)
  let lyricsFitMsg = $state('')
  let lyricsFitErr = $state('')
  let lyricsMatchedPct = $state<number | null>(null)
  let lyricsMatchedRows = $state(0)
  let lyricsTotalRows = $state(0)

  /** Vocals stem if on disk (cleanest recognition), else the original audio. */
  function resolveLyricsAudioAbsPath(): { abs: string; usedStem: boolean } | null {
    const ps = get(projectStore)
    const sm = get(songMap)
    if (!ps.osPath || !ps.activeSongFolder || !sm) return null
    const meta = ps.metadataByFolder[ps.activeSongFolder]
    const best = selectBestStemSet(meta)
    const vocalsFile = best?.files.find((f) => /^vocals\.(wav|mp3)$/i.test(f))
    if (vocalsFile) {
      return {
        abs: `${ps.osPath}/${ps.activeSongFolder}/${best!.pathPrefix}${vocalsFile}`,
        usedStem: true,
      }
    }
    const rel = sm.audio?.originalPath
    if (!rel) return null
    return { abs: `${ps.osPath}/${ps.activeSongFolder}/${rel}`, usedStem: false }
  }

  // ── Import a vocals source (for instrumental songs with no vocals to fit) ──
  let vocalImportBusy = $state(false)
  let vocalImportMsg = $state('')
  let vocalImportErr = $state('')
  /** Set when the aligner is unsure — the UI offers "use it anyway". */
  let vocalImportConfirm = $state<{ verdict: AlignmentVerdict; uploadAbs: string } | null>(null)
  /** Best-effort: true once we've confirmed the current vocals stem is silent. */
  let vocalStemEmpty = $state(false)
  let vocalStemChecked = ''

  /** The song's existing (instrumental) audio — the alignment reference. */
  function resolveSongOriginalAudioAbs(): string | null {
    const ps = get(projectStore)
    const sm = get(songMap)
    if (!ps.osPath || !ps.activeSongFolder || !sm?.audio?.originalPath) return null
    return `${ps.osPath}/${ps.activeSongFolder}/${sm.audio.originalPath}`
  }

  /**
   * Decode the current vocals stem (if any) and flag whether it's effectively
   * empty — the signal that this is an instrumental and lyrics can't be fit
   * until a vocals source is imported. Best-effort; failures leave it false.
   */
  async function checkVocalStemEmpty() {
    const ps = get(projectStore)
    if (!ps.osPath || !ps.activeSongFolder) return
    const key = ps.activeSongFolder
    if (vocalStemChecked === key) return
    vocalStemChecked = key
    vocalStemEmpty = false
    try {
      const meta = ps.metadataByFolder[ps.activeSongFolder]
      const best = selectBestStemSet(meta)
      const vocalsFile = best?.files.find((f) => /^vocals\.(wav|mp3)$/i.test(f))
      if (!best || !vocalsFile) return
      const got = await readProjectSongAsset(ps.osPath, ps.activeSongFolder, `${best.pathPrefix}${vocalsFile}`)
      if (!got.ok) return
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      try {
        const buf = await ctx.decodeAudioData(await got.blob.arrayBuffer())
        vocalStemEmpty = !vocalPresenceFromBuffer(buf).hasVocals
      } finally {
        void ctx.close()
      }
    } catch {
      /* best-effort — leave vocalStemEmpty false */
    }
  }

  async function pickAndImportVocals() {
    if (vocalImportBusy) return
    vocalImportErr = ''
    const picked = await pickOpenFileViaDesktop({
      title: 'Choose a version of this song WITH vocals',
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'aiff'] }],
    })
    if (!picked.ok) {
      if ('error' in picked) vocalImportErr = picked.error
      return
    }
    await runVocalImport(picked.path, false)
  }

  async function runVocalImport(uploadAbs: string, force: boolean) {
    const ps = get(projectStore)
    const sm = get(songMap)
    const refAbs = resolveSongOriginalAudioAbs()
    if (!ps.osPath || !ps.activeSongFolder || !sm || !refAbs) {
      vocalImportErr = 'This song needs its audio in the project first.'
      return
    }
    const meta = ps.metadataByFolder[ps.activeSongFolder]
    const best = selectBestStemSet(meta)
    const bestStemPrefix = best?.pathPrefix ?? 'stems/best/'

    vocalImportBusy = true
    vocalImportErr = ''
    vocalImportConfirm = null
    try {
      const result = await importVocalStem({
        refAudioAbs: refAbs,
        uploadAbs,
        osPath: ps.osPath,
        songFolder: ps.activeSongFolder,
        bestStemPrefix,
        songDurationSec: sm.audio?.durationSec ?? 0,
        songId: ps.activeSongId,
        force,
        onProgress: (m) => (vocalImportMsg = m),
      })
      if (result.status === 'needs-confirmation') {
        vocalImportConfirm = { verdict: result.verdict, uploadAbs }
        return
      }
      if (result.status === 'error') {
        vocalImportErr = result.error
        return
      }

      // Installed. Point stemRefs at the new vocal stem so the mixer + cloud
      // upload pick it up, and refresh the on-disk stem discovery.
      patchSongMap((cur) => ({
        ...cur,
        stemRefs: { ...(cur.stemRefs ?? {}), Vocals: result.vocalStemSubpath },
      }))
      vocalStemEmpty = false
      vocalStemChecked = '' // re-check next time
      await refreshProjectInfo().catch(() => {})

      // Compress + upload to the cloud like the other stems (best-effort).
      const cloud = get(projectStore).data?.cloud
      if (cloud && ps.activeSongId) {
        try {
          vocalImportMsg = 'Uploading the vocal stem to collaborators…'
          const nextSm = get(songMap)
          await uploadSongCloudAudio({
            osPath: ps.osPath,
            songFolder: ps.activeSongFolder,
            projectId: cloud.projectId,
            songId: ps.activeSongId,
            mixSrcSubpath: nextSm?.audio?.originalPath ?? '',
            stems: nextSm?.stemRefs ?? {},
            sourceSha256: nextSm?.audio?.sha256,
            durationSec: nextSm?.audio?.durationSec,
            onProgress: (m) => (vocalImportMsg = m),
          })
        } catch (e) {
          // Non-fatal — the local stem + fit still work.
          console.warn('[vocal-import] cloud upload failed:', e)
        }
      }

      // Auto-run Fit on the freshly imported vocals.
      vocalImportBusy = false
      vocalImportMsg = ''
      if (get(songMap)?.lyrics?.sourceText) await fitLyricsToSong()
      return
    } catch (e) {
      vocalImportErr = e instanceof Error ? e.message : String(e)
    } finally {
      vocalImportBusy = false
      vocalImportMsg = ''
    }
  }

  // When the lyrics tab opens (desktop only), quietly check whether the vocal
  // stem is empty so the import affordance can lead with the right message.
  $effect(() => {
    if ($desktopCompanionStatus.reachable) {
      void checkVocalStemEmpty()
    }
  })

  async function fitLyricsToSong() {
    if (lyricsFitBusy) return
    const sm = get(songMap)
    const sourceText = sm?.lyrics?.sourceText
    if (!sm || !sourceText) {
      lyricsFitErr = 'Save the lyrics first.'
      return
    }
    const src = resolveLyricsAudioAbsPath()
    if (!src) {
      lyricsFitErr = 'This song needs its audio in the project to fit lyrics.'
      return
    }
    lyricsFitBusy = true
    lyricsFitErr = ''
    lyricsMatchedPct = null
    try {
      // 1. Lyrics engine ready? (one-time install, user-triggered)
      lyricsFitMsg = 'Checking the lyrics engine…'
      const status = await getLyricsSetupStatus()
      if (!status) {
        lyricsFitErr = 'BarBro Desktop is not reachable (or needs an update).'
        return
      }
      if (!status.ready) {
        lyricsFitMsg = 'Preparing the lyrics engine (one-time)…'
        const setup = await setupLyricsDeps((ev) => {
          if (ev.type === 'progress') lyricsFitMsg = ev.label
        })
        if (!setup.ok) {
          lyricsFitErr = setup.error
          return
        }
      }

      // 2. Transcribe (the model downloads on the very first run). Hand the
      // recognizer a language hint read off the imported lyrics — far more
      // reliable than letting it guess from sung audio (which mis-detected
      // Swedish as Norwegian and halved the recognized words).
      lyricsFitMsg = src.usedStem ? 'Listening to the vocal track…' : 'Listening to the song…'
      const lyricsLang = detectLyricsLanguage(sourceText)
      const enq = await enqueueLyricsTranscription(src.abs, lyricsLang ? { language: lyricsLang } : {})
      if (!enq.ok) {
        lyricsFitErr = enq.error
        return
      }
      const words = await new Promise<LyricsTranscriptionWord[]>((resolve, reject) => {
        const userFacingTranscriptionLog = (msg: string): string | null => {
          const normalized = msg.toLowerCase()
          if (normalized.includes('downloading speech model')) {
            return 'Downloading the voice model — first time only (a few minutes)…'
          }
          return null
        }
        const disconnect = subscribeToJobEvents<LyricsTranscriptionEvent>(
          enq.jobId,
          (ev) => {
            if (ev.type === 'progress' && typeof ev.ratio === 'number') {
              lyricsFitMsg = `Listening… ${Math.round(ev.ratio * 100)}%`
            } else if (ev.type === 'log') {
              const msg = userFacingTranscriptionLog(ev.msg)
              if (msg) lyricsFitMsg = msg
            } else if (ev.type === 'state' && ev.state === 'queued') {
              // The sidecar runs one heavy job at a time — be honest that
              // we're behind stem prep instead of pretending to listen.
              lyricsFitMsg = 'Waiting for other audio work to finish (stems in progress)…'
            } else if (ev.type === 'state' && ev.state === 'running') {
              lyricsFitMsg = src.usedStem ? 'Listening to the vocal track…' : 'Listening to the song…'
            } else if (ev.type === 'done') {
              disconnect()
              resolve(ev.words ?? [])
            } else if (ev.type === 'error') {
              disconnect()
              reject(new Error(ev.msg || 'Transcription failed.'))
            } else if (ev.type === 'state' && (ev.state === 'error' || ev.state === 'cancelled')) {
              disconnect()
              reject(new Error('Transcription did not finish.'))
            }
          },
          (err) => reject(err),
        )
      })

      // 3. Align imported lyrics against the recognized words.
      lyricsFitMsg = 'Fitting the words…'
      const tokens = tokenizeLyrics(sourceText)
      const { words: timed, matchedRatio, matchedRows, totalRows } =
        alignLyricsToTranscription(tokens, words)
      if (matchedRatio === 0) {
        lyricsFitErr = 'Could not match the lyrics to this recording.'
        return
      }
      const p = patchSongMap((m) => ({
        ...m,
        lyrics: {
          words: timed,
          sourceText,
          alignedAt: new Date().toISOString(),
          transcriberVersion: 4,
        },
      }))
      if (!p.ok) {
        lyricsFitErr = p.errors.join('; ')
        return
      }
      lyricsMatchedPct = Math.round(matchedRatio * 100)
      lyricsMatchedRows = matchedRows
      lyricsTotalRows = totalRows
      lyricsFitMsg = ''
    } catch (e) {
      lyricsFitErr = e instanceof Error ? e.message : String(e)
    } finally {
      lyricsFitBusy = false
      if (lyricsFitErr) lyricsFitMsg = ''
    }
  }

  /** Aligned lines (index + first-word time) for the nudge list. */
  const lyricsAlignedLines = $derived.by(() => {
    const words = $songMap?.lyrics?.words ?? []
    if (words.length === 0) return []
    const byLine = new Map<number, { line: number; text: string[]; startSec: number }>()
    for (const w of words) {
      const cur = byLine.get(w.line)
      if (cur) {
        cur.text.push(w.text)
        cur.startSec = Math.min(cur.startSec, w.startSec)
      } else {
        byLine.set(w.line, { line: w.line, text: [w.text], startSec: w.startSec })
      }
    }
    return [...byLine.values()]
      .sort((a, b) => a.line - b.line)
      .map((l) => ({ line: l.line, text: l.text.join(' '), startSec: l.startSec }))
  })

  /** Shift one line's words by ±deltaSec (manual fix-up for a misfit line). */
  function nudgeLyricsLine(line: number, deltaSec: number) {
    const p = patchSongMap((m) => {
      if (!m.lyrics) return m
      const lineWords = m.lyrics.words.filter((w) => w.line === line)
      if (lineWords.length === 0) return m
      // Clamp so the line's earliest word never goes below 0.
      const minStart = Math.min(...lineWords.map((w) => w.startSec))
      const d = Math.max(deltaSec, -minStart)
      return {
        ...m,
        lyrics: {
          ...m.lyrics,
          words: m.lyrics.words.map((w) =>
            w.line === line ? { ...w, startSec: w.startSec + d, endSec: w.endSec + d } : w,
          ),
        },
      }
    })
    if (!p.ok) lyricsFitErr = p.errors.join('; ')
  }
</script>

<section class="w-full" aria-label="Lyrics">
  <EditSectionToolbar
    title="Lyrics"
    helpText={`Lyrics belong to the CURRENT draft (“${activeDraftLabel || '—'}”) — “Save lyrics” stores the text ON THIS DRAFT (no new draft) and replaces that draft's lyrics. Timing each word to the audio is a SEPARATE, optional step — press “Fit to song” only when you want it (needs BarBro Desktop). So you can import lyrics now and fit them later. Chord-sheet lines are stripped here; import chords from the Chords tab.`}
  >
    {#snippet primary()}
      <span class="text-muted-foreground">
        draft <span class="text-foreground font-bold">{activeDraftLabel || '—'}</span>
      </span>
      <span class="font-mono tabular-nums">
        {lyricsCleanedPreview.lines.length} cleaned line{lyricsCleanedPreview.lines.length === 1 ? '' : 's'}
      </span>
      {#if lyricsSaved?.words.length}
        <span class="font-mono tabular-nums">{lyricsSaved.words.length} timed words</span>
      {:else if lyricsSaved}
        <span class="text-muted-foreground">Saved, not fitted yet</span>
      {:else}
        <span class="text-muted-foreground">Not saved yet</span>
      {/if}
      {#if lyricsSaveMsg && !lyricsFitBusy}
        <span class="text-muted-foreground" role="status">{lyricsSaveMsg}</span>
      {/if}
    {/snippet}
    {#snippet actions()}
      <button
        type="button"
        class="border-foreground hover:bg-foreground hover:text-background disabled:opacity-40 border-2 px-3 py-1 text-xs font-bold"
        onclick={saveLyrics}
        disabled={lyricsDraftMatchesSaved && !!lyricsSaved}
        title={`Store this text on the current draft (“${activeDraftLabel || '—'}”). Replaces that draft's lyrics; does NOT fit — that's the separate button.`}
      >
        Save lyrics
      </button>
      <button
        type="button"
        class="border-foreground bg-foreground text-background hover:bg-foreground/85 disabled:opacity-40 border-2 px-3 py-1 text-xs font-bold"
        onclick={() => void fitLyricsToSong()}
        disabled={lyricsFitBusy || !lyricsSaved?.sourceText || !lyricsDraftMatchesSaved || !$desktopCompanionStatus.reachable}
        title={!$desktopCompanionStatus.reachable
          ? 'BarBro Desktop must be running.'
          : !lyricsDraftMatchesSaved
            ? 'Save the lyrics first.'
            : 'Listen to the song and time every word'}
      >
        {lyricsFitBusy ? 'Fitting...' : lyricsSaved?.words.length ? 'Fit to song again' : 'Fit to song'}
      </button>
    {/snippet}
  </EditSectionToolbar>
  <div class="grid gap-4 md:grid-cols-2">
    <div class="flex flex-col gap-2">
      <label class="text-muted-foreground text-xs font-medium uppercase tracking-wide" for="lyrics-paste">
        Paste lyrics
      </label>
      <textarea
        id="lyrics-paste"
        bind:value={lyricsDraft}
        onfocus={() => (lyricsFocused = true)}
        onblur={() => (lyricsFocused = false)}
        rows="18"
        placeholder={'Paste the full lyrics here…\n\nSection markers like [Chorus] or (Verse 2) are removed automatically.'}
        class="border-foreground/20 bg-background min-h-[24rem] w-full resize-y border px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none"
        spellcheck="false"
      ></textarea>
      {#if lyricsFitBusy && lyricsFitMsg}
        <p class="text-muted-foreground text-xs" role="status">✨ {lyricsFitMsg}</p>
      {/if}
      {#if lyricsFitErr}
        <p class="text-destructive text-xs">{lyricsFitErr}</p>
      {/if}
      {#if lyricsMatchedPct !== null}
        {@const rowPct = lyricsTotalRows > 0 ? Math.round((lyricsMatchedRows / lyricsTotalRows) * 100) : 0}
        <p class="text-xs {rowPct < 40 ? 'text-amber-600' : 'text-muted-foreground'}">
          Placed {lyricsMatchedRows} of {lyricsTotalRows} lines from the recording
          ({lyricsMatchedPct}% of words){rowPct < 40
            ? ' — that looks rough. Splitting stems first usually helps a lot.'
            : '. Lines it couldn’t hear are placed by their neighbors.'}
        </p>
      {/if}
      {#if lyricsSaved && lyricsSaved.words.length > 0 && !lyricsDraftMatchesSaved}
        <p class="text-amber-600 text-xs">
          Changing the words clears the current timing — run “Fit to song” again after saving.
        </p>
      {/if}

      <!-- Import a vocals source — for instrumental/backing tracks whose
           separated vocal stem is empty, so Fit has nothing to hear. -->
      {#if $desktopCompanionStatus.reachable}
        <div class="border-foreground/15 bg-muted/20 mt-1 border p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-black uppercase tracking-wide">
                {vocalStemEmpty ? 'No vocals to transcribe' : 'Vocals too quiet or missing?'}
              </p>
              <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
                {vocalStemEmpty
                  ? 'This looks like an instrumental — there are no vocals for “Fit to song” to hear.'
                  : 'If Fit can’t hear the singing,'}
                Upload a version of this exact song <strong>with vocals</strong>. BarBro checks it’s the
                same recording, lines it up, pulls a clean vocal stem, and fits your lyrics.
              </p>
            </div>
            <button
              type="button"
              class="border-foreground bg-foreground text-background hover:bg-foreground/85 disabled:opacity-40 shrink-0 border-2 px-3 py-1 text-xs font-bold"
              onclick={() => void pickAndImportVocals()}
              disabled={vocalImportBusy}
            >
              {vocalImportBusy ? 'Working…' : 'Add vocals source'}
            </button>
          </div>
          {#if vocalImportBusy && vocalImportMsg}
            <p class="text-muted-foreground mt-2 text-xs" role="status">✨ {vocalImportMsg}</p>
          {/if}
          {#if vocalImportErr}
            <p class="text-destructive mt-2 text-xs">{vocalImportErr}</p>
          {/if}
          {#if vocalImportConfirm}
            <div class="border-amber-500/40 bg-amber-500/10 mt-2 border p-2">
              <p class="text-xs font-bold text-amber-700">This might not be the same recording:</p>
              <ul class="text-amber-700 mt-1 list-disc pl-4 text-xs">
                {#each vocalImportConfirm.verdict.reasons as reason (reason)}
                  <li>{reason}</li>
                {/each}
              </ul>
              <p class="text-muted-foreground mt-1 font-mono text-[11px] tabular-nums">
                offset {vocalImportConfirm.verdict.alignment.offsetSec.toFixed(2)}s · match
                {Math.round(vocalImportConfirm.verdict.alignment.confidence * 100)}% · drift
                {Math.round(vocalImportConfirm.verdict.alignment.driftSec * 1000)}ms
              </p>
              <div class="mt-2 flex gap-2">
                <button
                  type="button"
                  class="border-foreground bg-foreground text-background hover:bg-foreground/85 border-2 px-3 py-1 text-xs font-bold"
                  onclick={() => {
                    const u = vocalImportConfirm!.uploadAbs
                    vocalImportConfirm = null
                    void runVocalImport(u, true)
                  }}
                >
                  Use it anyway
                </button>
                <button
                  type="button"
                  class="border-foreground/50 hover:bg-muted border-2 px-3 py-1 text-xs font-bold"
                  onclick={() => (vocalImportConfirm = null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      {#if sheetParsed.chordCount > 0}
        <p class="text-muted-foreground text-xs" role="status">
          🎸 Looks like a chord sheet — the chord lines are stripped here, only the
          words are saved. To place the chords, paste the sheet in the
          <strong>Chords</strong> tab under “Import chord sheet”.
        </p>
      {/if}
    </div>

    <div class="flex min-w-0 flex-col gap-2">
      <span class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        Cleaned preview · {lyricsCleanedPreview.lines.length} line{lyricsCleanedPreview.lines.length === 1 ? '' : 's'}
      </span>
      <div class="border-foreground/12 bg-muted/25 min-h-[24rem] overflow-auto border px-3 py-2">
        {#if lyricsCleanedPreview.text}
          {#each lyricsCleanedPreview.text.split('\n') as line, i (i)}
            {#if line}
              <p class="text-sm leading-relaxed">{line}</p>
            {:else}
              <div class="h-3"></div>
            {/if}
          {/each}
        {:else}
          <p class="text-muted-foreground text-sm italic">Nothing yet — paste lyrics on the left.</p>
        {/if}
      </div>
      <p class="text-muted-foreground text-xs">
        {#if lyricsSaved?.words.length}
          Fitted to the song ({lyricsSaved.words.length} timed words).
        {:else if lyricsSaved}
          Saved — not fitted to the song yet.
        {:else}
          Lyrics are shown in playback mode once saved and fitted to the song.
        {/if}
      </p>

      {#if lyricsAlignedLines.length > 0}
        <div class="border-foreground/20 flex flex-col border-t pt-2">
          <span class="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wider">
            Timing · nudge a line if it sits early/late
          </span>
          <div class="max-h-64 overflow-auto">
            {#each lyricsAlignedLines as l (l.line)}
              <div class="flex items-center gap-2 py-0.5 text-xs">
                <span class="text-muted-foreground w-12 shrink-0 text-right font-mono tabular-nums">
                  {Math.floor(l.startSec / 60)}:{String(Math.floor(l.startSec % 60)).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  class="border-foreground/40 hover:border-foreground border px-1.5 font-mono leading-4"
                  onclick={() => nudgeLyricsLine(l.line, -0.25)}
                  title="Earlier (−0.25 s)"
                  aria-label={`Line ${l.line + 1} earlier`}
                >
                  −
                </button>
                <button
                  type="button"
                  class="border-foreground/40 hover:border-foreground border px-1.5 font-mono leading-4"
                  onclick={() => nudgeLyricsLine(l.line, 0.25)}
                  title="Later (+0.25 s)"
                  aria-label={`Line ${l.line + 1} later`}
                >
                  +
                </button>
                <span class="min-w-0 truncate">{l.text}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</section>
