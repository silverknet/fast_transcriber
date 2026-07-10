<script lang="ts">
  import {
    Activity,
    ArrowDownUp,
    Bell,
    CircleCheck,
    Cloud,
    Download,
    FolderOpen,
    Mic2,
    MoreHorizontal,
    Music2,
    Play,
    Plus,
    RefreshCw,
    Search,
    Settings,
    Share2,
    SlidersHorizontal,
    Sparkles,
    Users,
    Volume2,
    Wand2,
  } from '@lucide/svelte'

  type SongStatus = 'synced' | 'pending' | 'missing' | 'working'
  type StyleDirectionId = 'orange-rig' | 'studio-brief'
  type StemKey = 'drums' | 'bass' | 'guitar' | 'keys' | 'vox'
  type StemState = 'ready' | 'queued' | 'missing'
  type WaveformStyleId = 'blocks' | 'stepped' | 'needles'

  type MockSong = {
    id: string
    title: string
    artist: string
    bpm: number
    key: string
    duration: string
    status: SongStatus
    stems: number
    cues: string
    color: string
    accent: string
    stemLights: Record<StemKey, StemState>
  }

  type StyleDirection = {
    id: StyleDirectionId
    name: string
    tag: string
    texture: string
    color: string
  }

  type WaveformStyle = {
    id: WaveformStyleId
    name: string
  }

  type WaveformSlice = {
    id: string
    level: number
    bar: number
    beat: number
  }

  const styleDirections: StyleDirection[] = [
    {
      id: 'orange-rig',
      name: 'Orange rig',
      tag: 'Black header',
      texture: 'Graph tape',
      color: '#ff7a1a',
    },
    {
      id: 'studio-brief',
      name: 'Studio brief',
      tag: 'Focused project',
      texture: 'Quiet paper',
      color: '#ff7a1a',
    },
  ]

  const stemColumns: { key: StemKey; label: string }[] = [
    { key: 'drums', label: 'Drm' },
    { key: 'bass', label: 'Bass' },
    { key: 'guitar', label: 'Gtr' },
    { key: 'keys', label: 'Keys' },
    { key: 'vox', label: 'Vox' },
  ]

  const waveformStyles: WaveformStyle[] = [
    { id: 'blocks', name: 'Blocks' },
    { id: 'stepped', name: 'Stepped' },
    { id: 'needles', name: 'Needles' },
  ]

  const songs: MockSong[] = [
    {
      id: 's1',
      title: 'Neon Staircase',
      artist: 'The Orange Bar',
      bpm: 124,
      key: 'D minor',
      duration: '03:42',
      status: 'synced',
      stems: 4,
      cues: 'Main + drummer',
      color: 'orange',
      accent: '#ff7a1a',
      stemLights: {
        drums: 'ready',
        bass: 'ready',
        guitar: 'ready',
        keys: 'missing',
        vox: 'ready',
      },
    },
    {
      id: 's2',
      title: 'Glass Floor Waltz',
      artist: 'Maja & The Frames',
      bpm: 92,
      key: 'Bb major',
      duration: '04:18',
      status: 'working',
      stems: 2,
      cues: 'Singer',
      color: 'cyan',
      accent: '#16c7c1',
      stemLights: {
        drums: 'queued',
        bass: 'ready',
        guitar: 'missing',
        keys: 'ready',
        vox: 'missing',
      },
    },
    {
      id: 's3',
      title: 'Pocket Thunder',
      artist: 'BarBro House Band',
      bpm: 138,
      key: 'F# minor',
      duration: '03:06',
      status: 'pending',
      stems: 5,
      cues: 'Main',
      color: 'pink',
      accent: '#f04495',
      stemLights: {
        drums: 'ready',
        bass: 'ready',
        guitar: 'ready',
        keys: 'ready',
        vox: 'ready',
      },
    },
    {
      id: 's4',
      title: 'Quiet Machine',
      artist: 'Sofia R.',
      bpm: 106,
      key: 'A major',
      duration: '05:11',
      status: 'missing',
      stems: 0,
      cues: 'None',
      color: 'lime',
      accent: '#b6d936',
      stemLights: {
        drums: 'missing',
        bass: 'missing',
        guitar: 'missing',
        keys: 'missing',
        vox: 'missing',
      },
    },
  ]

  const collaborators = [
    { name: 'Martin', role: 'Owner', color: '#ff7a1a' },
    { name: 'Claude', role: 'Cue UX', color: '#16c7c1' },
    { name: 'Codex', role: 'Sync + model', color: '#f04495' },
  ]

  const activity = [
    'Pocket Thunder generated 5 stems',
    'Neon Staircase cue track rendered',
    'Glass Floor Waltz has two pending changes',
    'Quiet Machine needs local audio',
  ]

  const pulseCards = [
    { label: 'Next cue', value: 'Verse 2 in 8', tone: 'orange' },
    { label: 'Audio', value: '11 / 14 local', tone: 'cyan' },
    { label: 'Cloud', value: '3 live edits', tone: 'pink' },
    { label: 'Set', value: '42 min', tone: 'lime' },
  ]

  const statusLabel: Record<SongStatus, string> = {
    synced: 'Synced',
    pending: 'Pending',
    missing: 'Needs audio',
    working: 'Working',
  }

  const stemStateLabel: Record<StemState, string> = {
    ready: 'available',
    queued: 'queued',
    missing: 'missing',
  }

  const waveformSlices: WaveformSlice[] = [
    14, 24, 18, 34, 44, 38, 22, 28, 62, 76, 68, 58, 48, 36, 30, 42,
    72, 84, 64, 52, 46, 56, 78, 88, 54, 36, 28, 24, 40, 62, 70, 50,
    34, 44, 66, 82, 90, 74, 58, 46, 32, 26, 38, 52, 68, 60, 42, 30,
  ].map((level, index) => ({
    id: `slice-${index}`,
    level,
    bar: Math.floor(index / 16) + 1,
    beat: Math.floor((index % 16) / 4) + 1,
  }))

  const rulerMarkers = Array.from({ length: 12 }, (_, index) => ({
    id: `marker-${index}`,
    label: index % 4 === 0 ? `Bar ${Math.floor(index / 4) + 1}` : `${(index % 4) + 1}`,
  }))

  let activeDirection = $state<StyleDirectionId>('studio-brief')
  let activeWaveformStyle = $state<WaveformStyleId>('blocks')
  const activeStyle = $derived(
    styleDirections.find((direction) => direction.id === activeDirection) ?? styleDirections[0],
  )
