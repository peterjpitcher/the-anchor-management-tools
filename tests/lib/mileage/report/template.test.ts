import { describe, expect, it } from 'vitest'
import { buildDatasetJson, DRIVER_B_ID } from '../../../fixtures/mileage/reportDataset'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildMileageReport } from '@/lib/mileage/report/model'
import { MILEAGE_REPORT_CSP, renderMileageReportHtml } from '@/lib/mileage/report/template'
import { quarterPeriod } from '@/lib/mileage/periods'

function render(json: unknown = buildDatasetJson(), driverId: string | null = null, logoUrl?: string) {
  const model = buildMileageReport(parseMileageReportDataset(json), { period: quarterPeriod(2026, 2), driverId })
  return renderMileageReportHtml(model, { logoUrl })
}

describe('renderMileageReportHtml', () => {
  it('shows the period, scope, generated time and claim per person', () => {
    const html = render()
    expect(html).toContain('Q2 2026: 1 April to 30 June 2026')
    expect(html).toContain('All drivers')
    expect(html).toContain('Generated 2 October 2026 at 14:05 (UK time)')
    expect(html).toContain('£31.01')
    expect(html).toContain('£23.53')
    expect(html).toContain('£7.48')
    expect(html).toContain('£1.30')
  })

  it('lists every trip exactly once', () => {
    const json = buildDatasetJson()
    const html = render(json)
    for (const trip of json.trips) {
      expect(html.split(`data-trip-id="${trip.id}"`)).toHaveLength(2)
    }
  })

  it('escapes every value', () => {
    const json = buildDatasetJson()
    json.trips[0].description = '<script>alert(1)</script>'
    json.drivers[0].display_name = 'Driver <A> & Co'
    const html = render(json)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script')
    expect(html).toContain('Driver &lt;A&gt; &amp; Co')
    expect(html).not.toContain('<A>')
  })

  it('blocks network requests and uses only an inlined logo', () => {
    const html = render(buildDatasetJson(), null, 'data:image/jpeg;base64,AAAA')
    expect(html).toContain(`<meta charset="UTF-8">\n  <meta http-equiv="Content-Security-Policy" content="${MILEAGE_REPORT_CSP}">`)
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"')
    expect(html).not.toMatch(/(src|href)="https?:/)
  })

  it('repeats table headers on every page and keeps rows whole', () => {
    const html = render()
    expect(html).toContain('.mr-table thead { display: table-header-group; }')
    expect(html).toContain('page-break-inside: avoid')
  })

  it('labels a one-driver report as a subset', () => {
    expect(render(buildDatasetJson(), DRIVER_B_ID)).toContain('Driver B only: a subset of the full claim')
  })

  it('warns when the VAT figure is incomplete and says why', () => {
    const html = render(buildDatasetJson({ vehicles: [] }))
    expect(html).toContain('The VAT figure is incomplete')
    expect(html).toContain('no car recorded for this date')
  })

  it('states a nil report for an empty period', () => {
    const html = render(buildDatasetJson({ trips: [] }))
    expect(html).toContain('No mileage in this period')
    expect(html).not.toContain('data-trip-id')
  })

  it('never prints undefined, NaN or Invalid Date', () => {
    for (const html of [render(), render(buildDatasetJson({ trips: [] })), render(buildDatasetJson(), DRIVER_B_ID)]) {
      expect(html).not.toMatch(/undefined|NaN|Invalid Date/)
    }
  })
})
