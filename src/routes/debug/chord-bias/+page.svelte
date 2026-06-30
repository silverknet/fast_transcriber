<script lang="ts">
  /**
   * Chord-suggestion bias A/B harness.
   *
   * `proposeChordSuggestions` shapes each per-bar prediction with three
   * stacked signals:
   *   1. raw chroma fit (Pearson vs the 24 triad templates) — always on,
   *   2. a song-key diatonic bonus (1.15×),
   *   3. a same-kind-section bonus (1.40×) that copies the chord the user
   *      placed at the matching beat of an earlier same-kind section.
   *
   * This page measures each signal's contribution. It runs the suggester
   * over the currently-loaded song under four bias configs and scores the
   * predictions against the chords the user actually placed (the
   * `songMap.harmony` entries = ground truth). Open a song, run the chord
   * analyzer, place some chords, then come here.
   *
   * Caveat — the section bias is partly self-referential: it reads
   * user-placed chords, so on a song where the user has chorded an early
   * verse it will "predict" the matching later-verse chords almost for
   * free. That's exactly the convention it exploits, but it means the
   * section-bias column flatters itself on songs that are already
   * well-chorded. Read it as "how much does reusing section patterns
   * help", not "how good is the acoustic model".
   */
  import { songMap } from '$lib/stores/songMap'
  import {
    proposeChordSuggestions,
    type ChordSuggestion,
    type SuggestOptions,
  } from '$lib/chords/suggestFromChroma'
  import { formatChordSymbol } from '$lib/chords/formatChordSymbol'
  import { songKeyPreferFlats } from '$lib/chords/diatonic'
  import { chordRootToPitchClass } from '$lib/chords/pitchClass'
  import type { ChordSymbol, SongMap } from '$lib/songmap/types'

  type Config = {
    id: string
    label: string
    blurb: string
    opts: SuggestOptions
  }

  // chroma-only is the floor; each subsequent config adds one signal; the
  // last mirrors production (both biases on).
  const CONFIGS: Config[] = [
    {
      id: 'chroma',
      label: 'Chroma only',
      blurb: 'Raw Pearson fit. No diatonic, no section bias.',
      opts: { useDiatonicBias: false, useSectionBias: false },
    },
    {
      id: 'diatonic',
      label: '+ Diatonic',
      blurb: 'Chroma × 1.15 key bonus.',
      opts: { useDiatonicBias: true, useSectionBias: false },
    },
    {
      id: 'section',
      label: '+ Section',
      blurb: 'Chroma × 1.40 same-kind-section bonus.',
      opts: { useDiatonicBias: false, useSectionBias: true },
    },
    {
      id: 'production',
      label: 'Production (all)',
      blurb: 'Chroma × diatonic × section. What ships.',
      opts: {},
    },
  ]

  /**
   * Normalize a chord to the `(pc, quality)` the triad matcher can produce,
   * so a prediction is graded against ground truth on the same axis the
   * suggester actually decides on. 7ths/sus collapse to their parent triad;
   * diminished returns null (the matcher never emits it, and a user dim
   * chord can't be matched on this axis).
   */
  function triadKey(c: ChordSymbol): string | null {
    const pc = chordRootToPitchClass(c.root, c.accidental)
    const q = (c.quality ?? 'major').toLowerCase()
    const quality =
      q === 'minor' || q === 'min7' || q === 'm7' || q === 'm' || q === 'min'
        ? 'minor'
        : q === 'dim' || q === 'm7b5' || q === 'min7b5'
          ? null
          : 'major'
    return quality === null ? null : `${pc}:${quality}`
  }

  /** User-placed chords keyed by the beat they sit on (ground truth). */
  function groundTruthByBeat(sm: SongMap): Map<string, ChordSymbol> {
    const out = new Map<string, ChordSymbol>()
    for (const ev of sm.harmony) {
      if (ev.beatId) out.set(ev.beatId, ev.chord)
    }
    return out
  }

  type BarRow = {
    barIndex: number
    beatId: string
    truth: ChordSymbol
    truthKey: string | null
    perConfig: Record<
      string,
      { top: ChordSymbol | null; top1Hit: boolean; topNHit: boolean }
    >
  }

  type ConfigScore = {
    graded: number
    top1: number
    topN: number
  }

  const preferFlats = $derived(
    $songMap?.metadata.keyDetail ? songKeyPreferFlats($songMap.metadata.keyDetail) : false,
  )

  const truth = $derived($songMap ? groundTruthByBeat($songMap) : new Map<string, ChordSymbol>())

  // One suggestion map per config, recomputed whenever the song changes.
  const suggestionsByConfig = $derived.by(() => {
    const sm = $songMap
    const out: Record<string, Map<string, ChordSuggestion>> = {}
    for (const c of CONFIGS) out[c.id] = proposeChordSuggestions(sm, c.opts)
    return out
  })

  const rows = $derived.by<BarRow[]>(() => {
    const sm = $songMap
    if (!sm) return []
    const result: BarRow[] = []
    for (const [beatId, chord] of truth) {
      const bar = sm.timeline.bars.find((b) => b.beatIds[0] === beatId)
      if (!bar) continue // ground truth not on a downbeat → not predictable here
      const truthKey = triadKey(chord)
      const perConfig: BarRow['perConfig'] = {}
      for (const c of CONFIGS) {
        const sug = suggestionsByConfig[c.id].get(beatId) ?? null
        const top = sug?.chord ?? null
        const top1Hit = !!top && truthKey !== null && triadKey(top) === truthKey
        const candidateKeys = sug
          ? [sug.chord, ...sug.alternatives].map(triadKey)
          : []
        const topNHit = truthKey !== null && candidateKeys.includes(truthKey)
        perConfig[c.id] = { top, top1Hit, topNHit }
      }
      result.push({ barIndex: bar.index, beatId, truth: chord, truthKey, perConfig })
    }
    return result.sort((a, b) => a.barIndex - b.barIndex)
  })

  // Only bars whose ground-truth chord is gradable (major/minor) count
  // toward accuracy; dim/other truth chords are shown but excluded.
  const scores = $derived.by<Record<string, ConfigScore>>(() => {
    const out: Record<string, ConfigScore> = {}
    for (const c of CONFIGS) out[c.id] = { graded: 0, top1: 0, topN: 0 }
    for (const r of rows) {
      if (r.truthKey === null) continue
      for (const c of CONFIGS) {
        out[c.id].graded += 1
        if (r.perConfig[c.id].top1Hit) out[c.id].top1 += 1
        if (r.perConfig[c.id].topNHit) out[c.id].topN += 1
      }
    }
    return out
  })

  function pct(n: number, d: number): string {
    if (d === 0) return '—'
    return `${Math.round((n / d) * 100)}%`
  }

  function label(c: ChordSymbol | null): string {
    return c ? formatChordSymbol(c, { preferFlats }) : '—'
  }

  const hasHints = $derived(!!$songMap?.chordHints?.beatChroma?.length)
  const gradableTruth = $derived(rows.filter((r) => r.truthKey !== null).length)
