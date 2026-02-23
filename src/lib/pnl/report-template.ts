import { COMPANY_DETAILS } from '@/lib/company-details'
import {
  formatPnlMetricValue,
  type PnlReportRow,
  type PnlReportViewModel,
} from '@/lib/pnl/report-view-model'

type PnlReportTemplateOptions = {
  logoUrl?: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatVariance(row: PnlReportRow): string {
  return formatPnlMetricValue(row.variance, row.format)
}

function varianceClass(value: number | null, invert = false): string {
  if (value === null) return 'variance-neutral'
  const positive = value >= 0
  if (invert) {
    return positive ? 'variance-negative' : 'variance-positive'
  }
  return positive ? 'variance-positive' : 'variance-negative'
}

function formatSectionHeading(sectionKey: string, sectionLabel: string, timeframeLabel: string): string {
  if (sectionKey === 'sales' || sectionKey === 'expenses') {
    return `${sectionLabel} - ${timeframeLabel.toUpperCase()} VS. SHADOW P&L`
  }
  return sectionLabel
}

export function generatePnlReportHTML(
  viewModel: PnlReportViewModel,
  options: PnlReportTemplateOptions = {}
): string {
  const logoMarkup = options.logoUrl
    ? `<img class="brand-logo" src="${escapeHtml(options.logoUrl)}" alt="${escapeHtml(COMPANY_DETAILS.tradingName)} logo" />`
    : `<div class="brand-wordmark">${escapeHtml(COMPANY_DETAILS.tradingName)}</div>`

  const sectionsMarkup = viewModel.sections
    .map((section) => {
      const rowsMarkup = section.rows
        .map((row) => {
          const detailMarkup = row.detailLines.length
            ? `<div class="detail-lines">${row.detailLines
                .map((line) => `<div>${escapeHtml(line)}</div>`)
                .join('')}</div>`
            : ''

          return `
            <tr>
              <td class="metric-cell">${escapeHtml(row.label)}</td>
              <td class="number-cell">${formatPnlMetricValue(row.actual, row.format)}</td>
              <td class="number-cell">${formatPnlMetricValue(row.annualTarget, row.format)}</td>
              <td class="number-cell">
                <div class="target-cell">
                  <div>${formatPnlMetricValue(row.timeframeTarget, row.format)}</div>
                  ${detailMarkup}
                </div>
              </td>
              <td class="number-cell">
                <span class="variance-pill ${varianceClass(row.variance)}">${formatVariance(row)}</span>
              </td>
            </tr>
          `
        })
        .join('')
      const subtotalMarkup = section.subtotal
        ? `
            <tr class="subtotal-row">
              <td class="metric-cell">${escapeHtml(section.subtotal.label)}</td>
              <td class="number-cell">${formatPnlMetricValue(section.subtotal.actual, section.subtotal.format)}</td>
              <td class="number-cell">${formatPnlMetricValue(section.subtotal.annualTarget, section.subtotal.format)}</td>
              <td class="number-cell">${formatPnlMetricValue(section.subtotal.timeframeTarget, section.subtotal.format)}</td>
              <td class="number-cell">
                <span class="variance-pill ${varianceClass(section.subtotal.variance, section.subtotal.invertVariance)}">
                  ${formatPnlMetricValue(section.subtotal.variance, section.subtotal.format)}
                </span>
              </td>
            </tr>
          `
        : ''

      return `
        <section class="metric-section">
          <h2>${escapeHtml(formatSectionHeading(section.key, section.label, viewModel.timeframeLabel))}</h2>
          <table class="metric-table">
            <thead>
              <tr>
                <th class="metric-cell">Metric</th>
                <th class="number-cell">Actual</th>
                <th class="number-cell">Annual</th>
                <th class="number-cell">P&amp;L Target</th>
                <th class="number-cell">Var</th>
              </tr>
            </thead>
            <tbody>
              ${rowsMarkup}
              ${subtotalMarkup}
            </tbody>
          </table>
        </section>
      `
    })
    .join('')

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(COMPANY_DETAILS.tradingName)} P&L Report</title>
        <style>
          * { box-sizing: border-box; }

          @page {
            size: A4;
            margin: 12mm;
          }

          body {
            margin: 0;
            color: #0f172a;
            font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
            font-size: 11px;
            line-height: 1.45;
            background: #ffffff;
          }

          .page {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .report-header {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 10px 12px;
            display: flex;
            justify-content: space-between;
            gap: 16px;
            background: #ffffff;
          }

          .brand {
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .brand-logo {
            height: 38px;
            width: auto;
            object-fit: contain;
          }

          .brand-wordmark {
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.06em;
          }

          .title {
            margin: 0;
            font-size: 20px;
            line-height: 1.15;
            letter-spacing: 0.02em;
          }

          .subtitle {
            margin: 4px 0 0;
            color: #334155;
            font-size: 12px;
          }

          .meta {
            min-width: 220px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 10px;
            background: #ffffff;
          }

          .meta-grid {
            display: grid;
            gap: 4px;
            margin: 0;
            grid-template-columns: 1fr 1fr;
          }

          .meta-grid dt {
            color: #475569;
            font-weight: 600;
          }

          .meta-grid dd {
            margin: 0;
            text-align: right;
            font-weight: 600;
          }

          .summary {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 8px 10px;
            background: #f8fafc;
          }

          .summary h2 {
            margin: 0 0 6px;
            font-size: 12px;
            letter-spacing: 0.02em;
            text-transform: uppercase;
          }

          .summary-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
          }

          .summary-card {
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 8px;
            background: #ffffff;
          }

          .summary-card h3 {
            margin: 0 0 6px;
            font-size: 11px;
            color: #334155;
          }

          .summary-row {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 2px;
          }

          .summary-row span:first-child {
            color: #475569;
          }

          .summary-row span:last-child {
            font-weight: 600;
          }

          .metric-section {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            overflow: hidden;
          }

          .metric-section h2 {
            margin: 0;
            padding: 7px 10px;
            background: #f1f5f9;
            border-bottom: 1px solid #e2e8f0;
            font-size: 12px;
            letter-spacing: 0.02em;
            text-transform: uppercase;
          }

          .metric-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          .metric-table th,
          .metric-table td {
            border-bottom: 1px solid #f1f5f9;
            padding: 5px 6px;
            vertical-align: top;
          }

          .metric-table thead th {
            background: #f8fafc;
            color: #475569;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.02em;
          }

          .metric-table tbody tr:last-child td {
            border-bottom: none;
          }

          .subtotal-row td {
            background: #eef2ff;
            border-top: 1px solid #dbeafe;
            border-bottom: none;
            font-weight: 700;
          }

          .metric-cell {
            width: 34%;
            text-align: left;
            font-weight: 600;
          }

          .number-cell {
            text-align: right;
            white-space: nowrap;
            width: 16.5%;
          }

          .target-cell {
            display: inline-flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 2px;
          }

          .detail-lines {
            color: #64748b;
            font-size: 8px;
            line-height: 1.35;
            text-align: right;
          }

          .variance-pill {
            display: inline-flex;
            border-radius: 999px;
            padding: 1px 7px;
            font-size: 10px;
            font-weight: 700;
          }

          .variance-positive {
            background: #dcfce7;
            color: #166534;
          }

          .variance-negative {
            background: #fee2e2;
            color: #991b1b;
          }

          .variance-neutral {
            background: #e2e8f0;
            color: #334155;
          }

          .notes {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px 10px;
            background: #f8fafc;
          }

          .notes h2 {
            margin: 0 0 4px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.03em;
          }

          .notes p {
            margin: 0;
            color: #334155;
            font-size: 10px;
          }
        </style>
      </head>
      <body>
        <main class="page">
          <header class="report-header">
            <div>
              <div class="brand">
                ${logoMarkup}
                <div>
                  <h1 class="title">Profit and Loss Report</h1>
                  <p class="subtitle">${escapeHtml(COMPANY_DETAILS.tradingName)} · Internal management report · Targets from Shadow P&amp;L</p>
                </div>
              </div>
            </div>
            <aside class="meta">
              <dl class="meta-grid">
                <dt>Period</dt>
                <dd>${escapeHtml(viewModel.timeframeLabel)}</dd>
                <dt>Generated</dt>
                <dd>${escapeHtml(viewModel.generatedAtLabel)}</dd>
                <dt>Prepared for</dt>
                <dd>${escapeHtml(COMPANY_DETAILS.tradingName)}</dd>
                <dt>Report type</dt>
                <dd>P&amp;L Snapshot</dd>
              </dl>
            </aside>
          </header>

          <section class="summary">
            <h2>Totals Summary</h2>
            <div class="summary-grid">
              <article class="summary-card">
                <h3>Revenue</h3>
                <div class="summary-row"><span>Actual</span><span>${formatPnlMetricValue(viewModel.summary.revenueActual)}</span></div>
                <div class="summary-row"><span>P&amp;L Target</span><span>${formatPnlMetricValue(viewModel.summary.revenueTarget)}</span></div>
                <div class="summary-row"><span>Variance</span><span class="${varianceClass(viewModel.summary.revenueVariance)}">${formatPnlMetricValue(viewModel.summary.revenueVariance)}</span></div>
              </article>
              <article class="summary-card">
                <h3>Expenses</h3>
                <div class="summary-row"><span>Actual</span><span>${formatPnlMetricValue(viewModel.summary.expenseActual)}</span></div>
                <div class="summary-row"><span>P&amp;L Target</span><span>${formatPnlMetricValue(viewModel.summary.expenseTarget)}</span></div>
                <div class="summary-row"><span>Variance</span><span class="${varianceClass(viewModel.summary.expenseVariance, true)}">${formatPnlMetricValue(viewModel.summary.expenseVariance)}</span></div>
              </article>
              <article class="summary-card">
                <h3>Operating profit</h3>
                <div class="summary-row"><span>Actual</span><span>${formatPnlMetricValue(viewModel.summary.operatingProfitActual)}</span></div>
                <div class="summary-row"><span>P&amp;L Target</span><span>${formatPnlMetricValue(viewModel.summary.operatingProfitTarget)}</span></div>
                <div class="summary-row"><span>Variance</span><span class="${varianceClass(viewModel.summary.operatingProfitVariance)}">${formatPnlMetricValue(viewModel.summary.operatingProfitVariance)}</span></div>
              </article>
            </div>
          </section>

          ${sectionsMarkup}

          <section class="notes">
            <h2>Notes & assumptions</h2>
            <p>
              This report is generated from saved database values at the timestamp shown above. Target values are sourced from the
              Shadow P&amp;L. Currency targets are pro-rated from annual targets by timeframe days (30/90/365). Percentage targets
              remain unchanged by timeframe.
            </p>
          </section>
        </main>
      </body>
    </html>
  `
}
