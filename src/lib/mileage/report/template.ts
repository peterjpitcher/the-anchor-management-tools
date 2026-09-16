/**
 * HTML for the mileage claim report (spec 6.2), rendered to PDF by ./pdf.ts.
 *
 * The shared chrome gives it the same header, logo and footer as invoices and statements. Its own
 * CSS is scoped under .mr- classes, so it can never change a selector the other documents share
 * (tests/lib/pdfTemplates.test.ts compares them). Every value is escaped, the logo arrives as a data
 * URI, and a content security policy stops Chromium fetching anything over the network.
 */

import { renderDocumentFooter, renderDocumentHead, renderDocumentHeader } from '@/lib/pdf/document-chrome'
import { formatLongDate } from '@/lib/mileage/periods'
import type { MileageDriverBasis } from './dataset'
import { DRIVER_BASIS_LABELS } from './csv'
import { formatGeneratedAt, formatMilesText, formatPoundsText } from './format'
import type { MileageReportModel, VatExclusionReason } from './model'

export const MILEAGE_REPORT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'"

const DRIVER_BASIS_EXPLANATIONS: Record<MileageDriverBasis, string> = {
  entered: 'chosen when the trip was logged or last edited',
  owner_statement: "set from the owner's statement of 15 September 2026 about who drove which kinds of trip",
  oj_projects: 'synced from OJ Projects, whose trips the owner states are driven by the OJ Projects driver',
}

const VAT_EXCLUSION_LABELS: Record<VatExclusionReason, string> = {
  no_car_recorded: 'no car recorded for this date',
  no_fuel_rate: 'no advisory fuel rate loaded for this date',
}

const BODY_CSS = `    .mr-section { margin: 10px 0; }
    .mr-heading { font-size: 11pt; font-weight: 700; color: #111827; margin: 12px 0 4px; }
    .mr-meta-line { font-size: 9pt; color: #374151; margin: 1px 0; }
    .mr-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 4px 0 8px; }
    .mr-table thead { display: table-header-group; }
    .mr-table tr { page-break-inside: avoid; break-inside: avoid; }
    .mr-table th, .mr-table td { border-bottom: 1px solid #e5e7eb; padding: 3px 4px; text-align: left; vertical-align: top; font-size: 8pt; overflow-wrap: anywhere; }
    .mr-table th { background: #f3f4f6; font-weight: 700; }
    .mr-table .mr-num { text-align: right; white-space: nowrap; }
    .mr-table .mr-total td { font-weight: 700; border-top: 1px solid #374151; }
    .mr-note { font-size: 8pt; color: #374151; margin: 3px 0; }
    .mr-warning { font-size: 8pt; color: #92400e; font-weight: 700; margin: 3px 0; }
`

