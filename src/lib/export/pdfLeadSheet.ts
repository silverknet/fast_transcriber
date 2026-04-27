import type { Beat, HarmonyEvent, SongMap } from '$lib/songmap'

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
const BARS_PER_LINE = 4

const CLEF_WIDTH = 10
const TIME_SIG_WIDTH = 8

const SLASH_W = 2.2
const SLASH_H = STAFF_LINE_GAP * 2.4
const SLASH_SLANT = 1.4

function harmonyByBarId(songMap: SongMap): Map<string, HarmonyEvent[]> {
  const map = new Map<string, HarmonyEvent[]>()
  for (const h of songMap.harmony) {
    const list = map.get(h.barId) ?? []
    list.push(h)
    map.set(h.barId, list)
  }
  return map
}

function beatById(songMap: SongMap): Map<string, Beat> {
  return new Map(songMap.timeline.beats.map((b) => [b.id, b]))
}

function harmonyBeatOffset(h: HarmonyEvent, beats: Map<string, Beat>): number {
  if (h.beatAnchor) return Math.max(0, h.beatAnchor.indexInBar)
  if (h.beatId) return Math.max(0, beats.get(h.beatId)?.indexInBar ?? 0)
  return 0
}

function sectionAtBar(songMap: SongMap, barIndex: number): string | null {
  const s = songMap.sections.find((sec) => sec.barRange.startBarIndex === barIndex)
  return s ? s.label || s.kind : null
}

function drawStaffLines(pdf: any, x: number, y: number, width: number) {
  pdf.setDrawColor(0)
  pdf.setLineWidth(0.18)
  for (let i = 0; i < 5; i++) {
    const ly = y + i * STAFF_LINE_GAP
    pdf.line(x, ly, x + width, ly)
  }
}

function drawBarLine(pdf: any, x: number, y: number) {
  pdf.setDrawColor(0)
  pdf.setLineWidth(0.25)
  pdf.line(x, y, x, y + STAFF_HEIGHT)
}

function drawFinalBarLine(pdf: any, x: number, y: number) {
  pdf.setDrawColor(0)
  pdf.setLineWidth(0.25)
  pdf.line(x - 1.2, y, x - 1.2, y + STAFF_HEIGHT)
  pdf.setLineWidth(0.7)
  pdf.line(x, y, x, y + STAFF_HEIGHT)
}

function drawSlashNote(pdf: any, cx: number, staffY: number) {
  const cy = staffY + STAFF_HEIGHT / 2
  pdf.setFillColor(0)
  const hw = SLASH_W / 2
  const hh = SLASH_H / 2
  const pts = [
    { x: cx - hw + SLASH_SLANT, y: cy - hh },
    { x: cx + hw + SLASH_SLANT, y: cy - hh },
    { x: cx + hw - SLASH_SLANT, y: cy + hh },
    { x: cx - hw - SLASH_SLANT, y: cy + hh },
  ]
  pdf.moveTo(pts[0].x, pts[0].y)
  pdf.lineTo(pts[1].x, pts[1].y)
  pdf.lineTo(pts[2].x, pts[2].y)
  pdf.lineTo(pts[3].x, pts[3].y)
  pdf.fill()
}

