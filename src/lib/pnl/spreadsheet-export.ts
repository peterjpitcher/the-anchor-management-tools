import ExcelJS from 'exceljs'
import { formatPnlMetricValue, type PnlReportViewModel } from '@/lib/pnl/report-view-model'

function addKeyValueRows(
  sheet: ExcelJS.Worksheet,
  rows: Array<[string, string | number | null]>
) {
  rows.forEach(([label, value]) => {
    sheet.addRow([label, value ?? ''])
  })
}

export async function generatePnlSpreadsheetBuffer(viewModel: PnlReportViewModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Anchor Management Tools'
  workbook.created = new Date(viewModel.generatedAtIso)

  const summary = workbook.addWorksheet('Summary')
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 34 },
    { header: 'Value', key: 'value', width: 22 },
  ]

  addKeyValueRows(summary, [
    ['Period', viewModel.timeframeLabel],
    ['Generated', viewModel.generatedAtLabel],
    ['Health', viewModel.healthLabel],
    ['Actual income', formatPnlMetricValue(viewModel.summary.revenueActual)],
    ['Greene King target income', formatPnlMetricValue(viewModel.summary.revenueTarget)],
    ['Revenue variance', formatPnlMetricValue(viewModel.summary.revenueVariance)],
    ['Actual gross profit', formatPnlMetricValue(viewModel.summary.grossProfitActual)],
    ['Greene King gross profit', formatPnlMetricValue(viewModel.summary.grossProfitTarget)],
    ['Gross profit variance', formatPnlMetricValue(viewModel.summary.grossProfitVariance)],
    ['Actual expenses', formatPnlMetricValue(viewModel.summary.expenseActual)],
    ['Greene King target expenses', formatPnlMetricValue(viewModel.summary.expenseTarget)],
    ['Expense variance', formatPnlMetricValue(viewModel.summary.expenseVariance)],
    ['Operating profit before rent', formatPnlMetricValue(viewModel.summary.operatingProfitActual)],
    ['Greene King operating profit before rent', formatPnlMetricValue(viewModel.summary.operatingProfitTarget)],
    ['Operating profit variance', formatPnlMetricValue(viewModel.summary.operatingProfitVariance)],
  ])

  if (viewModel.dataQualityWarnings.length) {
    summary.addRow([])
    summary.addRow(['Data confidence warnings'])
    viewModel.dataQualityWarnings.forEach((warning) => summary.addRow([warning]))
  }

  const detail = workbook.addWorksheet('Actual vs GK')
  detail.columns = [
    { header: 'Section', key: 'section', width: 26 },
    { header: 'Metric', key: 'metric', width: 42 },
    { header: 'Actual', key: 'actual', width: 18 },
    { header: 'Annual target', key: 'annualTarget', width: 18 },
    { header: 'Period target', key: 'periodTarget', width: 18 },
    { header: 'Variance', key: 'variance', width: 18 },
    { header: 'Notes', key: 'notes', width: 60 },
  ]

  viewModel.sections.forEach((section) => {
    section.rows.forEach((row) => {
      detail.addRow({
        section: section.label,
        metric: row.label,
        actual: formatPnlMetricValue(row.actual, row.format),
        annualTarget: formatPnlMetricValue(row.annualTarget, row.format),
        periodTarget: formatPnlMetricValue(row.timeframeTarget, row.format),
        variance: formatPnlMetricValue(row.variance, row.format),
        notes: row.detailLines.join(' | '),
      })
    })

    if (section.subtotal) {
      detail.addRow({
        section: section.label,
        metric: section.subtotal.label,
        actual: formatPnlMetricValue(section.subtotal.actual, section.subtotal.format),
        annualTarget: formatPnlMetricValue(section.subtotal.annualTarget, section.subtotal.format),
        periodTarget: formatPnlMetricValue(section.subtotal.timeframeTarget, section.subtotal.format),
        variance: formatPnlMetricValue(section.subtotal.variance, section.subtotal.format),
        notes: 'Subtotal',
      })
    }
  })

  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
