import { beforeEach, describe, expect, it, vi } from 'vitest'

const { generatePDFFromHTML } = vi.hoisted(() => ({
  generatePDFFromHTML: vi.fn(async (_html: string, _options?: unknown) => Buffer.from('pdf')),
}))
vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML }))
vi.mock('@/lib/pdf/document-logo', () => ({ getDocumentLogoDataUri: vi.fn(() => 'data:image/png;base64,AAAA') }))

import { generateOjTimesheetPDF } from '@/lib/oj-timesheet'
import { LOGO_MAX_WIDTH_PX } from '@/lib/pdf/document-chrome'
import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'

const INPUT = {
  invoiceNumber: 'INV-0247',
  vendorName: 'Golden Barrels <Ltd>',
  periodStart: '2026-03-01',
  periodEnd: '2026-03-31',
  notesText: '2026-03-04  2.00h  Booking <system> support',
}

function renderedHtml(): string {
  return String(generatePDFFromHTML.mock.calls.at(-1)?.[0])
}

describe('generateOjTimesheetPDF', () => {
  beforeEach(() => {
    generatePDFFromHTML.mockClear()
    vi.mocked(getDocumentLogoDataUri).mockReturnValue('data:image/png;base64,AAAA')
  })

  it('carries the Orange Jelly logo at the width the invoice uses', async () => {
    await generateOjTimesheetPDF(INPUT)

    const html = renderedHtml()
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="Orange Jelly" class="logo" />')
    expect(html).toContain(`max-width: ${LOGO_MAX_WIDTH_PX}px`)
  })

  it('still renders, without an image, when the logo cannot be read', async () => {
    vi.mocked(getDocumentLogoDataUri).mockReturnValue(undefined)

    await generateOjTimesheetPDF(INPUT)

    const html = renderedHtml()
    expect(html).not.toContain('<img')
    expect(html).toContain('OJ Projects Timesheet')
  })

  it('escapes client and note text', async () => {
    await generateOjTimesheetPDF(INPUT)

    const html = renderedHtml()
    expect(html).toContain('Golden Barrels &lt;Ltd&gt;')
    expect(html).toContain('Booking &lt;system&gt; support')
  })
})
