import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { buildDatasetJson } from '../../../fixtures/mileage/reportDataset'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildMileageReport } from '@/lib/mileage/report/model'
import { buildMileageCsv } from '@/lib/mileage/report/csv'
import { quarterPeriod } from '@/lib/mileage/periods'

function csvFor(json = buildDatasetJson(), scopeLines = ['All drivers']) {
  const dataset = parseMileageReportDataset(json)
  const model = buildMileageReport(dataset, { period: quarterPeriod(2026, 2), driverId: null })
  const buffer = buildMileageCsv({
    periodLabel: model.scope.period.label,
    generatedAt: dataset.generatedAt,
    scopeLines,
    trips: dataset.trips,
    totals: model.totals,
    byDriver: model.byDriver,
  })
  const text = buffer.toString('utf8')
  return { text, rows: Papa.parse<string[]>(text.replace(/^﻿/, '')).data }
}

describe('buildMileageCsv', () => {
  it('starts with a BOM and a summary that reconciles to the rows', () => {
    const { text, rows } = csvFor()
    expect(text.startsWith('﻿')).toBe(true)
    expect(rows.slice(0, 9)).toEqual([
      ['Report', 'Mileage claim report'],
      ['Period', 'Q2 2026: 1 April to 30 June 2026'],
      ['Generated', '2 October 2026 at 14:05 (UK time)'],
      ['Scope', 'All drivers'],
      ['Trips', '3'],
      ['Total miles', '57.0'],
      ['Total claim (£)', '31.01'],
      ['Claim for Driver A (£)', '23.53'],
      ['Claim for Driver B (£)', '7.48'],
    ])
  })

  it('writes one row per trip in the agreed columns', () => {
    const { rows } = csvFor()
    const headerIndex = rows.findIndex((row) => row[0] === 'Date')
    expect(rows[headerIndex]).toEqual([
      'Date', 'Driver', 'Driver basis', 'Reason', 'Route', 'Start postcode', 'End postcode', 'Total miles',
      'Standard-rate miles', 'Standard rate (p)', 'Reduced-rate miles', 'Reduced rate (p)', 'Amount (£)', 'Source',
      'OJ project', 'OJ client',
    ])
    expect(rows[headerIndex + 1]).toEqual([
      '04/04/2026', 'Driver A', "Owner's statement, 15 Sep 2026", 'Shop One', 'The Anchor → Shop One → The Anchor',
      'TW19 6AQ', 'TW19 6AQ', '3.4', '3.4', '45', '0.0', '25', '1.53', 'Logged', '', '',
    ])
    expect(rows[headerIndex + 2]).toEqual([
      '06/04/2026', 'Driver B', 'Recorded when logged', 'Collect wholesale order', 'The Anchor → Wholesaler → The Anchor',
      'TW19 6AQ', 'TW19 6AQ', '13.6', '13.6', '55', '0.0', '25', '7.48', 'Logged', '', '',
    ])
    expect(rows[headerIndex + 3]).toEqual([
      '01/05/2026', 'Driver A', 'OJ Projects trip', 'Workshop', 'Not recorded (OJ Projects: Vision workshop, Client Ltd)',
      '', '', '40.0', '40.0', '55', '0.0', '25', '22.00', 'OJ Projects', 'Vision workshop', 'Client Ltd',
    ])
  })

  it('protects text cells from spreadsheet formulas', () => {
    const json = buildDatasetJson()
    json.trips[0].description = '=HYPERLINK("http://example.com")'
    const { rows } = csvFor(json, ['=cmd|scope'])
    expect(rows[3][1].startsWith('\t=')).toBe(true)
    const headerIndex = rows.findIndex((row) => row[0] === 'Date')
    expect(rows[headerIndex + 1][3].startsWith('\t=')).toBe(true)
  })

  it('never writes undefined, NaN or Invalid Date', () => {
    for (const json of [buildDatasetJson(), buildDatasetJson({ trips: [] })]) {
      const { text } = csvFor(json)
      expect(text).not.toMatch(/undefined|NaN|Invalid Date/)
    }
  })
})