function drawTrebleClef(pdf: any, x: number, staffY: number) {
  pdf.setFont('Helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.setTextColor(0)
  pdf.text('𝄞', x + 1, staffY + STAFF_HEIGHT - 0.2)
}

function drawTimeSig(pdf: any, x: number, staffY: number, num: number, den: number) {
  pdf.setFont('Helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(0)
  const cx = x + TIME_SIG_WIDTH / 2
  pdf.text(String(num), cx, staffY + STAFF_LINE_GAP * 1.6, { align: 'center' })
  pdf.text(String(den), cx, staffY + STAFF_LINE_GAP * 3.6, { align: 'center' })
}

export async function renderLeadSheetPdf(songMap: SongMap): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('PDF export is only available in the browser.')
  }

  const { jsPDF } = await import('jspdf')

  const bars = [...songMap.timeline.bars].sort((a, b) => a.index - b.index)
  if (!bars.length) throw new Error('Cannot export PDF: song has no bars.')

  const beats = beatById(songMap)
  const harmonies = harmonyByBarId(songMap)

  const pdf = new jsPDF('p', 'mm', [PAGE_W, PAGE_H])
  const usableWidth = PAGE_W - MARGIN_L - MARGIN_R
  let barCursor = 0
  let isFirstPage = true

  while (barCursor < bars.length) {
    if (!isFirstPage) pdf.addPage()
    let y = MARGIN_T

    if (isFirstPage) {
      pdf.setFont('Helvetica', 'bold')
      pdf.setFontSize(18)
      pdf.setTextColor(0)
      pdf.text(songMap.metadata.title || 'Untitled', MARGIN_L, y + 5)
      y += 8

      pdf.setFont('Helvetica', 'normal')
      pdf.setFontSize(10)
      if (songMap.metadata.artist) {
        pdf.text(songMap.metadata.artist, MARGIN_L, y + 3.5)
        y += 5
      }

      const keyStr = songMap.metadata.keyDetail
        ? `${songMap.metadata.keyDetail.root}${songMap.metadata.keyDetail.accidental === 'sharp' ? '#' : songMap.metadata.keyDetail.accidental === 'flat' ? 'b' : ''} ${songMap.metadata.keyDetail.mode}`
        : songMap.metadata.key || ''
      const bpmStr = songMap.metadata.bpm ? `${Math.round(songMap.metadata.bpm)} BPM` : ''
      const meta = [keyStr, bpmStr].filter(Boolean).join('  |  ')
      if (meta) {
        pdf.setFontSize(9)
        pdf.text(meta, MARGIN_L, y + 3)
        y += 5
      }
      y += 4
    }

    while (barCursor < bars.length && y + SYSTEM_SPACING <= PAGE_H - MARGIN_B) {
      const systemBars = bars.slice(barCursor, barCursor + BARS_PER_LINE)
      const isFirstSystem = barCursor === 0
      const leadingExtra = (isFirstSystem ? CLEF_WIDTH : 0) + TIME_SIG_WIDTH
      const barAreaWidth = usableWidth - leadingExtra
      const barWidth = barAreaWidth / systemBars.length

      const staffY = y + SECTION_Y_ABOVE + 2

      let x = MARGIN_L
      drawBarLine(pdf, x, staffY)

      if (isFirstSystem) {
        drawTrebleClef(pdf, x, staffY)
        x += CLEF_WIDTH
      }
      drawTimeSig(pdf, x, staffY, systemBars[0].meter.numerator, systemBars[0].meter.denominator)
      x += TIME_SIG_WIDTH

      drawStaffLines(pdf, MARGIN_L, staffY, usableWidth)

      for (let i = 0; i < systemBars.length; i++) {
        const bar = systemBars[i]
        const barX = x + i * barWidth
        const barEndX = barX + barWidth

        if (i === systemBars.length - 1 && barCursor + systemBars.length >= bars.length) {
          drawFinalBarLine(pdf, barEndX, staffY)
        } else {
          drawBarLine(pdf, barEndX, staffY)
        }

        const label = sectionAtBar(songMap, bar.index)
        if (label) {
          pdf.setFont('Helvetica', 'bold')
          pdf.setFontSize(8)
          pdf.setTextColor(0)
          pdf.text(label, barX + 1, staffY - SECTION_Y_ABOVE + 2)
        }

        const barHarmonies = [...(harmonies.get(bar.id) ?? [])]
        barHarmonies.sort((a, b) => harmonyBeatOffset(a, beats) - harmonyBeatOffset(b, beats))
        pdf.setFont('Helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.setTextColor(0)
        for (const h of barHarmonies) {
          const offset = harmonyBeatOffset(h, beats)
          const ratio = offset / Math.max(1, bar.meter.numerator)
          const chordX = barX + 2 + ratio * (barWidth - 4)
          pdf.text(h.chord.displayRaw || h.chord.root, chordX, staffY - CHORD_Y_ABOVE)
        }

        const numSlashes = Math.max(1, bar.beatCount || bar.meter.numerator)
        const slashPadding = 4
        const slashArea = barWidth - slashPadding * 2
        for (let s = 0; s < numSlashes; s++) {
          const sx = barX + slashPadding + (s + 0.5) * (slashArea / numSlashes)
          drawSlashNote(pdf, sx, staffY)
        }
      }

      barCursor += systemBars.length
      y = staffY + STAFF_HEIGHT + SYSTEM_SPACING - SECTION_Y_ABOVE
    }

    isFirstPage = false
  }

  return pdf.output('blob')
}
