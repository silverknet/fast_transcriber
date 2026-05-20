<script lang="ts">
  import type { Bar, SongMap } from '$lib/songmap'
  import {
    beatById,
    harmonyBeatOffset,
    harmonyByBarId,
    sectionAtBar,
  } from '$lib/leadsheet/iterate'
  import { generateChartHints, type BarHint } from '$lib/leadsheet/analyze'
  import { formatChordSymbol } from '$lib/chords'

  let { songMap }: { songMap: SongMap } = $props()

  // Layout constants in millimetres — copied from src/lib/export/pdfLeadSheet.ts
  // so the on-screen view matches the PDF export within rounding.
  const PAGE_W = 210
  const PAGE_H = 297
  const MARGIN_L = 18
  const MARGIN_R = 14
  const MARGIN_T = 16
  const MARGIN_B = 14

  const STAFF_LINE_GAP = 1.8
  const STAFF_HEIGHT = STAFF_LINE_GAP * 4
  const CHORD_Y_ABOVE = 4
  const SECTION_Y_ABOVE = 8.5
  const SYSTEM_SPACING = 22
  const BARS_PER_SYSTEM = 4

  const CLEF_WIDTH = 10
  const TIME_SIG_WIDTH = 8

  const USABLE_WIDTH = PAGE_W - MARGIN_L - MARGIN_R

  type ChordItem = { x: number; text: string }
  type LaidOutBar = {
    x: number
    width: number
    endX: number
    sectionLabel: string | null
    chords: ChordItem[]
    slashes: number[]
    isFinal: boolean
    hint: BarHint
  }
  type SystemLayout = {
    staffY: number
    isFirst: boolean
    isLast: boolean
    meterNum: number
    meterDen: number
    bars: LaidOutBar[]
  }
  type PageLayout = {
    showTitleBlock: boolean
    systems: SystemLayout[]
  }

  function keyString(sm: SongMap): string {
    if (sm.metadata.keyDetail) {
      const acc =
        sm.metadata.keyDetail.accidental === 'sharp'
          ? '♯'
          : sm.metadata.keyDetail.accidental === 'flat'
            ? '♭'
            : ''
      return `${sm.metadata.keyDetail.root}${acc} ${sm.metadata.keyDetail.mode}`
    }
    return sm.metadata.key ?? ''
  }

  function metaLine(sm: SongMap): string {
    const k = keyString(sm)
    const bpm = sm.metadata.bpm ? `${Math.round(sm.metadata.bpm)} BPM` : ''
    return [k, bpm].filter(Boolean).join('  |  ')
  }

  /** Y-advance per system, matching the PDF's bookkeeping. */
  function systemAdvance(): number {
    return 2 + STAFF_HEIGHT + SYSTEM_SPACING
  }

  /** Vertical room consumed by the page-1 title/header block. */
  function titleBlockHeight(sm: SongMap): number {
    let h = 8 // title
    if (sm.metadata.artist) h += 5
    if (metaLine(sm)) h += 5
    h += 4
    return h
  }

  const hints = $derived(generateChartHints(songMap))

  const pages = $derived.by<PageLayout[]>(() => {
    const sortedAll: Bar[] = [...songMap.timeline.bars].sort((a, b) => a.index - b.index)
    // Bars marked `skip` by the analyzer (collapsed inside a repeat) are
    // dropped from the rendered flow but remain in the SongMap data.
    const sorted: Bar[] = sortedAll.filter((b) => hints.bars.get(b.id)?.display !== 'skip')
    if (!sorted.length) {
      return [{ showTitleBlock: true, systems: [] }]
    }

    const beats = beatById(songMap)
    const harmonies = harmonyByBarId(songMap)

    const pagesOut: PageLayout[] = []
    let cursor = 0
    let isFirstPage = true

    while (cursor < sorted.length) {
      const page: PageLayout = { showTitleBlock: isFirstPage, systems: [] }
      let y = MARGIN_T + (isFirstPage ? titleBlockHeight(songMap) : 0)

      while (cursor < sorted.length && y + systemAdvance() <= PAGE_H - MARGIN_B) {
        const systemBars = sorted.slice(cursor, cursor + BARS_PER_SYSTEM)
        const isFirstSystem = cursor === 0
        const isLastSystem = cursor + systemBars.length >= sorted.length

        const leadingExtra = (isFirstSystem ? CLEF_WIDTH : 0) + TIME_SIG_WIDTH
        const barAreaWidth = USABLE_WIDTH - leadingExtra
        const barWidth = barAreaWidth / systemBars.length

        const staffY = y + SECTION_Y_ABOVE + 2
        const barsStartX = MARGIN_L + (isFirstSystem ? CLEF_WIDTH : 0) + TIME_SIG_WIDTH

        const sys: SystemLayout = {
          staffY,
          isFirst: isFirstSystem,
          isLast: isLastSystem,
          meterNum: systemBars[0].meter.numerator,
          meterDen: systemBars[0].meter.denominator,
          bars: [],
        }

        for (let i = 0; i < systemBars.length; i++) {
          const bar = systemBars[i]
          const barX = barsStartX + i * barWidth
          const isFinalBar = isLastSystem && i === systemBars.length - 1
          const hint: BarHint = hints.bars.get(bar.id) ?? { display: 'normal' }

          const label = sectionAtBar(songMap, bar.index)

          const sorted_h = [...(harmonies.get(bar.id) ?? [])].sort(
            (a, b) => harmonyBeatOffset(a, beats) - harmonyBeatOffset(b, beats),
          )
          const chords: ChordItem[] = sorted_h.map((h) => {
            const offset = harmonyBeatOffset(h, beats)
            const ratio = offset / Math.max(1, bar.meter.numerator)
            return {
              x: barX + 2 + ratio * (barWidth - 4),
              text: formatChordSymbol(h.chord, { unicode: true }),
            }
          })

          const numSlashes = Math.max(1, bar.beatCount || bar.meter.numerator)
          const slashPadding = 4
          const slashArea = barWidth - slashPadding * 2
          const slashes: number[] = []
          for (let s = 0; s < numSlashes; s++) {
            slashes.push(barX + slashPadding + (s + 0.5) * (slashArea / numSlashes))
          }

          sys.bars.push({
            x: barX,
            width: barWidth,
            endX: barX + barWidth,
            sectionLabel: label,
            chords,
            slashes,
            isFinal: isFinalBar,
            hint,
          })
        }

        page.systems.push(sys)
        cursor += systemBars.length
        y += systemAdvance()
      }

      pagesOut.push(page)
      isFirstPage = false

      // Safety: if nothing fit on the page (degenerate layout), bail.
      if (page.systems.length === 0) break
    }

    return pagesOut
  })

  const title = $derived(songMap.metadata.title || 'Untitled')
  const artist = $derived(songMap.metadata.artist ?? '')
  const meta = $derived(metaLine(songMap))
