import PDFDocument from 'pdfkit'
import { STAFF } from '@/lib/brand/palette'
import { ANCHOR_LOGO_ASPECT_RATIO } from '@/lib/pdf/anchor-logo'
import { CONFIDENTIAL_PRINT_NOTE, type GuestAnswersSummary } from '@/lib/events/guest-answers'
import { pdfSafeText, type GuestListEventHeader } from '@/lib/events/guest-list-pdf'

const PAGE_MARGIN = 40
const LOGO_WIDTH = 84
const LOGO_GAP = 12

/**
 * The kitchen's sheet for an event night: every guest's answers grouped by question, whose
 * required answer is missing, and the booking notes (BK-015; owner decision D6, which allows
 * answers and notes on kitchen sheets marked confidential and shredded after service).
 */
export async function generateKitchenSummaryPdf(
  header: GuestListEventHeader,
  summary: GuestAnswersSummary,
  options: { logoDataUri?: string } = {},
): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const left = PAGE_MARGIN
  const right = doc.page.width - PAGE_MARGIN
  const bottom = doc.page.height - PAGE_MARGIN
  const width = right - left
  const titleWidth = options.logoDataUri ? width - LOGO_WIDTH - LOGO_GAP : width

  const drawPageHeader = () => {
    if (options.logoDataUri) {
      doc.image(options.logoDataUri, right - LOGO_WIDTH, PAGE_MARGIN, {
        width: LOGO_WIDTH,
        height: LOGO_WIDTH / ANCHOR_LOGO_ASPECT_RATIO,
      })
    }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(STAFF.text)
      .text(pdfSafeText(`${header.name}: kitchen summary`), left, PAGE_MARGIN, { width: titleWidth })
    doc.font('Helvetica').fontSize(11).fillColor(STAFF.text)
      .text(`${header.dateLabel} · ${header.timeLabel}`, left, doc.y + 2, { width: titleWidth })
      .text(`Guests with details: ${summary.guests}`, left, doc.y + 2, { width: titleWidth })
    doc.font('Helvetica-Bold').fontSize(10).fillColor(STAFF.text)
      .text(CONFIDENTIAL_PRINT_NOTE, left, doc.y + 2, { width: titleWidth })
    doc.moveTo(left, doc.y + 6).lineTo(right, doc.y + 6).strokeColor(STAFF.textSubtle).stroke()
    doc.y += 14
  }

  const ensureRoom = (height: number) => {
    if (doc.y + height > bottom) { doc.addPage(); drawPageHeader() }
  }

  const heading = (text: string) => {
    ensureRoom(40)
    doc.font('Helvetica-Bold').fontSize(12).fillColor(STAFF.text).text(pdfSafeText(text), left, doc.y + 6, { width })
    doc.y += 2
  }

  const line = (text: string, options: { muted?: boolean } = {}) => {
    const safe = pdfSafeText(text)
    doc.font('Helvetica').fontSize(10)
    ensureRoom(doc.heightOfString(safe, { width: width - 12 }) + 4)
    doc.fillColor(options.muted ? STAFF.textMuted : STAFF.text).text(safe, left + 12, doc.y + 2, { width: width - 12 })
  }

  drawPageHeader()

  if (summary.questions.length === 0 && summary.notes.length === 0) {
    doc.font('Helvetica').fontSize(12).fillColor(STAFF.textMuted).text('No answers or booking notes yet.', left, doc.y + 8)
  }

  for (const question of summary.questions) {
    heading(`${question.label} (${question.answered.length} answered)`)
    if (question.answered.length === 0) line('No answers yet.', { muted: true })
    for (const answer of question.answered) line(`${answer.guestName} (${answer.reference}): ${answer.value}`)
    if (question.missingRequired.length > 0) {
      line(`No answer yet from: ${question.missingRequired.map((guest) => `${guest.guestName} (${guest.reference})`).join(', ')}`, { muted: true })
    }
  }

  if (summary.notes.length > 0) {
    heading('Booking notes')
    for (const note of summary.notes) {
      // An online meal or early-arrival request already reads "UNCONFIRMED REQUEST: ...".
      line(`${note.bookerName} (${note.reference}): ${note.note}`)
    }
  }

  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.font('Helvetica').fontSize(8).fillColor(STAFF.textMuted)
      .text(`Page ${i - range.start + 1} of ${range.count}`, left, bottom + 8, { width, align: 'right' })
  }

  doc.end()
  return done
}
