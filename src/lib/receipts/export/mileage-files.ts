/**
 * The quarterly pack's mileage files (spec 6.4): the CSV, the report PDF and the claim summary's
 * figures, all from one dataset call so they always agree. Any failure throws, which fails the pack.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { quarterPeriod } from '@/lib/mileage/periods'
import { buildMileageCsv } from '@/lib/mileage/report/csv'
import { loadMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildMileageReport, type ReportDriverSummary } from '@/lib/mileage/report/model'
import { renderMileageReportPdf } from '@/lib/mileage/report/pdf'

export interface ClaimSummaryMileage {
  trips: number
  milesTenths: number
  amountPence: number
  byDriver: ReportDriverSummary[]
  vatPence: number
  vatComplete: boolean
  reportFileName: string
  csvFileName: string
}

interface QuarterMileageFiles {
  csv: { name: string; content: Buffer }
  pdf: { name: string; content: Buffer }
  summary: ClaimSummaryMileage
}

export async function buildQuarterMileageFiles(
  db: SupabaseClient,
  year: number,
  quarter: 1 | 2 | 3 | 4
): Promise<QuarterMileageFiles> {
  const period = quarterPeriod(year, quarter)
  const dataset = await loadMileageReportDataset(db, { from: period.from, to: period.to })
  const model = buildMileageReport(dataset, { period, driverId: null })
  const csvFileName = `Mileage_Q${quarter}_${year}.csv`
  const reportFileName = `Mileage_Report_Q${quarter}_${year}.pdf`

  const csv = buildMileageCsv({
    periodLabel: period.label,
    generatedAt: dataset.generatedAt,
    scopeLines: ['All drivers'],
    trips: dataset.trips,
    totals: model.totals,
    byDriver: model.byDriver,
  })
  const pdf = await renderMileageReportPdf(model)

  return {
    csv: { name: csvFileName, content: csv },
    pdf: { name: reportFileName, content: pdf },
    summary: {
      trips: model.totals.trips,
      milesTenths: model.totals.milesTenths,
      amountPence: model.totals.amountPence,
      byDriver: model.byDriver,
      vatPence: model.vat.totalVatPence,
      vatComplete: model.vat.complete,
      reportFileName,
      csvFileName,
    },
  }
}