</script>

<div class="leadsheet" data-testid="leadsheet">
  {#each pages as page, pageIdx (pageIdx)}
    <svg
      class="leadsheet-page"
      viewBox="0 0 {PAGE_W} {PAGE_H}"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={pageIdx === 0 ? `Lead sheet: ${title}` : `Lead sheet page ${pageIdx + 1}`}
    >
      <rect x="0" y="0" width={PAGE_W} height={PAGE_H} fill="#ffffff" />

      {#if page.showTitleBlock}
        <text
          x={MARGIN_L}
          y={MARGIN_T + 5}
          class="ls-title"
          font-size="6.3"
          font-weight="700">{title}</text>
        {#if artist}
          <text
            x={MARGIN_L}
            y={MARGIN_T + 5 + 8}
            class="ls-artist"
            font-size="3.5">{artist}</text>
        {/if}
        {#if meta}
          <text
            x={MARGIN_L}
            y={MARGIN_T + 5 + (artist ? 13 : 8)}
            class="ls-meta"
            font-size="3.2">{meta}</text>
        {/if}
      {/if}

      {#each page.systems as sys, sysIdx (sysIdx)}
        {#each [0, 1, 2, 3, 4] as lineIdx (lineIdx)}
          <line
            x1={MARGIN_L}
            y1={sys.staffY + lineIdx * STAFF_LINE_GAP}
            x2={MARGIN_L + USABLE_WIDTH}
            y2={sys.staffY + lineIdx * STAFF_LINE_GAP}
            stroke="#000"
            stroke-width="0.18"
          />
        {/each}

        {#if sys.isFirst}
          <text
            x={MARGIN_L + 1}
            y={sys.staffY + STAFF_HEIGHT / 2}
            font-size="10"
            dominant-baseline="central"
            font-family="'Bravura Text', 'Noto Music', 'Apple Symbols', serif"
            fill="#000">𝄞</text>
        {/if}

        {@const tsX = MARGIN_L + (sys.isFirst ? CLEF_WIDTH : 0)}
        <text
          x={tsX + TIME_SIG_WIDTH / 2}
          y={sys.staffY + STAFF_HEIGHT * 0.27}
          font-size="4.2"
          font-weight="700"
          text-anchor="middle"
          dominant-baseline="central"
          fill="#000">{sys.meterNum}</text>
        <text
          x={tsX + TIME_SIG_WIDTH / 2}
          y={sys.staffY + STAFF_HEIGHT * 0.73}
          font-size="4.2"
          font-weight="700"
          text-anchor="middle"
          dominant-baseline="central"
          fill="#000">{sys.meterDen}</text>

        <line
          x1={MARGIN_L}
          y1={sys.staffY}
          x2={MARGIN_L}
          y2={sys.staffY + STAFF_HEIGHT}
          stroke="#000"
          stroke-width="0.25"
        />

        {#each sys.bars as bar, barIdx (barIdx)}
          {#if bar.hint.barNumber}
            <text
              x={bar.x}
              y={sys.staffY - 13.5}
              font-size="2.2"
              font-style="italic"
              fill="#777">{bar.hint.barNumber}</text>
          {/if}

          {#if bar.sectionLabel}
            <text
              x={bar.x + 1}
              y={sys.staffY - SECTION_Y_ABOVE + 1.5}
              font-size="3.6"
              font-style="italic"
              font-weight="700"
              fill="#000">{bar.sectionLabel}</text>
          {/if}

          {#if bar.hint.voltaStart || bar.hint.voltaContinue || bar.hint.voltaEnd}
            {@const vy = sys.staffY - 11}
            <line
              x1={bar.x}
              y1={vy}
              x2={bar.endX}
              y2={vy}
              stroke="#000"
              stroke-width="0.4"
            />
            {#if bar.hint.voltaStart}
              <line
                x1={bar.x}
                y1={vy}
                x2={bar.x}
                y2={vy + 2.5}
                stroke="#000"
                stroke-width="0.4"
              />
              <text
                x={bar.x + 1.2}
                y={vy + 2.2}
                font-size="2.6"
                font-weight="700"
                fill="#000">{bar.hint.voltaStart}</text>
            {/if}
            {#if bar.hint.voltaEnd}
              <line
                x1={bar.endX}
                y1={vy}
                x2={bar.endX}
                y2={vy + 2.5}
                stroke="#000"
                stroke-width="0.4"
              />
            {/if}
          {/if}

          {#if bar.hint.display === 'nc'}
            <text
              x={bar.x + bar.width / 2}
              y={sys.staffY + STAFF_HEIGHT / 2}
              font-size="3.6"
              font-weight="700"
              text-anchor="middle"
              dominant-baseline="central"
              fill="#000">N.C.</text>
          {:else if bar.hint.display === 'simile'}
            <text
              x={bar.x + bar.width / 2}
              y={sys.staffY + STAFF_HEIGHT / 2}
              font-size="6.5"
              font-weight="700"
              font-style="italic"
              text-anchor="middle"
              dominant-baseline="central"
              fill="#000">%</text>
          {:else}
            {#each bar.chords as chord, ci (ci)}
              <text
                x={chord.x}
                y={sys.staffY - CHORD_Y_ABOVE}
                font-size="3.2"
                font-weight="700"
                fill="#000">{chord.text}</text>
            {/each}

            {#each bar.slashes as cx, si (si)}
              {@const cy = sys.staffY + STAFF_HEIGHT / 2}
              <line
                x1={cx - 1.0}
                y1={cy + 1.7}
                x2={cx + 1.0}
                y2={cy - 1.7}
                stroke="#000"
                stroke-width="0.55"
                stroke-linecap="round"
              />
            {/each}
          {/if}

          {#if bar.hint.repeatOpen}
            <circle
              cx={bar.x + 1.8}
              cy={sys.staffY + STAFF_LINE_GAP * 1.5}
              r="0.5"
              fill="#000"
            />
            <circle
              cx={bar.x + 1.8}
              cy={sys.staffY + STAFF_LINE_GAP * 2.5}
              r="0.5"
              fill="#000"
            />
            <line
              x1={bar.x}
              y1={sys.staffY}
              x2={bar.x}
              y2={sys.staffY + STAFF_HEIGHT}
              stroke="#000"
              stroke-width="0.7"
            />
          {/if}

          {#if bar.isFinal}
            <line
              x1={bar.endX - 1.2}
              y1={sys.staffY}
              x2={bar.endX - 1.2}
              y2={sys.staffY + STAFF_HEIGHT}
              stroke="#000"
              stroke-width="0.25"
            />
            <line
              x1={bar.endX}
              y1={sys.staffY}
              x2={bar.endX}
              y2={sys.staffY + STAFF_HEIGHT}
              stroke="#000"
              stroke-width="0.7"
            />
          {:else}
            <line
              x1={bar.endX}
              y1={sys.staffY}
              x2={bar.endX}
              y2={sys.staffY + STAFF_HEIGHT}
              stroke="#000"
              stroke-width={bar.hint.repeatClose ? '0.7' : '0.25'}
            />
          {/if}

          {#if bar.hint.repeatClose}
            <circle
              cx={bar.endX - 1.8}
              cy={sys.staffY + STAFF_LINE_GAP * 1.5}
              r="0.5"
              fill="#000"
            />
            <circle
              cx={bar.endX - 1.8}
              cy={sys.staffY + STAFF_LINE_GAP * 2.5}
              r="0.5"
              fill="#000"
            />
            {#if bar.hint.repeatCount && bar.hint.repeatCount > 1}
              <text
                x={bar.endX - 0.5}
                y={sys.staffY - 1.5}
                font-size="2.5"
                font-style="italic"
                font-weight="700"
                fill="#000">×{bar.hint.repeatCount}</text>
            {/if}
          {/if}
        {/each}
      {/each}
    </svg>
  {/each}
</div>

<style>
  .leadsheet {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.25rem;
    padding: 1.25rem;
    background: #d8d8d8;
    width: 100%;
  }

  .leadsheet-page {
    width: 100%;
    max-width: 794px;
    aspect-ratio: 210 / 297;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.12);
    display: block;
  }

  .leadsheet-page text {
    font-family: 'Times New Roman', 'Georgia', serif;
  }
</style>
