<script lang="ts">
  import { project, type ProjectSongMetadataLite } from '$lib/stores/project'
  import { formatSongKeyLabel } from '$lib/chords/diatonic'
  import {
    Cloud,
    GripVertical,
    ListPlus,
    Play,
    RefreshCw,
    Settings,
    Share2,
    SlidersHorizontal,
  } from '@lucide/svelte'

  type VariantId =
    | 'segment-pill'
    | 'block-strip'
    | 'dot-rail'
    | 'notch-meter'
    | 'verdict-chip'
    | 'pipeline-meter'
    | 'fader-bank'
    | 'ledger-text'
  type SongStatus = 'ready' | 'pending' | 'missing'
  type StemKey = 'audio' | 'drums' | 'bass' | 'guitar' | 'vocals' | 'fx' | 'cue'
  type StemState = 'ready' | 'queued' | 'missing'
  type GroupedStemKey = 'drums' | 'bass' | 'guitar' | 'vocals' | 'fx'

  type StyleVariant = {
    id: VariantId
    name: string
  }

  type LabSong = {
    id: string
    title: string
    artist: string
    key: string
    bpm: string
    duration: string
    durationSec?: number
    status: SongStatus
    hidden?: boolean
    lights: Record<StemKey, StemState>
  }

  const variants: StyleVariant[] = [
    {
      id: 'segment-pill',
      name: 'Connected pill',
    },
    {
      id: 'block-strip',
      name: 'Marker blocks',
    },
    {
      id: 'dot-rail',
      name: 'Lamp rail',
    },
    {
      id: 'notch-meter',
      name: 'Notch meter',
    },
    {
      id: 'verdict-chip',
      name: 'One verdict',
    },
    {
      id: 'pipeline-meter',
      name: 'Pipeline',
    },
    {
      id: 'fader-bank',
      name: 'Fader bank',
    },
    {
      id: 'ledger-text',
      name: 'Ledger',
    },
  ]

  /** Variants that replace the three light cells with ONE consolidated cell. */
  const CONSOLIDATED_VARIANTS: VariantId[] = [
    'verdict-chip',
    'pipeline-meter',
    'fader-bank',
    'ledger-text',
  ]

  const groupedStemColumns: { key: GroupedStemKey; label: string; title: string }[] = [
    { key: 'drums', label: 'D', title: 'Drums' },
    { key: 'bass', label: 'B', title: 'Bass' },
    { key: 'guitar', label: 'G', title: 'Guitar / Other' },
    { key: 'vocals', label: 'V', title: 'Vocals' },
    { key: 'fx', label: 'O', title: 'Other / FX' },
  ]

  const mockSongs: LabSong[] = [
    {
      id: 'mock-1',
      title: 'Tur att vi lever samtidigt',
      artist: 'Maja Francis',
      key: 'D major',
      bpm: '116',
      duration: '3:41',
      durationSec: 221,
      status: 'ready',
      lights: {
        audio: 'ready',
        drums: 'ready',
        bass: 'ready',
        guitar: 'queued',
        vocals: 'ready',
        fx: 'missing',
        cue: 'ready',
      },
    },
    {
      id: 'mock-2',
      title: 'Glass Floor Waltz',
      artist: '',
      key: 'Bb major',
      bpm: '92',
      duration: '4:18',
      durationSec: 258,
      status: 'pending',
      lights: {
        audio: 'ready',
        drums: 'queued',
        bass: 'ready',
        guitar: 'missing',
        vocals: 'missing',
        fx: 'ready',
        cue: 'missing',
      },
    },
    {
      id: 'mock-3',
      title: 'Pocket Thunder',
      artist: 'BarBro House Band',
      key: 'F# minor',
      bpm: '138',
      duration: '3:06',
      durationSec: 186,
      status: 'ready',
      lights: {
        audio: 'ready',
        drums: 'ready',
        bass: 'ready',
        guitar: 'ready',
        vocals: 'ready',
        fx: 'ready',
        cue: 'queued',
      },
    },
    {
      id: 'mock-4',
      title: 'Quiet Machine',
      artist: 'Sofia R.',
      key: 'No key',
      bpm: '—',
      duration: 'No duration',
      status: 'missing',
      lights: {
        audio: 'missing',
        drums: 'missing',
        bass: 'missing',
        guitar: 'missing',
        vocals: 'missing',
        fx: 'missing',
        cue: 'missing',
      },
    },
  ]

  let activeVariant = $state<VariantId>('segment-pill')
  const variant = $derived(variants.find((v) => v.id === activeVariant) ?? variants[0])
  const consolidated = $derived(CONSOLIDATED_VARIANTS.includes(activeVariant))

  /**
   * One honest sentence per song instead of seven lamps. The question a
   * bandleader actually asks is "can we play this tonight?" — everything
   * else is detail.
   */
  type SongSummary = {
    /** Big word: what state is this song in. */
    verdict: string
    tone: 'ready' | 'working' | 'blocked'
    /** Short trailing detail, e.g. "splitting guitar" / "no cue yet". */
    detail: string
    stemsReady: number
    anythingQueued: boolean
    /** Pipeline milestones in order. */
    steps: { label: string; state: StemState }[]
  }

  function summarize(song: LabSong): SongSummary {
    const stemStates = groupedStemColumns.map((c) => ({ key: c.key, state: song.lights[c.key] }))
    const stemsReady = stemStates.filter((s) => s.state === 'ready').length
    const queuedStems = stemStates.filter((s) => s.state === 'queued').map((s) => s.key)
    const anythingQueued = queuedStems.length > 0 || song.lights.cue === 'queued'

    const stemsStepState: StemState =
      stemsReady === stemStates.length ? 'ready' : stemsReady > 0 || queuedStems.length > 0 ? 'queued' : 'missing'
    const steps: SongSummary['steps'] = [
      { label: 'Audio', state: song.lights.audio },
      { label: 'Grid', state: song.status === 'ready' ? 'ready' : song.status === 'pending' ? 'queued' : 'missing' },
      { label: 'Stems', state: stemsStepState },
      { label: 'Cue', state: song.lights.cue },
    ]

    if (song.lights.audio !== 'ready') {
      return { verdict: 'Needs audio', tone: 'blocked', detail: 'add or import audio', stemsReady, anythingQueued, steps }
    }
    if (song.status !== 'ready') {
      return { verdict: 'Not analyzed', tone: 'blocked', detail: 'open to detect the grid', stemsReady, anythingQueued, steps }
    }
    if (stemsReady === stemStates.length && song.lights.cue === 'ready') {
      return { verdict: 'Stage-ready', tone: 'ready', detail: '', stemsReady, anythingQueued, steps }
    }
    if (anythingQueued) {
      const working = [...queuedStems, ...(song.lights.cue === 'queued' ? ['cue'] : [])]
      return {
        verdict: 'Preparing…',
        tone: 'working',
        detail: working.join(', '),
        stemsReady,
        anythingQueued,
        steps,
      }
    }
    const missingBits = [
      ...stemStates.filter((s) => s.state === 'missing').map((s) => s.key),
      ...(song.lights.cue === 'missing' ? ['cue'] : []),
    ]
    return {
      verdict: `Stems ${stemsReady}/5`,
      tone: 'working',
      detail: missingBits.length > 0 ? `no ${missingBits.join(', ')}` : '',
      stemsReady,
      anythingQueued,
      steps,
    }
  }

  /** Bars for the fader-bank variant: audio + 5 stems + cue, left to right. */
  function faderStates(song: LabSong): { key: string; label: string; state: StemState }[] {
    return [
      { key: 'audio', label: 'A', state: song.lights.audio },
      ...groupedStemColumns.map((c) => ({ key: c.key, label: c.label, state: song.lights[c.key] })),
      { key: 'cue', label: 'C', state: song.lights.cue },
    ]
  }

  /** Ledger line for the typography-only variant. */
  function ledgerLine(song: LabSong): string {
    const s = summarize(song)
    const mark = (st: StemState) => (st === 'ready' ? '✓' : st === 'queued' ? '…' : '—')
    return `aud ${mark(song.lights.audio)}  grid ${mark(s.steps[1]!.state)}  stems ${s.stemsReady}/5  cue ${mark(song.lights.cue)}`
  }

  function pathLabel(p: string): string {
    const ix = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
    return ix === -1 ? p : p.slice(ix + 1)
  }

  function formatDuration(sec: number | undefined): string {
    if (!(typeof sec === 'number' && Number.isFinite(sec) && sec > 0)) return 'No duration'
    const rounded = Math.round(sec)
    const minutes = Math.floor(rounded / 60)
    const seconds = rounded % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  function keyLabel(meta: ProjectSongMetadataLite | undefined): string {
    const key = meta?.keyDetail ?? meta?.detectedKey
    return key ? formatSongKeyLabel(key) : 'No key'
  }

  function stemReady(meta: ProjectSongMetadataLite | undefined, names: string[]): StemState {
    const refs = meta?.stemRefs ?? {}
    if (names.some((name) => refs[name])) return 'ready'
    const files = Object.values(meta?.stemsByPreset ?? {}).flat()
    if (
      files.some((file) =>
        names.some((name) => file.toLowerCase().includes(name.toLowerCase())),
      )
    ) {
      return 'ready'
    }
    return meta?.hasAudio ? 'queued' : 'missing'
  }

  function lightsFor(meta: ProjectSongMetadataLite | undefined): Record<StemKey, StemState> {
    return {
      audio: meta?.hasAudio ? 'ready' : 'missing',
      drums: stemReady(meta, ['Drums', 'drums']),
      bass: stemReady(meta, ['Bass', 'bass']),
      guitar: stemReady(meta, ['Guitar', 'guitar', 'Other', 'other']),
      vocals: stemReady(meta, ['Vocals', 'vocals']),
      fx: stemReady(meta, ['FX', 'fx', 'Other', 'other']),
      cue: meta?.hasCueTrack ? 'ready' : meta?.hasClickTrack ? 'queued' : 'missing',
    }
  }

  function statusFor(meta: ProjectSongMetadataLite | undefined, hidden?: boolean): SongStatus {
    if (hidden || !meta?.hasAudio) return 'missing'
    return meta.analyzed ? 'ready' : 'pending'
  }

  const projectName = $derived($project.data?.name?.trim() || 'Neon Rehearsal Pack')
  const folderName = $derived($project.osPath ? pathLabel($project.osPath) : 'Debug project')

  const songs = $derived.by<LabSong[]>(() => {
    const projectFile = $project.data
    if (!projectFile?.songs.length) return mockSongs
    return projectFile.songs.map((entry) => {
      const meta = $project.metadataByFolder[entry.folder]
      return {
        id: entry.id,
        title: meta?.title?.trim() || pathLabel(entry.folder),
        artist: meta?.artist?.trim() || '',
        key: keyLabel(meta),
        bpm: typeof meta?.bpm === 'number' && Number.isFinite(meta.bpm) ? String(Math.round(meta.bpm)) : '—',
        duration: formatDuration(meta?.audioDurationSec),
        durationSec: meta?.audioDurationSec,
        status: statusFor(meta, entry.hidden),
        hidden: entry.hidden,
        lights: lightsFor(meta),
      }
    })
  })

  const stats = $derived.by(() => {
    let totalSec = 0
    let missingDuration = 0
    let audio = 0
    let analyzed = 0
    let stems = 0
    let hidden = 0
    for (const song of songs) {
      if (song.hidden) hidden += 1
      if (song.durationSec) totalSec += song.durationSec
      else missingDuration += 1
      if (song.lights.audio === 'ready') audio += 1
      if (song.status === 'ready') analyzed += 1
      if (['drums', 'bass', 'guitar', 'vocals', 'fx'].some((key) => song.lights[key as StemKey] === 'ready')) {
        stems += 1
      }
    }
    return {
      hidden,
      audio,
      analyzed,
      stems,
      duration: totalSec > 0 ? `${formatDuration(totalSec)}${missingDuration > 0 ? '+' : ''}` : 'No duration',
    }
  })
</script>

<svelte:head>
  <title>Project Style Debug - BarBro</title>
</svelte:head>

<main class={`style-lab ${activeVariant}`}>
  <nav class="variant-nav" aria-label="Project style variants">
    <div class="nav-title">
      <SlidersHorizontal size={15} />
      <span>Project style tests</span>
    </div>
    <div class="variant-buttons">
      {#each variants as option, index (option.id)}
        <button
          type="button"
          class:active={option.id === activeVariant}
          aria-pressed={option.id === activeVariant}
          onclick={() => (activeVariant = option.id)}
        >
          <span>{index + 1}</span>
          {option.name}
        </button>
      {/each}
    </div>
  </nav>

  <section class="project-title-block" aria-label="Project heading mockup">
    <div class="title-row">
      <div class="title-copy">
        <input aria-label="Project name" value={projectName} readonly />
        <div class="project-meta">
          <span>{songs.length} song{songs.length === 1 ? '' : 's'}</span>
          <span>· {stats.duration} set</span>
          <span>· {folderName}</span>
        </div>
      </div>

      <div class="toolbar" aria-label="Project actions">
        <button type="button" class="primary">
          <ListPlus size={15} />
          Add song
        </button>
        <button type="button">
          <Play size={15} />
          Live
        </button>
        <button type="button">
          <Settings size={15} />
          Settings
        </button>
        <button type="button">
          <Share2 size={15} />
          Share
        </button>
        <button type="button">
          <RefreshCw size={15} />
          Refresh
        </button>
        <button type="button" class="sync-chip">
          <Cloud size={15} />
          Synced
        </button>
      </div>
    </div>
  </section>

  <section class="song-board" aria-label="Project song list mockup">
    <div class="song-row-grid song-head" role="row">
      <span aria-hidden="true"></span>
      <span class="center">#</span>
      <span>Song</span>
      <span>Key</span>
      <span class="right">BPM</span>
      {#if consolidated}
        <span class="center column-label status-span">Status</span>
      {:else}
        <span class="center column-label">Audio</span>
        <span class="center column-label">Stems</span>
        <span class="center column-label">Cue</span>
      {/if}
      <span class="center">Set</span>
    </div>

    <ul>
      {#each songs as song, index (song.id)}
        <li
          class="song-row-grid song-row"
          class:hidden={song.hidden}
          title={`Open ${song.title}`}
        >
          <span class="drag">
            <GripVertical size={16} />
          </span>
          <span class="position">{index + 1}</span>
          <div class="song-title">
            <strong>{song.title}</strong>
            {#if song.artist}
              <span>{song.artist}</span>
            {/if}
            {#if song.status !== 'ready'}
              <em>{song.status === 'missing' ? 'Needs audio' : 'Not analyzed'}</em>
            {/if}
          </div>
          <span class="key">{song.key}</span>
          <span class="bpm">{song.bpm}</span>
          {#if consolidated}
            {@const s = summarize(song)}
            <span class="status-span status-cell" title={ledgerLine(song)}>
              {#if activeVariant === 'verdict-chip'}
                <!-- One plain word answers "can we play this tonight?". -->
                <span class={`verdict ${s.tone}`}>{s.verdict}</span>
                {#if s.detail}
                  <span class="verdict-detail">{s.detail}</span>
                {/if}
              {:else if activeVariant === 'pipeline-meter'}
                <!-- The prep pipeline: Audio → Grid → Stems → Cue. -->
                <span class="pipeline" aria-label={`${song.title} progress`}>
                  {#each s.steps as step, si (step.label)}
                    <span class={`pipe-step ${step.state}`} title={`${step.label}: ${step.state}`}>
                      <i></i>
                      <em>{step.label}</em>
                    </span>
                    {#if si < s.steps.length - 1}
                      <span class={`pipe-link ${step.state === 'ready' ? 'ready' : 'idle'}`}></span>
                    {/if}
                  {/each}
                </span>
              {:else if activeVariant === 'fader-bank'}
                <!-- A tiny mixer: one fader per asset, pulled up when ready. -->
                <span class="fader-bank" aria-label={`${song.title} readiness faders`}>
                  {#each faderStates(song) as f (f.key)}
                    <span class={`fader ${f.state}`} title={`${f.key}: ${f.state}`}>
                      <i></i>
                      <em>{f.label}</em>
                    </span>
                  {/each}
                </span>
              {:else}
                <!-- Ledger: pure typography, no symbols to decode. -->
                <span class="ledger">{ledgerLine(song)}</span>
              {/if}
            </span>
          {:else}
            <span class="light-cell grouped-single" title={`Audio: ${song.lights.audio}`}>
              <span class={`light ${song.lights.audio}`}></span>
            </span>
            <span class="stem-strip" aria-label={`${song.title} stems`}>
              {#each groupedStemColumns as column (column.key)}
                <span
                  class={`stem-segment ${song.lights[column.key]}`}
                  title={`${column.title}: ${song.lights[column.key]}`}
                >
                  {column.label}
                </span>
              {/each}
            </span>
            <span class="light-cell grouped-single" title={`Cue: ${song.lights.cue}`}>
              <span class={`light ${song.lights.cue}`}></span>
            </span>
          {/if}
          <button type="button" class="row-settings" aria-label={`Settings for ${song.title}`}>
            <Settings size={16} />
          </button>
        </li>
      {/each}
    </ul>

    <footer>
      <span>{songs.length - stats.hidden} visible song{songs.length - stats.hidden === 1 ? '' : 's'}</span>
      {#if stats.hidden > 0}
        <span>· {stats.hidden} hidden</span>
      {/if}
      <span>· audio {stats.audio}/{songs.length}</span>
      <span>· analyzed {stats.analyzed}/{songs.length}</span>
      <span>· stems {stats.stems}/{songs.length}</span>
    </footer>
  </section>
</main>

<style>
  .style-lab {
    --ink: var(--studio-ink);
    --paper: var(--background);
    --panel: var(--card);
    --panel-2: var(--studio-panel);
    --muted-panel: var(--studio-muted);
    --line: var(--ink);
    --soft-line: color-mix(in oklch, var(--ink) 78%, var(--panel));
    --soft-shadow: color-mix(in oklch, var(--ink) 78%, transparent);
    --orange: var(--studio-orange);
    --done: var(--orange);
    --row-hover: color-mix(in oklch, var(--orange) 8%, white);
    --row-stripe: var(--orange);
    --inactive-dot: color-mix(in oklch, var(--ink) 14%, var(--panel));
    --queued-dot: color-mix(in oklch, var(--orange) 34%, var(--panel));
    --shadow: 3px 3px 0 var(--ink);
    --row-min: 3.75rem;
    --song-board-shadow: none;
    --board-border: 0;
    --board-bg: transparent;
    --board-radius: 0;
    --row-radius: var(--radius);
    --head-bg: transparent;
    --title-track: minmax(145px, 1fr);
    --status-grid: 34px minmax(172px, 210px) 34px;
    --pill-height: 0.72rem;
    --row-gap: 0.7rem;
    display: grid;
    gap: 1rem;
    max-width: 940px;
    margin: 0 auto;
    padding: clamp(18px, 3vw, 34px);
    color: var(--ink);
  }

  .style-lab.block-strip {
    --status-grid: 34px minmax(156px, 184px) 34px;
  }

  .style-lab.dot-rail {
    --status-grid: 30px minmax(124px, 148px) 30px;
    --pill-height: 0.66rem;
  }

  .style-lab.notch-meter {
    --status-grid: 32px minmax(140px, 164px) 32px;
    --pill-height: 0.76rem;
  }

  .variant-nav,
  .title-row,
  .toolbar,
  .variant-buttons,
  .project-meta,
  footer {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
  }

  .variant-nav {
    justify-content: space-between;
    gap: 0.75rem;
  }

  .nav-title {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.25rem;
    border: 2px solid var(--ink);
    background: var(--ink);
    color: var(--panel);
    padding: 0 0.7rem;
    font-size: 0.72rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .variant-buttons {
    justify-content: flex-end;
    gap: 0.45rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-height: 2.2rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink);
    padding: 0 0.65rem;
    font-weight: 850;
    box-shadow: none;
  }

  button:hover {
    background: var(--row-hover);
  }

  .variant-buttons button {
    min-height: 2rem;
    border: 2px solid var(--ink);
    background: var(--panel);
    font-size: 0.78rem;
  }

  .variant-buttons button span {
    display: grid;
    place-items: center;
    width: 1.15rem;
    height: 1.15rem;
    border: 1.5px solid var(--ink);
    background: var(--panel-2);
    font-size: 0.68rem;
  }

  .variant-buttons button.active {
    background: var(--orange);
  }

  .project-title-block {
    display: grid;
    gap: 0.45rem;
    padding-top: 0.35rem;
  }

  .title-row {
    justify-content: space-between;
    gap: 0.85rem;
  }

  .title-copy {
    min-width: min(32rem, 100%);
    flex: 1;
  }

  input {
    width: 100%;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--ink);
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 850;
    line-height: 1;
  }

  .project-meta,
  footer {
    gap: 0.45rem;
    color: color-mix(in oklch, var(--ink) 62%, var(--panel));
    font-size: 0.78rem;
    font-weight: 700;
  }

  .toolbar {
    justify-content: flex-end;
    gap: 0.2rem;
  }

  .toolbar .primary {
    background: transparent;
    color: var(--ink);
  }

  .sync-chip {
    color: color-mix(in oklch, var(--ink) 68%, var(--panel));
  }

  .toolbar button {
    position: relative;
    min-height: 2rem;
    padding: 0 0.45rem;
    border-radius: 0;
  }

  .toolbar button::after {
    content: "";
    position: absolute;
    right: 0.45rem;
    bottom: 0.12rem;
    left: 0.45rem;
    height: 3px;
    background: transparent;
  }

  .toolbar button.primary::after,
  .toolbar button:hover::after {
    background: var(--orange);
  }

  .song-board {
    border: var(--board-border);
    border-radius: var(--board-radius);
    background: var(--board-bg);
    box-shadow: var(--song-board-shadow);
    overflow: visible;
  }

  .song-row-grid {
    display: grid;
    grid-template-columns:
      24px 24px var(--title-track) minmax(70px, 86px) 40px var(--status-grid)
      42px;
    gap: 0.45rem;
    align-items: center;
    width: 100%;
  }

  .song-head {
    min-height: 2rem;
    border-bottom: 2px solid var(--line);
    background: var(--head-bg);
    color: var(--panel);
    padding: 0 0.55rem;
    font-size: 0.64rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .song-head {
    color: color-mix(in oklch, var(--ink) 62%, var(--panel));
    border-bottom: 0;
    padding-inline: 0.55rem;
  }

  ul {
    display: grid;
    gap: var(--row-gap);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .song-row {
    position: relative;
    min-height: var(--row-min);
    border: 2px solid var(--soft-line);
    border-radius: var(--row-radius);
    background:
      linear-gradient(90deg, var(--row-stripe) 0 7px, transparent 7px),
      var(--panel);
    padding: 0.35rem 0.55rem;
    cursor: pointer;
    box-shadow: 2px 2px 0 var(--soft-shadow);
  }

  .song-row:hover {
    background:
      linear-gradient(90deg, var(--row-stripe) 0 7px, transparent 7px),
      var(--row-hover);
    transform: translate(1px, 1px);
    box-shadow: 1px 1px 0 var(--soft-shadow);
  }

  .song-row.hidden {
    opacity: 0.58;
  }

  .drag,
  .position,
  .light-cell,
  .center {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .drag,
  .position,
  .key,
  .bpm {
    color: color-mix(in oklch, var(--ink) 58%, var(--panel));
  }

  .position,
  .key,
  .bpm {
    font-family: var(--font-mono);
    font-size: 0.74rem;
  }

  .right,
  .bpm {
    text-align: right;
    justify-content: flex-end;
  }

  .column-label {
    min-width: 0;
  }

  .song-title {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.45rem;
    overflow: hidden;
  }

  .song-title strong,
  .song-title span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .song-title strong {
    flex: 0 1 auto;
    font-size: 0.92rem;
  }

  .song-title span {
    flex: 1 2 8rem;
    color: color-mix(in oklch, var(--ink) 55%, var(--panel));
    font-size: 0.78rem;
    font-weight: 700;
  }

  .song-title em {
    flex: 0 0 auto;
    border: 1.5px solid var(--line);
    background: var(--panel-2);
    padding: 0.06rem 0.3rem;
    font-size: 0.58rem;
    font-style: normal;
    font-weight: 950;
    text-transform: uppercase;
  }

  .song-title strong {
    font-size: 0.94rem;
    font-weight: 850;
  }

  .light {
    display: block;
    width: 1.42rem;
    height: var(--pill-height);
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    box-shadow: none;
  }

  .light.ready {
    background: var(--done);
  }

  .light.queued {
    background: linear-gradient(90deg, var(--orange) 0 50%, transparent 50%);
  }

  .light.missing {
    opacity: 0.42;
  }

  .grouped-single .light {
    width: 1.35rem;
  }

  .stem-strip {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    align-items: stretch;
    overflow: hidden;
    height: var(--pill-height);
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    box-shadow: none;
  }

  .stem-segment {
    display: grid;
    min-width: 0;
    place-items: center;
    border-right: 1px solid color-mix(in oklch, var(--ink) 26%, transparent);
    color: color-mix(in oklch, var(--ink) 42%, var(--panel));
    font-size: 0;
    font-weight: 900;
    line-height: 1;
  }

  .stem-segment:last-child {
    border-right: 0;
  }

  .stem-segment.ready {
    background: var(--done);
    color: var(--ink);
  }

  .stem-segment.queued {
    background: linear-gradient(
      90deg,
      color-mix(in oklch, var(--orange) 58%, var(--panel)) 0 50%,
      transparent 50%
    );
    color: var(--ink);
  }

  .stem-segment.missing {
    background: transparent;
  }

  .block-strip .light {
    width: 1.02rem;
    border-radius: 2px;
    border: 0;
    box-shadow: 1.5px 1.5px 0 var(--ink);
  }

  .block-strip .stem-strip {
    gap: 0.28rem;
    overflow: visible;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .block-strip .stem-segment {
    border-right: 0;
    border-radius: 2px;
    background: color-mix(in oklch, var(--ink) 10%, var(--panel));
    box-shadow: 1.5px 1.5px 0 var(--ink);
  }

  .block-strip .stem-segment.ready {
    background: var(--orange);
  }

  .block-strip .stem-segment.queued {
    background:
      linear-gradient(90deg, var(--orange) 0 50%, transparent 50%),
      color-mix(in oklch, var(--ink) 10%, var(--panel));
  }

  .dot-rail .light {
    width: 0.68rem;
    border: 0;
    border-radius: 999px;
    box-shadow: none;
  }

  .dot-rail .stem-strip {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.42rem;
    overflow: visible;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .dot-rail .stem-strip::before {
    content: "";
    position: absolute;
    right: 0.18rem;
    left: 0.18rem;
    top: 50%;
    height: 2px;
    background: color-mix(in oklch, var(--ink) 36%, transparent);
    transform: translateY(-50%);
  }

  .dot-rail .stem-segment {
    position: relative;
    z-index: 1;
    width: 0.68rem;
    height: 0.68rem;
    border-right: 0;
    border-radius: 999px;
    box-shadow: none;
  }

  .notch-meter .light {
    width: 1.05rem;
    border: 0;
    border-radius: 2px;
    box-shadow: none;
  }

  .notch-meter .light.missing {
    background: color-mix(in oklch, var(--panel) 70%, var(--ink));
    opacity: 1;
  }

  .notch-meter .stem-strip {
    gap: 2px;
    padding: 2px;
    border-radius: 2px;
    background: var(--ink);
    box-shadow: none;
  }

  .notch-meter .stem-segment {
    border-right: 0;
    border-radius: 1px;
    background: color-mix(in oklch, var(--panel) 70%, var(--ink));
  }

  .notch-meter .stem-segment.ready {
    background: var(--orange);
  }

  .notch-meter .stem-segment.queued {
    background: linear-gradient(
      0deg,
      var(--orange) 0 54%,
      color-mix(in oklch, var(--panel) 70%, var(--ink)) 54%
    );
  }

  .notch-meter .stem-segment.missing {
    background: color-mix(in oklch, var(--panel) 70%, var(--ink));
  }

  /* ── Consolidated status variants (5–8) ─────────────────────────────── */

  .style-lab.verdict-chip,
  .style-lab.pipeline-meter,
  .style-lab.fader-bank,
  .style-lab.ledger-text {
    --status-grid: minmax(200px, 250px);
  }

  .status-span {
    grid-column: span 1;
  }

  .status-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-width: 0;
  }

  /* 5 · One verdict — a single plain-language chip. */
  .verdict {
    flex: 0 0 auto;
    border: 2px solid var(--ink);
    padding: 0.14rem 0.5rem;
    font-size: 0.64rem;
    font-weight: 950;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .verdict.ready {
    background: var(--orange);
  }

  .verdict.working {
    background: linear-gradient(135deg, var(--orange) 0 0.55rem, var(--panel) 0.55rem);
  }

  .verdict.blocked {
    background: var(--panel);
    border-style: dashed;
    color: color-mix(in oklch, var(--ink) 66%, var(--panel));
  }

  .verdict-detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: color-mix(in oklch, var(--ink) 52%, var(--panel));
    font-size: 0.66rem;
    font-weight: 700;
  }

  /* 6 · Pipeline — milestones with links, like a subway map. */
  .pipeline {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .pipe-step {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 0.12rem;
  }

  .pipe-step i {
    display: block;
    width: 0.72rem;
    height: 0.72rem;
    border: 2px solid var(--ink);
    border-radius: 999px;
    background: var(--panel);
  }

  .pipe-step.ready i {
    background: var(--orange);
  }

  .pipe-step.queued i {
    background: linear-gradient(0deg, var(--orange) 0 50%, var(--panel) 50%);
  }

  .pipe-step.missing i {
    border-color: color-mix(in oklch, var(--ink) 38%, var(--panel));
  }

  .pipe-step em {
    font-size: 0.5rem;
    font-style: normal;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: color-mix(in oklch, var(--ink) 55%, var(--panel));
  }

  .pipe-step.missing em {
    color: color-mix(in oklch, var(--ink) 32%, var(--panel));
  }

  .pipe-link {
    flex: 1 1 0.6rem;
    height: 2px;
    min-width: 0.35rem;
    margin: 0 0.1rem 0.72rem;
    background: color-mix(in oklch, var(--ink) 30%, var(--panel));
    align-self: center;
  }

  .pipe-link.ready {
    background: var(--ink);
  }

  /* 7 · Fader bank — one tiny mixer fader per asset. */
  .fader-bank {
    display: flex;
    align-items: flex-end;
    gap: 0.34rem;
  }

  .fader {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
  }

  .fader i {
    display: block;
    width: 0.44rem;
    height: 1.15rem;
    border: 1.5px solid var(--ink);
    background:
      linear-gradient(0deg, var(--orange) 0 var(--fader-fill, 0%), transparent var(--fader-fill, 0%));
  }

  .fader.ready i {
    --fader-fill: 100%;
  }

  .fader.queued i {
    --fader-fill: 50%;
  }

  .fader.missing i {
    border-color: color-mix(in oklch, var(--ink) 36%, var(--panel));
    opacity: 0.55;
  }

  .fader em {
    font-size: 0.5rem;
    font-style: normal;
    font-weight: 900;
    color: color-mix(in oklch, var(--ink) 52%, var(--panel));
  }

  .fader.missing em {
    color: color-mix(in oklch, var(--ink) 30%, var(--panel));
  }

  /* 8 · Ledger — nothing but type. */
  .ledger {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    font-weight: 700;
    color: color-mix(in oklch, var(--ink) 68%, var(--panel));
  }

  .row-settings {
    width: 1.9rem;
    min-height: 1.9rem;
    padding: 0;
    border-color: transparent;
    background: transparent;
  }

  .row-settings:hover {
    background: var(--orange);
  }

  footer {
    min-height: 1.6rem;
    margin-top: 0.15rem;
    padding: 0 0.15rem;
    background: transparent;
    color: color-mix(in oklch, var(--ink) 50%, var(--panel));
  }

  @media (max-width: 840px) {
    .style-lab {
      padding: 1rem;
    }

    .variant-nav,
    .title-row {
      align-items: stretch;
      flex-direction: column;
    }

    .toolbar,
    .variant-buttons {
      justify-content: flex-start;
    }
  }
</style>
