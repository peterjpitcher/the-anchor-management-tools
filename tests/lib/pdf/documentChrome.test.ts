import { describe, expect, it } from 'vitest'
import { STAFF } from '@/lib/brand/palette'
import { renderDocumentHead, statusBadgeStyle } from '@/lib/pdf/document-chrome'
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
