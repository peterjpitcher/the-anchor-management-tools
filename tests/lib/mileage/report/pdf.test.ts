import { beforeEach, describe, expect, it, vi } from 'vitest'

const generatePDFFromHTML = vi.hoisted(() => vi.fn())
vi.mock('@/lib/pdf-generator', () => ({ generatePDFFromHTML }))
vi.mock('@/lib/pdf/document-logo', () => ({ getDocumentLogoDataUri: () => 'data:image/jpeg;base64,AAAA' }))

import { buildDatasetJson } from '../../../fixtures/mileage/reportDataset'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildMileageReport } from '@/lib/mileage/report/model'
import { customPeriod, financialYearPeriod, quarterPeriod, taxYearPeriod } from '@/lib/mileage/periods'
import {
  MILEAGE_REPORT_RENDER_TIMEOUT_MS,
  mileageReportFileName,
  mileageReportFooterTemplate,
  renderMileageReportPdf,
} from '@/lib/mileage/report/pdf'

function model() {
  return buildMileageReport(parseMileageReportDataset(buildDatasetJson()), { period: quarterPeriod(2026, 2), driverId: null })
}

describe('renderMileageReportPdf', () => {
  beforeEach(() => {
    generatePDFFromHTML.mockReset()
    vi.useRealTimers()
  })

  it('renders the report with the inlined logo and a numbered footer', async () => {
    generatePDFFromHTML.mockResolvedValue(Buffer.from('%PDF-1.7'))

    const pdf = await renderMileageReportPdf(model())

    expect(pdf.toString()).toBe('%PDF-1.7')
    const [html, options] = generatePDFFromHTML.mock.calls[0]
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"')
    expect(options).toMatchObject({ displayHeaderFooter: true, headerTemplate: '<span></span>' })
    expect(options.footerTemplate).toContain(
      'Mileage claim report, Q2 2026: 1 April to 30 June 2026, page <span class="pageNumber"></span> of <span class="totalPages"></span>'
    )
  })

  it('reports a render error as MILEAGE_REPORT_RENDER_FAILED', async () => {
    generatePDFFromHTML.mockRejectedValue(new Error('Failed to generate PDF'))
    await expect(renderMileageReportPdf(model())).rejects.toMatchObject({ code: 'MILEAGE_REPORT_RENDER_FAILED' })
  })

  it('gives up with MILEAGE_REPORT_RENDER_FAILED when rendering hangs', async () => {
    vi.useFakeTimers()
    generatePDFFromHTML.mockReturnValue(new Promise(() => {}))

    const assertion = expect(renderMileageReportPdf(model())).rejects.toMatchObject({ code: 'MILEAGE_REPORT_RENDER_FAILED' })
    await vi.advanceTimersByTimeAsync(MILEAGE_REPORT_RENDER_TIMEOUT_MS)
    await assertion
  })
})

describe('report file names and footer', () => {
  it('uses the spec file names and adds the person to a one-person report', () => {
    expect(mileageReportFileName(quarterPeriod(2026, 3), null)).toBe('Mileage_Report_2026-Q3.pdf')
    expect(mileageReportFileName(financialYearPeriod(2026), null)).toBe('Mileage_Report_FY2026.pdf')
    expect(mileageReportFileName(taxYearPeriod(2026), null)).toBe('Mileage_Report_TY2026-27.pdf')
    expect(mileageReportFileName(customPeriod('2024-01-01', '2026-09-30'), null)).toBe('Mileage_Report_2024-01-01_to_2026-09-30.pdf')
    expect(mileageReportFileName(quarterPeriod(2026, 3), "Driver O'Brien & Co")).toBe('Mileage_Report_2026-Q3_Driver_O_Brien_Co.pdf')
  })

  it('escapes the period label in the footer', () => {
    expect(mileageReportFooterTemplate('<b>')).toContain('Mileage claim report, &lt;b&gt;, page')
  })
})