</script>

<main class="mx-auto max-w-6xl space-y-10 px-6 py-12">
  <header class="border-foreground space-y-2 border-b-2 pb-6">
    <p class="text-muted-foreground text-xs uppercase tracking-[0.2em]">debug · chord bias</p>
    <h1 class="text-4xl font-black tracking-tight">Suggestion A/B harness</h1>
    <p class="text-muted-foreground max-w-2xl text-sm">
      Scores each suggestion bias against the chords you placed by hand on the
      currently-loaded song. Open a song, run the chord analyzer, and place a
      few chords first — predictions are graded only on bars whose downbeat has
      a user-placed major/minor chord.
    </p>
  </header>

  {#if !$songMap}
    <p class="text-muted-foreground text-sm">
      No song loaded. Open a song in the editor, then return here (the loaded
      <code>songMap</code> persists across routes).
    </p>
  {:else if !hasHints}
    <p class="text-muted-foreground text-sm">
      This song has no cached chroma (<code>chordHints</code>). Run the chord
      analyzer in the editor, then come back.
    </p>
  {:else if gradableTruth === 0}
    <p class="text-muted-foreground text-sm">
      No gradable ground truth: this song has no user-placed major/minor chords
      sitting on a bar downbeat. Place some chords in the editor, then return.
    </p>
  {:else}
    <!-- ── Scoreboard ─────────────────────────────────────────────────── -->
    <section class="space-y-4">
      <h2 class="text-lg font-bold">
        Accuracy <span class="text-muted-foreground text-sm font-normal"
          >· {gradableTruth} gradable bar{gradableTruth === 1 ? '' : 's'}</span
        >
      </h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each CONFIGS as c (c.id)}
          <div class="border-foreground space-y-2 border-2 p-4">
            <p class="text-sm font-bold">{c.label}</p>
            <p class="text-muted-foreground text-[11px] leading-tight">{c.blurb}</p>
            <div class="space-y-1 pt-2 font-mono">
              <p class="text-2xl font-black">{pct(scores[c.id].top1, scores[c.id].graded)}</p>
              <p class="text-muted-foreground text-[10px] uppercase tracking-wide">
                top-1 · {scores[c.id].top1}/{scores[c.id].graded}
              </p>
              <p class="text-sm">
                {pct(scores[c.id].topN, scores[c.id].graded)}
                <span class="text-muted-foreground text-[10px]">top-N</span>
              </p>
            </div>
          </div>
        {/each}
      </div>
      <p class="text-muted-foreground max-w-2xl text-[11px] leading-relaxed">
        <strong>Caveat:</strong> the section bias reads user-placed chords, so on
        a well-chorded song it predicts later same-kind sections almost for free.
        Read that column as "how much does reusing section patterns help", not
        "how good is the acoustic model".
      </p>
    </section>

    <!-- ── Per-bar breakdown ──────────────────────────────────────────── -->
    <section class="space-y-3">
      <h2 class="text-lg font-bold">Per-bar predictions</h2>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse font-mono text-xs">
          <thead>
            <tr class="border-foreground border-b-2 text-left">
              <th class="py-2 pr-3">Bar</th>
              <th class="py-2 pr-3">You placed</th>
              {#each CONFIGS as c (c.id)}
                <th class="py-2 pr-3">{c.label}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as r (r.beatId)}
              <tr
                class="border-foreground/15 border-b"
                class:opacity-50={r.truthKey === null}
              >
                <td class="py-1.5 pr-3">{r.barIndex + 1}</td>
                <td class="py-1.5 pr-3 font-bold">
                  {label(r.truth)}
                  {#if r.truthKey === null}
                    <span class="text-muted-foreground text-[9px]">(ungraded)</span>
                  {/if}
                </td>
                {#each CONFIGS as c (c.id)}
                  {@const cell = r.perConfig[c.id]}
                  <td
                    class="py-1.5 pr-3"
                    class:text-green-600={cell.top1Hit}
                    class:font-bold={cell.top1Hit}
                  >
                    {label(cell.top)}
                    {#if !cell.top1Hit && cell.topNHit}
                      <span class="text-amber-600 text-[9px]" title="in alternates">·alt</span>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-muted-foreground text-[11px]">
        <span class="font-bold text-green-600">Green</span> = top-1 match ·
        <span class="text-amber-600">·alt</span> = matched in alternates only ·
        dimmed rows = ungraded ground truth (dim/other).
      </p>
    </section>
  {/if}
</main>
