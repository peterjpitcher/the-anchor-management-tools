import PDFDocument from 'pdfkit'
import type { GuestGroup, GuestLine } from '@/lib/events/guest-list-model'
import { CONFIDENTIAL_PRINT_NOTE } from '@/lib/events/guest-answers'
import { STAFF } from '@/lib/brand/palette'
import { ANCHOR_LOGO_ASPECT_RATIO } from '@/lib/pdf/anchor-logo'

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
const NAME_COLUMN_WIDTH = NOTE_LINE_INSET - TICK_BOX - 16 // usable width for a guest name line
const LOGO_WIDTH = 84 // points; about 38pt tall, which sits inside the three header lines
const LOGO_GAP = 12
const ANSWER_LINE_HEIGHT = 12
const GROUP_HEADING_HEIGHT = 16

/** PDFKit's built-in fonts only encode WinAnsi (cp1252). Make any string safe to render so an
 *  exotic character in a customer name can never 500 the whole sheet. Keeps Latin-1 accents; folds
 *  or replaces anything outside cp1252. */
export function pdfSafeText(input: string): string {
  return Array.from(input ?? '').map((ch) => {
    if (/[\x20-\x7E\xA0-\xFF]/.test(ch)) return ch // already WinAnsi-safe (é, ü, ñ, ç, …)
    const folded = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    return folded.length > 0 ? folded : '?'
  }).join('')
}

export async function generateEventGuestListPdf(
  header: GuestListEventHeader,
  groups: GuestGroup[],
  /** The Anchor logo as a PNG data URI, drawn top right on every page. Left out when absent. */
  options: { logoDataUri?: string } = {},
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const left = PAGE_MARGIN
  const right = doc.page.width - PAGE_MARGIN
  const bottom = doc.page.height - PAGE_MARGIN
  const totalGuests = groups.reduce((n, g) => n + g.lines.length, 0)
  // Owner decision D6: answers on a door sheet are confidential and the sheet is shredded after
  // service. Only said when the sheet carries any.
  const carriesAnswers = groups.some(group => group.lines.some(line => line.answers.length > 0))

  // The title wraps short of the logo instead of running underneath it.
  const titleWidth = options.logoDataUri ? right - left - LOGO_WIDTH - LOGO_GAP : right - left

  const drawPageHeader = () => {
    if (options.logoDataUri) {
      // Drawn first. The title is then placed by explicit coordinates, so the image cannot shift it.
      doc.image(options.logoDataUri, right - LOGO_WIDTH, PAGE_MARGIN, {
        width: LOGO_WIDTH,
        height: LOGO_WIDTH / ANCHOR_LOGO_ASPECT_RATIO,
      })
    }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(STAFF.text)
      .text(pdfSafeText(header.name), left, PAGE_MARGIN, { width: titleWidth })
    doc.font('Helvetica').fontSize(11).fillColor(STAFF.text)
      .text(`${header.dateLabel} · ${header.timeLabel}`, left, doc.y + 2)
      .text(`Guests on the list: ${totalGuests}`, left, doc.y + 2)
    if (carriesAnswers) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(STAFF.text)
        .text(CONFIDENTIAL_PRINT_NOTE, left, doc.y + 2, { width: titleWidth })
    }
    doc.moveTo(left, doc.y + 6).lineTo(right, doc.y + 6).strokeColor(STAFF.textSubtle).stroke()
    doc.y += 14
  }

  drawPageHeader()

  if (groups.length === 0) {
    doc.font('Helvetica').fontSize(12).fillColor(STAFF.textMuted)
      .text('No guests booked yet.', left, doc.y + 8)
    doc.end()
    return done
  }

  const rowHeight = (line: GuestLine) => ROW_HEIGHT + line.answers.length * ANSWER_LINE_HEIGHT

  const drawGroupHeading = (group: GuestGroup) => {
    const parts = [group.bookedBy ? `Booked by ${group.bookedBy}` : null, group.paymentNote].filter(Boolean)
    if (parts.length === 0) return
    if (doc.y + GROUP_HEADING_HEIGHT + ROW_HEIGHT > bottom) { doc.addPage(); drawPageHeader() }
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(STAFF.textMuted)
      .text(pdfSafeText(parts.join(' · ')), left, doc.y + 2, { width: right - left, lineBreak: false, ellipsis: true })
    doc.y += 4
  }

  const drawRow = (line: GuestLine) => {
    const { name, isBooker } = line
    if (doc.y + rowHeight(line) > bottom) { doc.addPage(); drawPageHeader() }
    const y = doc.y
    // tick box
    doc.rect(left, y + 4, TICK_BOX, TICK_BOX).lineWidth(0.75).strokeColor(STAFF.textSoft).stroke()
    // name (or blank)
    doc.font(isBooker ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(STAFF.text)
      .text(pdfSafeText(name || ''), left + TICK_BOX + 8, y + 2, {
        width: NAME_COLUMN_WIDTH, lineBreak: false, ellipsis: true,
      })
    if (isBooker) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(STAFF.textMuted)
        .text('(booked by)', left + TICK_BOX + 8, y + 15)
    }
    // blank ruled note area
    doc.moveTo(left + NOTE_LINE_INSET, y + ROW_HEIGHT - 6).lineTo(right, y + ROW_HEIGHT - 6)
      .lineWidth(0.5).strokeColor(STAFF.borderStrong).stroke()
    // The guest's answers, one per line under their name (allergies on the tasting night).
    line.answers.forEach((answer, index) => {
      doc.font('Helvetica').fontSize(9).fillColor(STAFF.text)
        .text(pdfSafeText(`${answer.label}: ${answer.value}`), left + TICK_BOX + 8, y + ROW_HEIGHT + index * ANSWER_LINE_HEIGHT - 4, {
          width: right - left - TICK_BOX - 8, lineBreak: false, ellipsis: true,
        })
    })
    doc.y = y + rowHeight(line)
  }

  groups.forEach((group, idx) => {
    // keep the group heading and its first line together
    const needed = GROUP_HEADING_HEIGHT + Math.min(group.lines.length, 2) * ROW_HEIGHT
    if (doc.y + needed > bottom) { doc.addPage(); drawPageHeader() }
    drawGroupHeading(group)
    group.lines.forEach(line => drawRow(line))
    if (idx < groups.length - 1) {
      doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.5).strokeColor(STAFF.border).stroke()
      doc.y += 8
    }
  })

  // page numbers
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.font('Helvetica').fontSize(8).fillColor(STAFF.textMuted)
      .text(`Page ${i - range.start + 1} of ${range.count}`, left, bottom + 8, { width: right - left, align: 'right' })
  }

  doc.end()
  return done
}
