import PDFDocument from 'pdfkit'
import type { GuestGroup } from '@/lib/events/guest-list-model'

export interface GuestListEventHeader {
  name: string
  /** Pre-formatted London date/time strings from the caller (use dateUtils there). */
  dateLabel: string
  timeLabel: string
}

const PAGE_MARGIN = 40
const TICK_BOX = 10
const ROW_HEIGHT = 26
const NOTE_LINE_INSET = 220 // x where the blank ruled note area starts, from left margin

export async function generateEventGuestListPdf(
  header: GuestListEventHeader,
  groups: GuestGroup[],
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const left = PAGE_MARGIN
  const right = doc.page.width - PAGE_MARGIN
  const bottom = doc.page.height - PAGE_MARGIN
  const totalGuests = groups.reduce((n, g) => n + g.lines.length, 0)

  const drawPageHeader = () => {
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827')
      .text(header.name, left, PAGE_MARGIN, { width: right - left })
    doc.font('Helvetica').fontSize(11).fillColor('#374151')
      .text(`${header.dateLabel} · ${header.timeLabel}`, left, doc.y + 2)
      .text(`Confirmed guests: ${totalGuests}`, left, doc.y + 2)
    doc.moveTo(left, doc.y + 6).lineTo(right, doc.y + 6).strokeColor('#9ca3af').stroke()
    doc.y += 14
  }

  drawPageHeader()

  if (groups.length === 0) {
    doc.font('Helvetica').fontSize(12).fillColor('#6b7280')
      .text('No confirmed guests yet.', left, doc.y + 8)
    doc.end()
    return done
  }

  const drawRow = (name: string, isBooker: boolean) => {
    if (doc.y + ROW_HEIGHT > bottom) { doc.addPage(); drawPageHeader() }
    const y = doc.y
    // tick box
    doc.rect(left, y + 4, TICK_BOX, TICK_BOX).lineWidth(0.75).strokeColor('#6b7280').stroke()
    // name (or blank)
    doc.font(isBooker ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor('#111827')
      .text(name || '', left + TICK_BOX + 8, y + 2, { width: NOTE_LINE_INSET - TICK_BOX - 16 })
    if (isBooker) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#9ca3af')
        .text('(booked by)', left + TICK_BOX + 8, y + 15)
    }
    // blank ruled note area
    doc.moveTo(left + NOTE_LINE_INSET, y + ROW_HEIGHT - 6).lineTo(right, y + ROW_HEIGHT - 6)
      .lineWidth(0.5).strokeColor('#d1d5db').stroke()
    doc.y = y + ROW_HEIGHT
  }

  groups.forEach((group, idx) => {
    // keep the booker line with at least one following line
    const needed = Math.min(group.lines.length, 2) * ROW_HEIGHT
    if (doc.y + needed > bottom) { doc.addPage(); drawPageHeader() }
    group.lines.forEach(line => drawRow(line.name, line.isBooker))
    if (idx < groups.length - 1) {
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
      doc.y += 8
    }
  })

  // page numbers
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
      .text(`Page ${i - range.start + 1} of ${range.count}`, left, bottom + 8, { width: right - left, align: 'right' })
  }

  doc.end()
  return done
}