interface Column {
  label: string
  numeric?: boolean
  width?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function taxYearLabel(taxYearStart: string): string {
  const year = Number(taxYearStart.slice(0, 4))
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`
}

function shortDate(isoDate: string): string {
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`
}

function monthLabel(month: string): string {
  return formatLongDate(`${month}-01`).split(' ').slice(1).join(' ')
}

/** Cells must already be escaped. */
function table(columns: Column[], rows: string[][], totalRow?: string[], rowAttributes?: string[]): string {
  const cell = (tag: 'td' | 'th', value: string, index: number) =>
    `<${tag}${tag === 'th' ? ' scope="col"' : ''}${columns[index].numeric ? ' class="mr-num"' : ''}>${value}</${tag}>`
  const colgroup = columns.some((column) => column.width)
    ? `<colgroup>${columns.map((column) => `<col style="width: ${column.width ?? 'auto'}">`).join('')}</colgroup>`
    : ''
  const head = `<thead><tr>${columns.map((column, index) => cell('th', escapeHtml(column.label), index)).join('')}</tr></thead>`
  const body = rows
    .map((row, rowIndex) => `<tr${rowAttributes?.[rowIndex] ?? ''}>${row.map((value, index) => cell('td', value, index)).join('')}</tr>`)
    .join('')
  const total = totalRow ? `<tr class="mr-total">${totalRow.map((value, index) => cell('td', value, index)).join('')}</tr>` : ''
  return `<table class="mr-table">${colgroup}${head}<tbody>${body}${total}</tbody></table>`
}

function section(title: string, content: string): string {
  return `  <div class="mr-section">\n    <h2 class="mr-heading">${escapeHtml(title)}</h2>\n    ${content}\n  </div>`
}

function notes(model: MileageReportModel): string {
  const recordedOn = formatGeneratedAt(model.generatedAt).split(' at ')[0]
  const basis = (Object.keys(DRIVER_BASIS_LABELS) as MileageDriverBasis[])
    .map((key) => `${escapeHtml(DRIVER_BASIS_LABELS[key])}: ${escapeHtml(DRIVER_BASIS_EXPLANATIONS[key])}`)
    .join('; ')
  return section(
    'Notes',
    [
      "<p class=\"mr-note\">Rates: HMRC approved mileage allowance payments for cars and vans. 45p a mile to 5 April 2026 and 55p from 6 April 2026 for each person's first 10,000 business miles in a tax year, then 25p.</p>",
      '<p class="mr-note">Rounding: each trip is rounded to the penny and every total adds up those amounts, so total miles multiplied by a rate can differ by a few pence.</p>',
      "<p class=\"mr-note\">VAT: one sixth of the fuel element, priced at HMRC's advisory fuel rate for each person's car on the trip date and rounded down. It can only be reclaimed with VAT fuel receipts covering at least each person's fuel element.</p>",
      `<p class="mr-note">How drivers are known: ${basis}.</p>`,
      `<p class="mr-note">Place names and postcodes are as recorded on ${escapeHtml(recordedOn)}.</p>`,
      '<p class="mr-note">This report is claim evidence. It does not record whether anything has been paid.</p>',
    ].join('\n    ')
  )
}

export function renderMileageReportHtml(model: MileageReportModel, options: { logoUrl?: string } = {}): string {
  const { period } = model.scope
  const scopeText = model.scope.driverName ? `${model.scope.driverName} only: a subset of the full claim` : 'All drivers'

  const head = renderDocumentHead({
    titleHtml: escapeHtml(`Mileage claim report, ${period.label}`),
    metaClass: '.report-header',
    numberClass: '.report-period',
    bodyCss: BODY_CSS,
    headExtraHtml: `\n  <meta http-equiv="Content-Security-Policy" content="${MILEAGE_REPORT_CSP}">`,
  })

  const header = renderDocumentHeader({
    logoUrl: options.logoUrl,
    metaClass: 'report-header',
    headingHtml: 'Mileage claim report',
    metaHtml: [
      `      <div class="report-period">${escapeHtml(period.label)}</div>`,
      `      <div class="mr-meta-line">${escapeHtml(scopeText)}</div>`,
      `      <div class="mr-meta-line">Generated ${escapeHtml(formatGeneratedAt(model.generatedAt))}</div>`,
    ].join('\n'),
  })

  const open = `${head}\n<body>\n${header}\n`
  const close = `\n${notes(model)}\n${renderDocumentFooter()}\n</body>\n</html>`

  if (model.totals.trips === 0) {
    const who = model.scope.driverName ? ` for ${escapeHtml(model.scope.driverName)}` : ''
    return `${open}${section(
      'No mileage in this period',
      `<p class="mr-note">No trips are recorded from ${escapeHtml(formatLongDate(period.from))} to ${escapeHtml(formatLongDate(period.to))}${who}.</p>`
    )}${close}`
  }

  const byPerson = table(
    [{ label: 'Person' }, { label: 'Trips', numeric: true }, { label: 'Miles', numeric: true }, { label: 'Claim', numeric: true }],
    model.byDriver.map((row) => [escapeHtml(row.driverName), String(row.trips), formatMilesText(row.milesTenths), formatPoundsText(row.amountPence)]),
    ['Total', String(model.totals.trips), formatMilesText(model.totals.milesTenths), formatPoundsText(model.totals.amountPence)]
  )

  const bands = table(
    [{ label: 'Tax year' }, { label: 'Band' }, { label: 'Rate', numeric: true }, { label: 'Miles', numeric: true }, { label: 'Amount', numeric: true }],
    model.bands.map((row) => [
      taxYearLabel(row.taxYearStart),
      row.band === 'standard' ? 'Up to 10,000 miles' : 'Over 10,000 miles',
      `${row.ratePence}p`,
      formatMilesText(row.milesTenths),
      formatPoundsText(row.amountPence),
    ]),
    ['Total', '', '', formatMilesText(model.totals.milesTenths), formatPoundsText(model.totals.amountPence)]
  )

  const positions = table(
    [{ label: 'Person' }, { label: 'Tax year' }, { label: 'Miles up to' }, { label: 'Miles', numeric: true }, { label: 'Left at the standard rate', numeric: true }],
    model.taxYearPositions.map((row) => [
      escapeHtml(row.driverName),
      `${taxYearLabel(row.taxYearStart)}${row.logStartsPartWay ? ' (log starts 1 January 2024)' : ''}`,
      escapeHtml(formatLongDate(row.cutoffDate)),
      formatMilesText(row.milesTenthsToCutoff),
      formatMilesText(row.standardMilesLeftTenths),
    ])
  )

  const months = table(
    [{ label: 'Month' }, { label: 'Trips', numeric: true }, { label: 'Miles', numeric: true }, { label: 'Amount', numeric: true }],
    model.months.map((row) => [escapeHtml(monthLabel(row.month)), String(row.trips), formatMilesText(row.milesTenths), formatPoundsText(row.amountPence)])
  )

  const vatWarnings = model.vat.complete
    ? ''
    : [
        '<p class="mr-warning">The VAT figure is incomplete: these trips were left out.</p>',
        ...model.vat.rows.flatMap((row) =>
          row.excluded.map(
            (excluded) =>
              `<p class="mr-warning">${escapeHtml(row.driverName)}, ${escapeHtml(formatLongDate(excluded.tripDate))}: ${VAT_EXCLUSION_LABELS[excluded.reason]}.</p>`
          )
        ),
      ].join('\n    ')

  const vat = `${table(
    [{ label: 'Person' }, { label: 'Trips priced', numeric: true }, { label: 'Miles priced', numeric: true }, { label: 'Fuel element', numeric: true }, { label: 'VAT reclaimable', numeric: true }],
    model.vat.rows.map((row) => [escapeHtml(row.driverName), String(row.pricedTrips), formatMilesText(row.pricedMilesTenths), formatPoundsText(row.fuelPence), formatPoundsText(row.vatPence)]),
    ['Total', '', '', formatPoundsText(model.vat.totalFuelPence), formatPoundsText(model.vat.totalVatPence)]
  )}${vatWarnings ? `\n    ${vatWarnings}` : ''}`

  const oj = model.ojProjects
    ? section(
        'OJ Projects client work',
        `<p class="mr-note">${model.ojProjects.trips} trip${model.ojProjects.trips === 1 ? '' : 's'} (${formatMilesText(model.ojProjects.milesTenths)} miles, ${formatPoundsText(model.ojProjects.amountPence)}) were Orange Jelly client work recorded in OJ Projects.</p>`
      )
    : ''

  const log = table(
    [
      { label: 'Date', width: '9%' },
      { label: 'Driver', width: '10%' },
      { label: 'Basis', width: '12%' },
      { label: 'Reason', width: '17%' },
      { label: 'Route', width: '30%' },
      { label: 'Miles', numeric: true, width: '6%' },
      { label: 'Rate', numeric: true, width: '7%' },
      { label: 'Amount', numeric: true, width: '9%' },
    ],
    model.log.map((row) => [
      shortDate(row.tripDate),
      escapeHtml(row.driverName),
      escapeHtml(DRIVER_BASIS_LABELS[row.basis]),
      escapeHtml(row.reason),
      escapeHtml(row.route),
      formatMilesText(row.milesTenths),
      escapeHtml(row.rateLabel),
      formatPoundsText(row.amountPence),
    ]),
    ['Total', '', '', '', '', formatMilesText(model.totals.milesTenths), '', formatPoundsText(model.totals.amountPence)],
    model.log.map((row) => ` data-trip-id="${escapeHtml(row.tripId)}"`)
  )

  const places = table(
    [{ label: 'Place' }, { label: 'Postcode' }, { label: 'Trips in period', numeric: true }],
    model.places.map((row) => [escapeHtml(row.name), escapeHtml(row.postcode ?? 'Not recorded'), String(row.trips)])
  )

  return `${open}${[
    section('Claim by person', byPerson),
    section('Rate breakdown', bands),
    section('Tax year position', positions),
    section('Month by month', months),
    section('VAT on fuel', vat),
    oj,
    section('Trip log', log),
    section('Places visited', `${places}\n    <p class="mr-note">Trip counts overlap on multi-stop trips, so they are not added up.</p>`),
  ]
    .filter(Boolean)
    .join('\n')}${close}`
}
