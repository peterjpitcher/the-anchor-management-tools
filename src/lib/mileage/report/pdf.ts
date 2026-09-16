/**
 * Renders the mileage claim report to PDF through the shared Chromium helper (spec 6.2).
 * generatePDFFromHTML closes its browser whether rendering succeeds or fails. The timeout returns a
 * clear error before the route's 60 second limit; a render that finishes late still closes its browser.
 */

import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'
import type { ReportPeriod } from '@/lib/mileage/periods'
import { MileageReportError } from './errors'
import type { MileageReportModel } from './model'
import { renderMileageReportHtml } from './template'

export const MILEAGE_REPORT_RENDER_TIMEOUT_MS = 45_000

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Chromium fills the pageNumber and totalPages spans on every page. */
export function mileageReportFooterTemplate(periodLabel: string): string {
  return `<div style="width: 100%; padding: 0 10mm; font-family: Arial, sans-serif; font-size: 8pt; color: #6b7280; text-align: center;">Mileage claim report, ${escapeHtml(periodLabel)}, page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`
}

export function mileageReportFileName(period: ReportPeriod, driverName: string | null): string {
  const person = driverName ? driverName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') : ''
  return `Mileage_Report_${period.fileLabel}${person ? `_${person}` : ''}.pdf`
}

export async function renderMileageReportPdf(model: MileageReportModel): Promise<Buffer> {
  const html = renderMileageReportHtml(model, { logoUrl: getDocumentLogoDataUri() })
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`render timed out after ${MILEAGE_REPORT_RENDER_TIMEOUT_MS}ms`)),
        MILEAGE_REPORT_RENDER_TIMEOUT_MS
      )
    })
    return await Promise.race([
      generatePDFFromHTML(html, {
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: mileageReportFooterTemplate(model.scope.period.label),
        margin: { top: '10mm', right: '10mm', bottom: '14mm', left: '10mm' },
      }),
      timeout,
    ])
  } catch (error) {
    // The message only: a render error never carries report contents, and names stay out of logs.
    console.error('[mileage] report PDF render failed', { message: error instanceof Error ? error.message : String(error) })
    throw new MileageReportError('MILEAGE_REPORT_RENDER_FAILED')
  } finally {
    if (timer) clearTimeout(timer)
  }
}
