/**
 * Renders the mileage claim report from synthetic data to a local PDF, for layout checks before a
 * release. Read-only: no database and no network. Usage:
 *   npx tsx scripts/mileage/render-report-sample.ts --trips 180 --output /tmp/mileage-sample.pdf
 */

import { writeFileSync } from 'node:fs'
import { buildDatasetJson } from '../../tests/fixtures/mileage/reportDataset'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildMileageReport } from '@/lib/mileage/report/model'
import { quarterPeriod } from '@/lib/mileage/periods'
import { renderMileageReportPdf } from '@/lib/mileage/report/pdf'

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function main(): Promise<void> {
  const tripCount = Number(argument('trips', '3'))
  const output = argument('output', '/tmp/mileage-sample.pdf')
  const base = buildDatasetJson()
  const trips = Array.from({ length: tripCount }, (_, index) => ({
    ...base.trips[index % base.trips.length],
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    description: `Trip ${index + 1}`,
  }))
  const model = buildMileageReport(parseMileageReportDataset({ ...base, trips }), { period: quarterPeriod(2026, 2), driverId: null })
  writeFileSync(output, await renderMileageReportPdf(model))
  console.warn(`Wrote ${output}: ${model.totals.trips} trips`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
