import { describe, expect, it } from 'vitest'
import { STAFF } from '@/lib/brand/palette'
import {
  isSamePhoneNumber,
  LONG_NOTES_MIN_LINES,
  notesSectionClass,
  renderDocumentHead,
  statusBadgeStyle,
} from '@/lib/pdf/document-chrome'
import { invoiceStatusTone, quoteStatusTone } from '@/lib/invoices/status-ui'

const base = { titleHtml: 'Title', metaClass: '.meta', numberClass: '.number', bodyCss: '' }

describe('renderDocumentHead', () => {
  it('renders exactly as before when no extra head markup is given', () => {
    expect(renderDocumentHead(base)).toBe(renderDocumentHead({ ...base, headExtraHtml: '' }))
    expect(renderDocumentHead(base)).toContain('<meta charset="UTF-8">\n')
  })

  it('places extra head markup straight after the charset', () => {
    expect(renderDocumentHead({ ...base, headExtraHtml: '<meta name="robots" content="none">' })).toContain(
      '<meta charset="UTF-8"><meta name="robots" content="none">\n'
    )
  })

  it('no longer prints status badges as white text on a bright fill', () => {
    expect(renderDocumentHead(base)).not.toContain('color: white')
  })

  it('keeps the legal footer whole and on the same page as the block above it', () => {
    // Either rule alone still strands the footer. Without the first it splits between its
    // lines; without the second it moves whole to a page that holds nothing else.
    const footerRule = renderDocumentHead(base).match(/\.footer \{([^}]*)\}/)?.[1] ?? ''
    expect(footerRule).toContain('page-break-inside: avoid;')
    expect(footerRule).toContain('page-break-before: avoid;')
  })
})

describe('notesSectionClass', () => {
  const lines = (count: number): string => Array.from({ length: count }, (_, i) => `Line ${i + 1}`).join('\n')

  it('keeps ordinary notes in one piece', () => {
    expect(notesSectionClass('Payment is due within 7 days.')).toBe('notes-section keep-together')
    expect(notesSectionClass(lines(LONG_NOTES_MIN_LINES - 1))).toBe('notes-section keep-together')
  })

  it('lets long notes run onto the next page', () => {
    // A box that cannot split and fills a page leaves no room beside it for the footer.
    expect(notesSectionClass(lines(LONG_NOTES_MIN_LINES))).toBe('notes-section notes-section-long')
    expect(notesSectionClass(lines(LONG_NOTES_MIN_LINES).replace(/\n/g, '\r\n'))).toBe('notes-section notes-section-long')
  })

  it('counts a line that wraps as more than one', () => {
    const paragraph = 'word '.repeat(30 * LONG_NOTES_MIN_LINES)
    expect(notesSectionClass(paragraph)).toBe('notes-section notes-section-long')
  })

  it('treats missing notes as short', () => {
    expect(notesSectionClass(null)).toBe('notes-section keep-together')
    expect(notesSectionClass(undefined)).toBe('notes-section keep-together')
  })
})

describe('statusBadgeStyle', () => {
  it('draws a status with a soft fill, dark text and a pale border', () => {
    expect(statusBadgeStyle('success')).toBe(
      `background-color: ${STAFF.successSoft}; color: ${STAFF.successFg}; border-color: ${STAFF.successBorder}`
    )
    expect(statusBadgeStyle('danger')).toBe(
      `background-color: ${STAFF.dangerSoft}; color: ${STAFF.dangerFg}; border-color: ${STAFF.dangerBorder}`
    )
    expect(statusBadgeStyle('neutral')).toContain(`color: ${STAFF.textMuted}`)
    expect(statusBadgeStyle('primary')).toBe(
      `background-color: ${STAFF.primarySoft}; color: ${STAFF.primarySoftFg}; border-color: ${STAFF.primary}33`
    )
  })

  it('takes the tones the app shows for invoice and quote statuses', () => {
    // The invoice and quote templates pass invoiceStatusTone/quoteStatusTone straight through,
    // so a status reads the same on paper as on the invoice list.
    expect(statusBadgeStyle(quoteStatusTone('expired'))).toBe(statusBadgeStyle('neutral'))
    expect(statusBadgeStyle(invoiceStatusTone('credited'))).toBe(statusBadgeStyle('primary'))
    expect(statusBadgeStyle(invoiceStatusTone('overdue'))).toBe(statusBadgeStyle('danger'))
  })
})

describe('isSamePhoneNumber', () => {
  it('sees through spacing, punctuation and a country code', () => {
    expect(isSamePhoneNumber('01753682707', '01753 682 707')).toBe(true)
    expect(isSamePhoneNumber('+44 1753 682707', '01753 682 707')).toBe(true)
    expect(isSamePhoneNumber('(01753) 682-707', '01753682707')).toBe(true)
  })

  it('keeps two different numbers apart', () => {
    expect(isSamePhoneNumber('07990587315', '01753 682 707')).toBe(false)
  })

  it('never calls two blanks the same number', () => {
    expect(isSamePhoneNumber('', '')).toBe(false)
    expect(isSamePhoneNumber('n/a', 'none')).toBe(false)
  })
})