</script>

<svelte:head>
  <title>Project Style Debug - BarBro</title>
</svelte:head>

<main class={`project-style-lab ${activeDirection}`}>
  <section class="idea-switcher" aria-label="Style ideas">
    <div class="switcher-title">
      <SlidersHorizontal size={17} />
      <span>Style lab</span>
    </div>
    <div class="idea-buttons">
      {#each styleDirections as direction (direction.id)}
        <button
          type="button"
          class:active={activeDirection === direction.id}
          aria-pressed={activeDirection === direction.id}
          onclick={() => (activeDirection = direction.id)}
        >
          <span class="idea-dot" style={`--dot: ${direction.color}`}></span>
          <span>{direction.name}</span>
        </button>
      {/each}
    </div>
  </section>

  <section class="top-strip rounded-none" aria-label="Project controls">
    <div class="brand-block">
      <div class="mark" aria-hidden="true">
        <Music2 size={24} strokeWidth={2.6} />
      </div>
      <div>
        <p class="eyebrow">Debug project</p>
        <h1>Neon Rehearsal Pack</h1>
      </div>
    </div>

    <div class="header-ribbon" aria-label="Active visual direction">
      <span>{activeStyle.tag}</span>
      <strong>{activeStyle.texture}</strong>
    </div>

    <div class="top-actions">
      <button type="button" aria-label="Search project">
        <Search size={18} />
      </button>
      <button type="button" aria-label="Sync project">
        <RefreshCw size={18} />
      </button>
      <button type="button" aria-label="Share project">
        <Share2 size={18} />
      </button>
      <button type="button" aria-label="Project settings">
        <Settings size={18} />
      </button>
    </div>
  </section>

  {#if activeDirection === 'studio-brief'}
    <section class="focus-strip" aria-label="Project overview">
      <div class="focus-copy">
        <p>Tour rehearsal project</p>
        <strong>14 songs · 42 min · 9 ready · 11/14 audio local</strong>
      </div>
      <div class="focus-members" aria-label="Project members">
        {#each collaborators as person (person.name)}
          <span class="avatar" style={`--avatar: ${person.color}`}>{person.name.slice(0, 1)}</span>
        {/each}
        <span class="member-count">3 members</span>
      </div>
    </section>
  {:else}
    <section class="signal-strip" aria-label="Project pulse">
      {#each pulseCards as card (card.label)}
        <div class={`pulse-card ${card.tone}`}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
        </div>
      {/each}
    </section>
  {/if}

  <div class="project-shell">
    <aside class="side-rail" aria-label="Project summary">
      <div class="folder-row">
        <FolderOpen size={18} />
        <span>/Tour/July set</span>
      </div>

      <div class="metric-stack">
        <div class="metric primary">
          <span class="metric-number">14</span>
          <span class="metric-label">Songs</span>
        </div>
        <div class="metric">
          <span class="metric-number">9</span>
          <span class="metric-label">Ready</span>
        </div>
        <div class="metric">
          <span class="metric-number">3</span>
          <span class="metric-label">People</span>
        </div>
      </div>

      <div class="side-band orange-band">
        <Cloud size={18} />
        <div>
          <strong>Cloud coop</strong>
          <span>Realtime pulls active</span>
        </div>
      </div>

      <div class="section-title">
        <Users size={16} />
        <span>Members</span>
      </div>
      <div class="people-list">
        {#each collaborators as person (person.name)}
          <div class="person">
            <span class="avatar" style={`--avatar: ${person.color}`}>{person.name.slice(0, 1)}</span>
            <div>
              <strong>{person.name}</strong>
              <span>{person.role}</span>
            </div>
          </div>
        {/each}
      </div>
    </aside>

    <section class="song-board" aria-label="Project songs">
      <div class="board-head">
        <div>
          <p class="eyebrow">Setlist order</p>
          <h2>Project songs</h2>
        </div>
        <div class="board-actions">
          <button type="button">
            <Plus size={17} />
            <span>Add</span>
          </button>
          <button type="button">
            <ArrowDownUp size={17} />
            <span>Reorder</span>
          </button>
        </div>
      </div>

      <div class="song-list">
        {#if activeDirection === 'studio-brief'}
          <div class="stem-table-head" aria-hidden="true">
            <span>Song</span>
            <div class="stem-labels">
              {#each stemColumns as stem (stem.key)}
                <span>{stem.label}</span>
              {/each}
            </div>
            <span>Actions</span>
          </div>
        {/if}

        {#each songs as song, index (song.id)}
          <article class={`song-row ${song.color}`}>
            <div class="song-art" style={`--accent: ${song.accent}`}>
              <span>{index + 1}</span>
            </div>

            <div class="song-main">
              <div class="song-title-line">
                <h3>{song.title}</h3>
                <span class={`status ${song.status}`}>{statusLabel[song.status]}</span>
              </div>
              <p>{song.artist}</p>
              <div class="song-meta">
                <span>{song.bpm} BPM</span>
                <span>{song.key}</span>
                <span>{song.duration}</span>
              </div>
            </div>

            <div class="stem-lights" aria-label={`${song.title} stem availability`}>
              {#each stemColumns as stem (stem.key)}
                <span
                  class={`stem-light ${song.stemLights[stem.key]}`}
                  aria-label={`${stem.label} ${stemStateLabel[song.stemLights[stem.key]]}`}
                  title={`${stem.label}: ${stemStateLabel[song.stemLights[stem.key]]}`}
                ></span>
              {/each}
            </div>

            <div class="song-tools" aria-label={`${song.title} tools`}>
              <span class="stem-count">{song.stems} stems</span>
              <span class="cue-pill">
                <Mic2 size={14} />
                {song.cues}
              </span>
              <button type="button" aria-label={`Play ${song.title}`}>
                <Play size={17} />
              </button>
              <button type="button" aria-label={`More actions for ${song.title}`}>
                <MoreHorizontal size={17} />
              </button>
            </div>
          </article>
        {/each}
      </div>

      {#if activeDirection === 'studio-brief'}
        <section class="waveform-panel" aria-label="Quantized waveform preview">
          <div class="waveform-head">
            <div>
              <p class="eyebrow">Waveform</p>
              <h2>Neon Staircase</h2>
            </div>
            <div class="wave-style-toggle" aria-label="Waveform style">
              {#each waveformStyles as style (style.id)}
                <button
                  type="button"
                  class:active={activeWaveformStyle === style.id}
                  aria-pressed={activeWaveformStyle === style.id}
                  onclick={() => (activeWaveformStyle = style.id)}
                >
                  {style.name}
                </button>
              {/each}
            </div>
          </div>

          <div
            class={`waveform-stage ${activeWaveformStyle}`}
            style={`--slice-count: ${waveformSlices.length}`}
          >
            <div class="wave-ruler" aria-hidden="true">
              {#each rulerMarkers as marker (marker.id)}
                <span>{marker.label}</span>
              {/each}
            </div>
            <div class="wave-slices">
              {#each waveformSlices as slice (slice.id)}
                <span
                  class:downbeat={slice.beat === 1}
                  style={`--level: ${slice.level}; --bar: ${slice.bar}; --beat: ${slice.beat}`}
                  aria-label={`Bar ${slice.bar}, beat ${slice.beat}, level ${slice.level}`}
                ></span>
              {/each}
            </div>
          </div>
        </section>
      {/if}
    </section>

    <aside class="right-stack" aria-label="Project tools">
      <section class="tool-panel orange-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Cue editor v2</p>
            <h2>Voice tracks</h2>
          </div>
          <Wand2 size={20} />
        </div>
        <div class="cue-preview">
          <div class="cue-marker">Verse 2</div>
          <div class="cue-beats">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
          </div>
        </div>
        <button type="button" class="panel-button">
          <Sparkles size={17} />
          <span>Regenerate cues</span>
        </button>
      </section>

      <section class="tool-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Audio package</p>
            <h2>Assets</h2>
          </div>
          <Download size={20} />
        </div>
        <div class="asset-grid">
          <div>
            <CircleCheck size={16} />
            <span>11/14 audio</span>
          </div>
          <div>
            <Activity size={16} />
            <span>8 stem sets</span>
          </div>
          <div>
            <Volume2 size={16} />
            <span>5 cue renders</span>
          </div>
        </div>
      </section>

      <section class="tool-panel activity-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Live feed</p>
            <h2>Changes</h2>
          </div>
          <Bell size={20} />
        </div>
        <ol>
          {#each activity as item (item)}
            <li>{item}</li>
          {/each}
        </ol>
      </section>
    </aside>
  </div>

  <section class="bottom-mixer" aria-label="Mix strip">
    <div class="mix-title">
      <SlidersHorizontal size={18} />
      <span>Project mix snapshot</span>
    </div>
    <div class="mix-bars">
      <span style="--h: 42%; --c: #ff7a1a"></span>
      <span style="--h: 76%; --c: #16c7c1"></span>
      <span style="--h: 55%; --c: #f04495"></span>
      <span style="--h: 88%; --c: #b6d936"></span>
      <span style="--h: 64%; --c: #2f62ff"></span>
      <span style="--h: 47%; --c: #ff7a1a"></span>
    </div>
  </section>
</main>

<style>
  .project-style-lab {
    --ink: oklch(0.18 0.018 248);
    --orange: #ff7a1a;
    --orange-dark: #7b2c00;
    --cyan: #16c7c1;
    --pink: #f04495;
    --lime: #b6d936;
    --blue: #2f62ff;
    --paper: oklch(0.955 0.014 235);
    --panel: oklch(0.985 0.01 110);
    --muted-panel: oklch(0.93 0.02 230);
    --header: var(--ink);
    --header-text: var(--panel);
    --loud: var(--orange);
    --shadow: var(--ink);
    --texture-a: repeating-linear-gradient(
      90deg,
      color-mix(in oklch, var(--ink) 5%, transparent) 0 1px,
      transparent 1px 28px
    );
    --texture-b: repeating-linear-gradient(
      0deg,
      color-mix(in oklch, var(--ink) 5%, transparent) 0 1px,
      transparent 1px 28px
    );
    --texture-c: repeating-linear-gradient(
      135deg,
      transparent 0 16px,
      color-mix(in oklch, var(--orange) 18%, transparent) 16px 18px,
      transparent 18px 40px
    );
    min-height: 100dvh;
    background-color: var(--paper);
    background-image: var(--texture-a), var(--texture-b), var(--texture-c);
    color: var(--ink);
    padding: clamp(12px, 2vw, 26px);
  }

  .project-style-lab.studio-brief {
    --paper: oklch(0.948 0.006 255);
    --panel: oklch(0.992 0.002 255);
    --muted-panel: oklch(0.91 0.004 255);
    --loud: var(--orange);
    --texture-a: repeating-linear-gradient(
      90deg,
      color-mix(in oklch, var(--ink) 4%, transparent) 0 1px,
      transparent 1px 40px
    );
    --texture-b: repeating-linear-gradient(
      0deg,
      color-mix(in oklch, var(--ink) 3%, transparent) 0 1px,
      transparent 1px 40px
    );
    --texture-c: repeating-linear-gradient(
      135deg,
      transparent 0 36px,
      color-mix(in oklch, var(--orange) 10%, transparent) 36px 38px,
      transparent 38px 78px
    );
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    min-height: 2.35rem;
    border: 2px solid var(--ink);
    background: var(--panel);
    color: var(--ink);
    font-weight: 900;
    box-shadow: 3px 3px 0 var(--shadow);
    transition:
      transform 120ms ease,
      box-shadow 120ms ease,
      background-color 120ms ease;
  }

  button:hover {
    transform: translate(1px, 1px);
    box-shadow: 2px 2px 0 var(--shadow);
    background: var(--loud);
  }

  .idea-switcher {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.85rem;
    margin-bottom: 0.85rem;
  }

  .switcher-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.5rem;
    border: 2px solid var(--ink);
    background: var(--ink);
    color: var(--panel);
    padding: 0 0.75rem;
    font-size: 0.8rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .idea-buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.55rem;
  }

  .idea-buttons button {
    min-height: 2.5rem;
    padding: 0 0.7rem;
    background: var(--panel);
  }

  .idea-buttons button.active {
    background: var(--loud);
    transform: translate(2px, 2px);
    box-shadow: 1px 1px 0 var(--shadow);
  }

  .idea-dot {
    width: 0.82rem;
    height: 0.82rem;
    border: 2px solid var(--ink);
    background: var(--dot);
  }

  .top-strip {
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 0;
    overflow: hidden;
    border: 3px solid var(--ink);
    background: var(--header);
    color: var(--header-text);
    box-shadow: 6px 6px 0 var(--shadow);
    min-height: 128px;
  }

  .top-strip::after {
    content: '';
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 13px;
    border-top: 3px solid var(--ink);
    background: repeating-linear-gradient(
      90deg,
      var(--orange) 0 48px,
      var(--cyan) 48px 76px,
      var(--pink) 76px 102px,
      var(--lime) 102px 130px,
      var(--blue) 130px 154px
    );
  }

  .studio-brief .top-strip {
    min-height: 116px;
    box-shadow: 4px 4px 0 var(--shadow);
  }

  .studio-brief .top-strip::after {
    height: 10px;
    background: linear-gradient(90deg, var(--orange) 0 32%, var(--panel) 32% 70%, var(--ink) 70% 100%);
  }

  .top-strip > * {
    position: relative;
    z-index: 1;
  }

  .brand-block {
    display: flex;
    min-width: 0;
    align-items: center;
    flex: 1;
    gap: 1rem;
    padding: 1rem 1.1rem 1.45rem;
  }

  .mark {
    display: grid;
    place-items: center;
    width: 54px;
    height: 54px;
    border: 3px solid var(--ink);
    background: var(--loud);
    color: var(--ink);
    box-shadow: 4px 4px 0 var(--ink);
  }

  .eyebrow {
    margin: 0;
    font-size: 0.68rem;
    font-weight: 950;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .top-strip .eyebrow {
    color: var(--loud);
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 3.25rem;
    line-height: 0.95;
  }

  h2 {
    font-family: var(--font-display);
    font-size: 1.55rem;
    line-height: 1;
  }

  h3 {
    font-size: 1.15rem;
    line-height: 1.05;
  }

  .header-ribbon {
    display: grid;
    min-width: 190px;
    align-content: center;
    gap: 0.2rem;
    border-left: 3px solid var(--ink);
    background: var(--loud);
    color: var(--ink);
    padding: 1rem 1rem 1.45rem;
  }

  .studio-brief .header-ribbon {
    background: var(--panel);
  }

  .header-ribbon span {
    font-size: 0.72rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .header-ribbon strong {
    font-family: var(--font-display);
    font-size: 1.45rem;
    line-height: 0.95;
  }

  .top-actions {
    display: flex;
    align-items: stretch;
    border-left: 3px solid var(--ink);
  }

  .top-actions button {
    width: 3.6rem;
    min-height: 100%;
    border-width: 0 0 0 2px;
    background: var(--header-text);
    color: var(--ink);
    box-shadow: none;
  }

  .top-actions button:first-child {
    border-left: 0;
  }

  .signal-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.65rem;
    margin-top: 1rem;
  }

  .focus-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 1rem;
    border: 3px solid var(--ink);
    background: var(--panel);
    padding: 0.85rem 1rem;
    box-shadow: 4px 4px 0 var(--shadow);
  }

  .focus-copy {
    display: grid;
    gap: 0.2rem;
  }

  .focus-copy p,
  .member-count {
    font-size: 0.72rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .focus-copy strong {
    font-size: 1rem;
  }

  .focus-members {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .pulse-card {
    display: grid;
    gap: 0.2rem;
    min-height: 72px;
    align-content: center;
    border: 3px solid var(--ink);
    background: var(--panel);
    padding: 0.7rem;
    box-shadow: 4px 4px 0 var(--shadow);
  }

  .pulse-card span {
    font-size: 0.7rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .pulse-card strong {
    font-family: var(--font-display);
    font-size: 1.35rem;
    line-height: 1;
  }

  .pulse-card.orange {
    background: var(--orange);
  }

  .pulse-card.cyan {
    background: var(--cyan);
  }

  .pulse-card.pink {
    background: var(--pink);
    color: white;
  }

  .pulse-card.lime {
    background: var(--lime);
  }

  .project-shell {
    display: grid;
    grid-template-columns: minmax(210px, 0.78fr) minmax(0, 2.1fr) minmax(260px, 0.95fr);
    gap: clamp(12px, 2vw, 22px);
    margin-top: clamp(16px, 2.4vw, 28px);
    align-items: start;
  }

  .studio-brief .project-shell {
    grid-template-columns: minmax(230px, 0.58fr) minmax(0, 1.55fr);
    max-width: 1280px;
  }

  .side-rail,
  .song-board,
  .tool-panel,
  .bottom-mixer {
    border: 3px solid var(--ink);
    background: var(--panel);
    box-shadow: 5px 5px 0 var(--shadow);
  }

  .studio-brief .side-rail,
  .studio-brief .song-board,
  .studio-brief .tool-panel {
    box-shadow: 3px 3px 0 var(--shadow);
  }

  .studio-brief .right-stack,
  .studio-brief .bottom-mixer {
    display: none;
  }

  .side-rail {
    display: grid;
    gap: 1rem;
    padding: 1rem;
  }

  .folder-row,
  .section-title,
  .mix-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .metric-stack {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .studio-brief .metric-stack {
    display: none;
  }

  .metric {
    display: grid;
    min-height: 78px;
    align-content: center;
    border: 2px solid var(--ink);
    background: var(--muted-panel);
    padding: 0.6rem;
  }

  .metric.primary {
    background: var(--loud);
  }

  .metric-number {
    font-family: var(--font-display);
    font-size: 1.8rem;
    line-height: 1;
  }

  .metric-label {
    font-size: 0.68rem;
    font-weight: 900;
    text-transform: uppercase;
  }

  .side-band {
    display: flex;
    gap: 0.65rem;
    border: 2px solid var(--ink);
    padding: 0.7rem;
  }

  .orange-band {
    background: var(--loud);
  }

  .studio-brief .orange-band {
    border-left-width: 10px;
    background: var(--panel);
  }

  .side-band div,
  .person div {
    display: grid;
    gap: 0.1rem;
  }

  .side-band strong,
  .person strong {
    font-size: 0.82rem;
    line-height: 1;
  }

  .side-band span,
  .person span,
  .song-main p {
    font-size: 0.75rem;
    font-weight: 700;
    opacity: 0.75;
  }

  .people-list {
    display: grid;
    gap: 0.55rem;
  }

  .person {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 2px solid var(--ink);
    background: var(--avatar);
    font-weight: 950;
  }

  .studio-brief .avatar {
    background: color-mix(in oklch, var(--avatar) 28%, white);
  }

  .song-board {
    padding: clamp(12px, 1.6vw, 20px);
  }

  .board-head,
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .board-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .board-actions button,
  .panel-button {
    padding: 0 0.85rem;
  }

  .song-list {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .song-row {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr) minmax(190px, 0.72fr) auto;
    gap: 0.85rem;
    align-items: center;
    border: 2px solid var(--ink);
    background: oklch(0.99 0.006 105);
    padding: 0.65rem;
    box-shadow: 3px 3px 0 color-mix(in oklch, var(--ink) 90%, transparent);
  }

  .studio-brief .song-row {
    grid-template-columns: minmax(0, 1fr) 238px 260px;
    min-height: 82px;
    border-left-width: 5px;
    border-left-color: var(--orange);
    background: var(--panel);
    box-shadow: none;
  }

  .studio-brief .song-art {
    display: none;
  }

  .stem-table-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 238px 260px;
    align-items: center;
    gap: 0.85rem;
    border: 2px solid var(--ink);
    background: var(--ink);
    color: var(--panel);
    padding: 0.45rem 0.65rem 0.45rem calc(0.65rem + 5px);
    font-size: 0.68rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .stem-labels,
  .stem-lights {
    display: grid;
    grid-template-columns: repeat(5, 34px);
    justify-content: end;
    gap: 0.45rem;
  }

  .stem-labels span {
    text-align: center;
  }

  .stem-lights {
    align-items: center;
  }

  .stem-light {
    position: relative;
    display: block;
    width: 34px;
    height: 22px;
    border: 2px solid var(--ink);
    background: var(--panel);
  }

  .stem-light::after {
    content: '';
    position: absolute;
    inset: 4px;
    background: color-mix(in oklch, var(--ink) 10%, white);
  }

  .stem-light.ready::after {
    background: var(--orange);
  }

  .stem-light.queued::after {
    background: repeating-linear-gradient(
      90deg,
      var(--orange) 0 5px,
      var(--panel) 5px 9px
    );
  }

  .stem-light.missing::after {
    background:
      linear-gradient(45deg, transparent 0 44%, var(--ink) 44% 56%, transparent 56%),
      linear-gradient(-45deg, transparent 0 44%, var(--ink) 44% 56%, transparent 56%),
      var(--panel);
  }

  .song-row.orange {
    border-left-width: 10px;
    border-left-color: var(--orange);
  }

  .song-row.cyan {
    border-left-width: 10px;
    border-left-color: var(--cyan);
  }

  .song-row.pink {
    border-left-width: 10px;
    border-left-color: var(--pink);
  }

  .song-row.lime {
    border-left-width: 10px;
    border-left-color: var(--lime);
  }

  .song-art {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    border: 2px solid var(--ink);
    background:
      linear-gradient(135deg, var(--accent) 0 48%, transparent 49%),
      repeating-linear-gradient(90deg, var(--panel) 0 8px, color-mix(in oklch, var(--accent) 35%, white) 8px 16px);
    font-family: var(--font-display);
    font-size: 1.4rem;
  }

  .song-title-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
  }

  .status,
  .stem-count,
  .cue-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 1.55rem;
    border: 2px solid var(--ink);
    padding: 0 0.45rem;
    font-size: 0.68rem;
    font-weight: 950;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .status.synced {
    background: var(--lime);
  }

  .studio-brief .status,
  .studio-brief .stem-count,
  .studio-brief .cue-pill,
  .studio-brief .song-meta span {
    background: var(--panel);
    color: var(--ink);
  }

  .studio-brief .status.synced {
    background: var(--ink);
    color: var(--panel);
  }

  .studio-brief .status.pending,
  .studio-brief .status.missing,
  .studio-brief .status.working {
    background: color-mix(in oklch, var(--orange) 16%, white);
    color: var(--ink);
  }

  .status.pending {
    background: var(--pink);
    color: white;
  }

  .status.missing {
    background: var(--muted-panel);
  }

  .status.working {
    background: var(--cyan);
  }

  .song-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.55rem;
  }

  .song-meta span {
    border: 1.5px solid var(--ink);
    padding: 0.1rem 0.35rem;
    font-size: 0.7rem;
    font-weight: 850;
  }

  .song-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  .studio-brief .song-tools {
    width: 260px;
  }

  .song-tools button {
    width: 2.25rem;
    min-height: 2.25rem;
    box-shadow: none;
  }

  .cue-pill {
    background: color-mix(in oklch, var(--loud) 18%, white);
  }

  .waveform-panel {
    display: grid;
    gap: 0.85rem;
    margin-top: 1rem;
    border: 3px solid var(--ink);
    background: var(--panel);
    padding: 1rem;
  }

  .waveform-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .wave-style-toggle {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.45rem;
  }

  .wave-style-toggle button {
    min-height: 2.1rem;
    padding: 0 0.65rem;
    box-shadow: none;
  }

  .wave-style-toggle button.active {
    background: var(--orange);
  }

  .waveform-stage {
    --slice-width: 18px;
    overflow-x: auto;
    border: 2px solid var(--ink);
    background:
      repeating-linear-gradient(
        90deg,
        transparent 0 calc(var(--slice-width) * 4 - 2px),
        color-mix(in oklch, var(--ink) 12%, transparent) calc(var(--slice-width) * 4 - 2px)
          calc(var(--slice-width) * 4)
      ),
      color-mix(in oklch, var(--muted-panel) 48%, white);
  }

  .wave-ruler,
  .wave-slices {
    width: max(100%, calc(var(--slice-count) * var(--slice-width)));
  }

  .wave-ruler {
    display: grid;
    grid-template-columns: repeat(12, minmax(calc(var(--slice-width) * 4), 1fr));
    border-bottom: 2px solid var(--ink);
    background: var(--panel);
  }

  .wave-ruler span {
    min-width: 0;
    border-right: 1px solid color-mix(in oklch, var(--ink) 25%, transparent);
    padding: 0.35rem 0.4rem;
    font-size: 0.64rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .wave-slices {
    display: grid;
    grid-template-columns: repeat(var(--slice-count), minmax(var(--slice-width), 1fr));
    align-items: center;
    height: 132px;
    padding: 0.75rem 0.55rem;
  }

  .wave-slices span {
    position: relative;
    display: block;
    justify-self: center;
    width: calc(var(--slice-width) - 5px);
    min-height: 8px;
    height: calc(var(--level) * 1%);
    border: 2px solid var(--ink);
    background: var(--orange);
  }

  .wave-slices span.downbeat {
    background: var(--ink);
  }

  .waveform-stage.blocks .wave-slices span {
    box-shadow: 2px 2px 0 var(--ink);
  }

  .waveform-stage.stepped .wave-slices span {
    width: calc(var(--slice-width) - 3px);
    background:
      repeating-linear-gradient(
        0deg,
        var(--orange) 0 10px,
        var(--panel) 10px 13px
      );
  }

  .waveform-stage.stepped .wave-slices span.downbeat {
    background:
      repeating-linear-gradient(
        0deg,
        var(--ink) 0 10px,
        var(--panel) 10px 13px
      );
  }

  .waveform-stage.needles .wave-slices span {
    width: 5px;
    border-width: 0 2px;
    background: var(--ink);
  }

  .waveform-stage.needles .wave-slices span::after {
    content: '';
    position: absolute;
    top: -5px;
    left: 50%;
    width: 13px;
    height: 9px;
    border: 2px solid var(--ink);
    background: var(--orange);
    transform: translateX(-50%);
  }

  .right-stack {
    display: grid;
    gap: 1rem;
  }

  .tool-panel {
    display: grid;
    gap: 1rem;
    padding: 1rem;
  }

  .orange-panel {
    background: color-mix(in oklch, var(--loud) 78%, white);
  }

  .cue-preview {
    border: 2px solid var(--ink);
    background: var(--panel);
    padding: 0.75rem;
  }

  .cue-marker {
    display: inline-block;
    border: 2px solid var(--ink);
    background: var(--pink);
    color: white;
    padding: 0.2rem 0.45rem;
    font-size: 0.78rem;
    font-weight: 950;
    text-transform: uppercase;
  }

  .cue-beats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.35rem;
    margin-top: 0.65rem;
  }

  .cue-beats span {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    border: 2px solid var(--ink);
    background: var(--cyan);
    font-family: var(--font-display);
  }

  .panel-button {
    width: fit-content;
    background: var(--ink);
    color: var(--panel);
  }

  .asset-grid {
    display: grid;
    gap: 0.5rem;
  }

  .asset-grid div {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    border: 2px solid var(--ink);
    background: var(--muted-panel);
    padding: 0.55rem;
    font-size: 0.78rem;
    font-weight: 900;
  }

  .activity-panel ol {
    display: grid;
    gap: 0.55rem;
    margin: 0;
    padding: 0;
    list-style: none;
    counter-reset: activity;
  }

  .activity-panel li {
    counter-increment: activity;
    display: grid;
    grid-template-columns: 1.45rem minmax(0, 1fr);
    gap: 0.45rem;
    align-items: start;
    font-size: 0.78rem;
    font-weight: 800;
  }

  .activity-panel li::before {
    content: counter(activity);
    display: grid;
    place-items: center;
    width: 1.45rem;
    height: 1.45rem;
    border: 2px solid var(--ink);
    background: var(--loud);
    font-size: 0.7rem;
    font-weight: 950;
  }

  .bottom-mixer {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    margin-top: clamp(16px, 2.4vw, 28px);
    padding: 1rem;
  }

  .mix-bars {
    display: flex;
    align-items: end;
    gap: 0.45rem;
    height: 74px;
  }

  .mix-bars span {
    width: clamp(20px, 3vw, 42px);
    height: var(--h);
    border: 2px solid var(--ink);
    background: var(--c);
    box-shadow: 3px 3px 0 var(--ink);
  }

  @media (max-width: 1100px) {
    .project-shell {
      grid-template-columns: 1fr;
    }

    .studio-brief .project-shell {
      grid-template-columns: 1fr;
      max-width: none;
    }

    .signal-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .side-rail {
      grid-template-columns: minmax(0, 1fr) minmax(220px, 0.7fr);
      align-items: start;
    }

    .people-list {
      grid-column: 1 / -1;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 920px) {
    .studio-brief .song-row,
    .stem-table-head {
      grid-template-columns: minmax(0, 1fr) 238px;
    }

    .stem-table-head > span:last-child {
      display: none;
    }

    .studio-brief .song-tools {
      grid-column: 1 / -1;
      width: auto;
      justify-content: start;
    }
  }

  @media (max-width: 720px) {
    .project-style-lab {
      padding: 10px;
    }

    .idea-switcher {
      align-items: stretch;
      flex-direction: column;
    }

    .idea-buttons {
      justify-content: stretch;
    }

    .idea-buttons button {
      flex: 1 1 calc(50% - 0.55rem);
    }

    .top-strip,
    .bottom-mixer,
    .song-row {
      grid-template-columns: 1fr;
      flex-direction: column;
      align-items: stretch;
    }

    .top-strip {
      display: grid;
    }

    h1 {
      font-size: 2.15rem;
    }

    h2 {
      font-size: 1.35rem;
    }

    h3 {
      font-size: 1.05rem;
    }

    .header-ribbon {
      min-width: 0;
      border-top: 3px solid var(--ink);
      border-left: 0;
    }

    .top-actions {
      border-top: 3px solid var(--ink);
      border-left: 0;
    }

    .top-actions button {
      flex: 1;
      min-height: 3rem;
    }

    .side-rail,
    .people-list,
    .signal-strip {
      grid-template-columns: 1fr;
    }

    .focus-strip,
    .waveform-head {
      align-items: stretch;
      flex-direction: column;
    }

    .focus-members,
    .wave-style-toggle {
      justify-content: start;
    }

    .stem-table-head {
      display: none;
    }

    .studio-brief .song-row,
    .song-row {
      display: grid;
      grid-template-columns: 1fr;
    }

    .stem-lights {
      justify-content: start;
    }

    .song-tools {
      justify-content: start;
      flex-wrap: wrap;
    }

    .studio-brief .song-tools {
      width: auto;
    }

    .waveform-stage {
      --slice-width: 16px;
    }

    .board-head {
      align-items: start;
      flex-direction: column;
    }
  }
</style>
