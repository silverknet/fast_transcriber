<script lang="ts">
  import { browser } from '$app/environment'
  import { get } from 'svelte/store'
  import { onMount } from 'svelte'
  import { Button } from '$lib/components/ui/button'
  import { generateAbletonSetXml, STEM_TRACKS, type StemClip } from '$lib/export/abletonSet'
  import { gzipString } from '$lib/export/gzip'
  import { safeExportBasename } from '$lib/songmap/persist'
  import {
    saveFolderHandle,
    loadFolderHandle,
    ensurePermission,
    scanAudioFiles,
    readFileFromHandle,
    writeFileToHandle,
    ensureAbletonProjectFolder,
    getDirectoryHandleByPath,
  } from '$lib/client/folderHandle'
  import { songMap, patchSongMap } from '$lib/stores/songMap'
  import { SONG_ALS_FILENAME } from '$lib/project/commit'
  import { audioSession } from '$lib/stores/audioSession'
  import { desktopCompanionStatus } from '$lib/stores/desktopCompanionStatus'
  import StemSplitter from '$lib/components/StemSplitter.svelte'
  import { pickFolderViaDesktop } from '$lib/client/desktopBridge'
  import { releaseStemJob, type StemJobEntry } from '$lib/stores/stemJobs'

  // ── Folder state ────────────────────────────────────────────────────────────

  let folderHandle = $state<FileSystemDirectoryHandle | null>(null)
  let folderStatus = $state<'none' | 'loading' | 'ready' | 'no-permission'>('none')
  let folderFiles = $state<string[]>([])  // relative audio paths found in folder

  const hasFsApi = browser && typeof (window as any).showDirectoryPicker === 'function'

  /** IDB key scoped to the current song so different projects don't share a folder. */
  function folderKey(): string {
    return `projectFolder::${get(songMap)?.metadata.title ?? 'unknown'}`
  }

  /**
   * Project-mode songs flow through the StemsDialog on the project page —
   * this /set route stays standalone-only. Always returns null so the
   * per-title folder picker path runs.
   */
  async function projectSongDirHandle(): Promise<FileSystemDirectoryHandle | null> {
    return null
  }

  async function pickFolder() {
    try {
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' }) as FileSystemDirectoryHandle
      await applyFolderHandle(handle, true)
    } catch {
      // user cancelled
    }
  }

  async function applyFolderHandle(handle: FileSystemDirectoryHandle, save: boolean) {
    folderHandle = handle
    folderStatus = 'loading'
    if (save) await saveFolderHandle(folderKey(), handle)

    const files = await scanAudioFiles(handle)
    folderFiles = files

    // Save folder name hint + auto-resolve any existing stemRefs
    patchSongMap(m => ({ ...m, projectFolder: handle.name }))
    await autoResolveStemRefs()
    folderStatus = 'ready'
  }

  /**
   * Try to bind a folder for stems/.als output. In project mode, prefer the
   * song's own project subfolder. Otherwise fall back to the per-title
   * stored handle.
   */
  async function tryRestoreFolder() {
    folderStatus = 'loading'

    const projectSongDir = await projectSongDirHandle()
    if (projectSongDir) {
      // Project-mode: use the song subfolder directly. No re-permission
      // check needed — the project store already validated permission.
      await applyFolderHandle(projectSongDir, false)
      return
    }

    const handle = await loadFolderHandle(folderKey())
    if (!handle) { folderStatus = 'none'; return }
    const ok = await ensurePermission(handle)
    if (!ok) { folderStatus = 'no-permission'; return }
    await applyFolderHandle(handle, false)
  }

  // ── Stem state ──────────────────────────────────────────────────────────────

  type LoadedStem = { file: File; clip: StemClip }
  let stems = $state<Map<string, LoadedStem>>(new Map())

  async function decodeStem(file: File, relativePath: string): Promise<LoadedStem> {
    const ctx = new AudioContext()
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer())
      return {
        file,
        clip: { fileName: file.name, relativePath, durationSec: buf.duration, sampleRate: buf.sampleRate },
      }
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  async function assignStem(stemName: string, relativePath: string) {
    if (!folderHandle) return
    try {
      const file = await readFileFromHandle(folderHandle, relativePath)
      const loaded = await decodeStem(file, relativePath)
      stems = new Map(stems).set(stemName, loaded)
      // Persist the assignment in stemRefs
      patchSongMap(m => ({
        ...m,
        stemRefs: { ...m.stemRefs, [stemName]: relativePath },
      }))
    } catch (e) {
      statusMsg = `Could not load ${relativePath}`
      status = 'error'
    }
  }

  function removeStem(stemName: string) {
    const next = new Map(stems)
    next.delete(stemName)
    stems = next
    patchSongMap(m => {
      const refs = { ...m.stemRefs }
      delete refs[stemName]
      return { ...m, stemRefs: refs }
    })
  }

  /** Try to load stems that are already saved in stemRefs. */
  async function autoResolveStemRefs() {
    const sm = get(songMap)
    if (!sm?.stemRefs || !folderHandle) return
    for (const [name, relPath] of Object.entries(sm.stemRefs)) {
      if (stems.has(name)) continue  // already loaded
      try {
        const file = await readFileFromHandle(folderHandle, relPath)
        const loaded = await decodeStem(file, relPath)
        stems = new Map(stems).set(name, loaded)
      } catch {
        // file missing — will show as "not found"
      }
    }
  }

  /**
   * Known aliases per slot — covers common stem splitter output names.
   * First alias listed is the canonical/recommended name.
   */
  const STEM_ALIASES: Record<string, string[]> = {
    Drums:  ['drums', 'drum', 'kit', 'percussion', 'perc', 'beat'],
    Bass:   ['bass'],
    Guitar: ['guitar', 'guitars', 'gtr', 'keys', 'piano', 'synth', 'melodics', 'other', 'no_vocals'],
    Vocals: ['vocals', 'vocal', 'vox', 'voice', 'lead', 'lead_vocals'],
    FX:     ['fx', 'effects', 'sfx', 'other', 'extras', 'pads'],
  }

  /** Match a folder file to a stem slot using the alias table. */
  function autoMatch(stemName: string): string | undefined {
    const aliases = STEM_ALIASES[stemName] ?? [stemName.toLowerCase()]
    return folderFiles.find(f => {
      const base = f.replace(/^.*\//, '').replace(/\.[^.]+$/, '').toLowerCase()
      return aliases.some(a => base === a || base.startsWith(a + '_') || base.endsWith('_' + a))
    })
  }

  /** Canonical filename for a stem slot (e.g. "Drums" → "stems/drums.wav"). */
  function canonicalName(stemName: string): string {
    return `stems/${(STEM_ALIASES[stemName]?.[0] ?? stemName.toLowerCase())}.wav`
  }

  /** Map a Demucs output filename (e.g. `vocals.wav`) to a STEM_TRACKS slot. */
  function slotForStandaloneSet(filename: string): string | null {
    const base = filename.replace(/\.[^.]+$/, '').toLowerCase()
    const direct: Record<string, string> = {
      vocals: 'Vocals',
      drums: 'Drums',
      bass: 'Bass',
      other: 'Guitar',
      guitar: 'Guitar',
      fx: 'FX',
    }
    return direct[base] ?? null
  }

  // ── Standalone OS path for path-based stems ───────────────────────────────
  //
  // /set's folder is picked via the browser FS Access API which doesn't expose
  // an absolute path. To use the new path-based stems flow we ask the desktop
  // sidecar to open its OWN folder picker once, kept in-memory for the
  // session (standalone /set is transient — no persistence needed).
  let standaloneOsPath = $state<string | null>(null)
  let osPathPickError = $state('')

  async function pickStandaloneOsPath() {
    osPathPickError = ''
    const r = await pickFolderViaDesktop({ title: 'Locate the stems folder on disk' })
    if (!r.ok) {
      if (!('cancelled' in r) || !r.cancelled) {
        osPathPickError = 'error' in r ? r.error : 'Could not pick folder'
      }
      return
    }
    standaloneOsPath = r.path
  }

  /**
   * Standalone-mode inputPath: there's no .smap on disk for unbound songs,
   * so the user would need to first save the song into the picked folder
   * for stems to work. For now we expect `song.smap` to live at the root
   * of the picked OS path; the legacy "Save Song (.smap)" flow needs to
   * be aligned with that. Until that's wired, splits won't work in /set
   * without a manual .smap in place.
   */
  const standaloneInputPath = $derived(
    standaloneOsPath ? `${standaloneOsPath}/song.smap` : null,
  )
  const standaloneOutputDir = $derived(
    standaloneOsPath ? `${standaloneOsPath}/stems` : null,
  )

  /**
   * In standalone /set mode the sidecar wrote the stems directly into
   * `<standaloneOsPath>/stems/<filename>` (path-based flow — no audio
   * bytes over HTTP). The web side only needs to refresh the in-memory
   * folder listing + the .smap stemRefs.
   */
  async function finalizeStemsForStandaloneSet(job: StemJobEntry) {
    if (!folderHandle) return
    // Auto-bind matching stem refs in the loaded songMap so /set's slot
    // list immediately reflects the new files.
    const newRefs: Record<string, string> = {}
    for (const filename of job.files) {
      const slot = slotForStandaloneSet(filename)
      if (slot) newRefs[slot] = `stems/${filename}`
    }
    if (Object.keys(newRefs).length > 0) {
      patchSongMap((m) => ({ ...m, stemRefs: { ...m.stemRefs, ...newRefs } }))
    }
    await releaseStemJob(job.jobId)
    folderFiles = await scanAudioFiles(folderHandle)
    await autoResolveStemRefs()
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  let status = $state<'idle' | 'generating' | 'done' | 'error'>('idle')
  let statusMsg = $state('')
  let lastXml = $state<string | null>(null)
  let showXml = $state(false)

  async function exportAbletonSet() {
    if (!browser) return
    const sm = get(songMap)
    if (!sm) { statusMsg = 'No song loaded.'; status = 'error'; return }

    status = 'generating'
    statusMsg = 'Building .als XML…'

    try {
      const stemClips = new Map<string, StemClip>()
      for (const [name, s] of stems) stemClips.set(name, s.clip)

      const xml = generateAbletonSetXml(sm, { title: sm.metadata.title, stems: stemClips })
      lastXml = xml
      statusMsg = 'Compressing (gzip)…'
      const blob = await gzipString(xml)
      // Standalone mode only — project songs export via the project page
      // (.als export there moves to a sidecar endpoint in a follow-up).
      const alsName = `${safeExportBasename(sm.metadata.title)}.als`

      if (folderHandle) {
        // Mark folder as an Ableton Live Project so RelativePath audio refs resolve
        await ensureAbletonProjectFolder(folderHandle)
        // Write directly into the project folder
        await writeFileToHandle(folderHandle, alsName, blob)
        status = 'done'
        statusMsg = `Saved ${alsName} to project folder "${folderHandle.name}"`
      } else {
        // Fallback: browser download
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = alsName; a.click()
        URL.revokeObjectURL(url)
        status = 'done'
        statusMsg = `Downloaded ${alsName} — place it in the same folder as your stems.`
      }
    } catch (e) {
      status = 'error'
      statusMsg = e instanceof Error ? e.message : 'Export failed'
    }
  }

  // ── Mount ───────────────────────────────────────────────────────────────────

  import { goto } from '$app/navigation'

  onMount(() => {
    if (!browser) return
    if (!hasFsApi) return
    void tryRestoreFolder()
  })

  // ── Derived ─────────────────────────────────────────────────────────────────

  const smSnap = $derived($songMap)

  const bpm = $derived.by(() => {
    const sm = $songMap
    if (!sm) return null
    if (sm.metadata.bpm && sm.metadata.bpm > 0) return sm.metadata.bpm
    const bar = sm.timeline.bars[0]
    if (!bar || bar.beatCount <= 0) return null
    const dur = bar.endSec - bar.startSec
    return dur > 0 ? Math.round(((bar.beatCount / dur) * 60) * 100) / 100 : null
  })

  function fmtDur(sec: number) {
    const m = Math.floor(sec / 60)
    const s = (sec % 60).toFixed(1)
    return `${m}:${s.padStart(4, '0')}`
  }
</script>

<main class="relative z-10 flex min-h-dvh w-full flex-col gap-6 px-4 py-16 sm:px-6 md:px-8 md:py-20">
  <div class="mx-auto w-full max-w-2xl space-y-6">

    <div class="border-foreground border-b-2 pb-4">
      <h1 class="text-2xl font-bold tracking-tight">Set</h1>
      <p class="text-muted-foreground mt-1 text-xs">Ableton Live 12 · experimental</p>
    </div>

    {#if !smSnap}
      <div class="border-foreground bg-muted border-2 p-4">
        <p class="text-sm">No song loaded. Open a project in the <a href="/edit" class="underline underline-offset-2">editor</a> first.</p>
      </div>
    {:else}

      <!-- Song summary -->
      <section class="border-foreground border-2 p-4 space-y-2">
        <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Song</h2>
        <dl class="text-sm space-y-1 font-mono">
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Title</dt>
            <dd>{smSnap.metadata.title}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">BPM</dt>
            <dd>{bpm != null ? bpm.toFixed(2) : '—'}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Bars / Sections</dt>
            <dd>{smSnap.timeline.bars.length} bars · {smSnap.sections.length} sections</dd>
          </div>
        </dl>
      </section>

      <!-- Project folder -->
      <section class="border-foreground border-2 p-4 space-y-3">
        <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Project Folder</h2>

        {#if !hasFsApi}
          <p class="text-muted-foreground text-xs">File System Access API not available in this browser. Use Chrome or Edge for folder integration.</p>
        {:else if folderStatus === 'loading'}
          <p class="text-muted-foreground text-xs animate-pulse">Restoring folder access…</p>
        {:else if folderStatus === 'ready' && folderHandle}
          <div class="flex items-center gap-3">
            <span class="text-emerald-600 dark:text-emerald-400 text-xs">✓</span>
            <span class="font-mono text-sm flex-1">{folderHandle.name}</span>
            <Button class="" variant="outline" size="sm" onclick={() => void pickFolder()}>Change</Button>
          </div>
          <p class="text-muted-foreground text-xs">{folderFiles.length} audio file{folderFiles.length !== 1 ? 's' : ''} found</p>
        {:else if folderStatus === 'no-permission'}
          <p class="text-muted-foreground text-xs">
            Last folder: <span class="font-mono">{smSnap.projectFolder ?? '—'}</span> — permission needed.
          </p>
          <Button class="" variant="outline" size="sm" onclick={() => void pickFolder()}>Re-grant access</Button>
        {:else}
          {#if smSnap.projectFolder}
            <p class="text-muted-foreground text-xs">
              Last folder: <span class="font-mono text-foreground/60">{smSnap.projectFolder}</span> — not found on this machine.
            </p>
          {/if}
          <Button
            class=""
            onclick={() => void pickFolder()}
            title="Choose the folder with your audio/stems. The .als is written there when you export."
          >
            Pick project folder
          </Button>
        {/if}
      </section>

      <!-- Stem Splitter (desktop sidecar, path-based) -->
      {#if !standaloneOsPath && $desktopCompanionStatus.reachable}
        <section class="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 border-2 px-4 py-3 space-y-2">
          <p class="text-xs">
            <span class="font-semibold">Stems need a disk path.</span>
            The desktop sidecar reads/writes the project folder directly. Locate it once.
          </p>
          <Button class="" variant="default" size="sm" onclick={() => void pickStandaloneOsPath()}>
            Locate folder on disk…
          </Button>
          {#if osPathPickError}
            <p class="text-destructive text-xs" role="status">{osPathPickError}</p>
          {/if}
        </section>
      {/if}
      <StemSplitter
        songId="standalone"
        inputPath={standaloneInputPath}
        outputDir={standaloneOutputDir}
        inputLabel={null}
        desktopReachable={$desktopCompanionStatus.reachable}
        finalizeJob={(job) => finalizeStemsForStandaloneSet(job)}
      />

      <!-- Stem slots -->
      <section class="border-foreground border-2 p-4 space-y-3">
        <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stems</h2>

        <ul class="space-y-2">
          {#each STEM_TRACKS as track (track.name)}
            {@const loaded = stems.get(track.name)}
            {@const savedRef = smSnap.stemRefs?.[track.name]}
            {@const suggested = !loaded && folderStatus === 'ready' ? autoMatch(track.name) : undefined}

            <li class="border-foreground border px-3 py-2">
              <div class="flex items-center gap-3 text-sm">
                <span class="w-16 shrink-0 font-medium">{track.name}</span>

                {#if loaded}
                  <span class="text-foreground/80 min-w-0 flex-1 truncate font-mono text-xs">{loaded.clip.relativePath}</span>
                  <span class="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">{fmtDur(loaded.clip.durationSec)}</span>
                  <button type="button" class="text-muted-foreground hover:text-destructive text-xs shrink-0" onclick={() => removeStem(track.name)}>✕</button>

                {:else if savedRef && folderStatus !== 'ready'}
                  <!-- Saved but folder not accessible -->
                  <span class="text-muted-foreground/60 font-mono text-xs flex-1">{savedRef}</span>
                  <span class="text-amber-500 text-xs shrink-0">not found</span>

                {:else if folderStatus === 'ready'}
                  <!-- Folder available — show dropdown -->
                  <select
                    class="border-foreground/30 bg-background text-foreground flex-1 border px-2 py-0.5 font-mono text-xs"
                    onchange={(e) => { const v = e.currentTarget.value; if (v) void assignStem(track.name, v) }}
                    value=""
                  >
                    <option value="">— assign from folder —</option>
                    {#if suggested}
                      <option value={suggested}>⚡ {suggested}</option>
                    {/if}
                    {#each folderFiles as f (f)}
                      {#if f !== suggested}
                        <option value={f}>{f}</option>
                      {/if}
                    {/each}
                  </select>

                {:else}
                  <span class="text-muted-foreground/50 font-mono text-xs flex-1">{canonicalName(track.name)}</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>

        {#if stems.size > 0}
          <p class="text-muted-foreground text-xs">{stems.size} of {STEM_TRACKS.length} stems loaded</p>
        {/if}
      </section>

      <!-- Sections locators -->
      {#if smSnap.sections.length > 0}
        <section class="border-foreground border-2 p-4 space-y-2">
          <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sections → Locators</h2>
          <ul class="text-sm space-y-1 font-mono">
            {#each smSnap.sections as s (s.id)}
              <li class="flex gap-3">
                <span class="text-muted-foreground w-24 shrink-0">bar {s.barRange.startBarIndex}–{s.barRange.endBarIndex}</span>
                <span>{s.label}</span>
                <span class="text-muted-foreground ml-auto text-xs">{s.kind}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Export -->
      <section class="border-foreground border-2 p-4 space-y-3">
        <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Export</h2>
        <div class="flex flex-wrap gap-3 items-center">
          <Button class="" onclick={() => void exportAbletonSet()} disabled={status === 'generating'}>
            {status === 'generating' ? 'Generating…' : folderHandle ? `Save .als to "${folderHandle.name}"` : 'Download .als'}
          </Button>
          {#if lastXml}
            <Button class="" variant="outline" size="sm" onclick={() => (showXml = !showXml)}>
              {showXml ? 'Hide XML' : 'Inspect XML'}
            </Button>
          {/if}
        </div>
        {#if statusMsg}
          <p class="text-xs {status === 'error' ? 'text-destructive' : status === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}" role="status">
            {statusMsg}
          </p>
        {/if}
      </section>

      {#if showXml && lastXml}
        <section class="border-foreground border-2 p-4 space-y-2">
          <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">XML ({(lastXml.length / 1024).toFixed(1)} KB)</h2>
          <pre class="border-foreground/10 bg-muted/20 text-foreground/90 max-h-[40vh] overflow-auto rounded border p-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words">{lastXml}</pre>
        </section>
      {/if}
    {/if}
  </div>
</main>
