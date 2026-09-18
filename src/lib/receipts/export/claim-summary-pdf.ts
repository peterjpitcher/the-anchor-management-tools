/**
 * Claim Summary PDF generation for quarterly export.
 *
 * Generates a cover sheet PDF using pdfkit, streamed directly into the archiver.
 * Page 1: summary totals for mileage, expenses, and MGD.
 * Mileage trip detail is in Mileage_Report_Q{q}_{y}.pdf, not here.
 * Next page(s): expenses transaction detail table.
 * Final page(s): MGD collection detail table.
 */

import PDFDocument from 'pdfkit'
import { PassThrough } from 'stream'
import type { Archiver } from 'archiver'
import { STAFF } from '@/lib/brand/palette'
import { formatMilesText, formatPoundsText } from '@/lib/mileage/report/format'
import type { ClaimSummaryMileage } from './mileage-files'
import type { ExpensesSummary } from './expenses-csv'
import type { ExpenseRow } from './expenses-csv'
import type { MgdSummary } from './mgd-csv'
import type { MgdCollectionRow } from './mgd-csv'
import { quarterMonthRange } from './csv-helpers'

interface ClaimSummaryInput {
  year: number
  quarter: number
  /** Null when the person exporting has no mileage access, so the pack holds no mileage files. */
  mileage: ClaimSummaryMileage | null
  expenses: ExpensesSummary
  mgd: MgdSummary
  mgdFileName: string
  hasExpenseImages: boolean
  expenseRows: ExpenseRow[]
  mgdRows: MgdCollectionRow[]
}

interface TableColumn {
  header: string
  width: number
  align: 'left' | 'right'
}

interface TableOptions {
  title: string
  columns: TableColumn[]
  rows: string[][]
  totalRow?: string[]
}

interface SummaryRow {
  label: string
  value: string
  bold?: boolean
}

/** Section 1 (spec 6.4): the claim per person, the VAT figure and where the trips are listed. */
export function mileageSummaryRows(mileage: ClaimSummaryMileage | null): SummaryRow[] {
  if (!mileage) return [{ label: 'Mileage', value: 'Not included (no mileage access)' }]
  return [
    { label: 'Total trips', value: String(mileage.trips) },
    { label: 'Total miles', value: formatMilesText(mileage.milesTenths) },
    ...mileage.byDriver.map((driver) => ({
      label: `${driver.driverName}: ${driver.trips} ${driver.trips === 1 ? 'trip' : 'trips'}, ${formatMilesText(driver.milesTenths)} miles`,
      value: formatPoundsText(driver.amountPence),
    })),
    {
      label: mileage.vatComplete ? 'VAT reclaimable on fuel' : 'VAT reclaimable on fuel (incomplete, see the report)',
      value: formatPoundsText(mileage.vatPence),
    },
    { label: 'Mileage claim total', value: formatPoundsText(mileage.amountPence), bold: true },
    { label: 'Trip detail', value: mileage.reportFileName },
  ]
}

/** "Claimed for this quarter": mileage per person, expenses and the total, added up in pence. */
export function claimedForQuarterRows(
  mileage: ClaimSummaryMileage | null,
  expensesGrossTotal: number
): { rows: SummaryRow[]; total: string } {
  const expensesPence = Math.round(expensesGrossTotal * 100)
  const rows: SummaryRow[] = [
    ...(mileage?.byDriver ?? []).map((driver) => ({
      label: `Mileage: ${driver.driverName}`,
      value: formatPoundsText(driver.amountPence),
    })),
    { label: 'Expenses', value: formatPoundsText(expensesPence) },
  ]
  return { rows, total: `Total claimed: ${formatPoundsText((mileage?.amountPence ?? 0) + expensesPence)}` }
}

/**
 * Generates the Claim Summary PDF and pipes it into the archiver.
 * Returns when the PDF is fully written.
 */
export async function appendClaimSummaryPdf(
  archive: Archiver,
  input: ClaimSummaryInput
): Promise<void> {
  const { year, quarter, mileage, expenses, mgd, mgdFileName, hasExpenseImages } = input

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Claim Summary Q${quarter} ${year}`,
        Author: 'Anchor Management Tools',
        Subject: 'Quarterly Financial Claims Summary',
      },
    })

    const passthrough = new PassThrough()

    doc.pipe(passthrough)

    archive.append(passthrough, {
      name: `Claim_Summary_Q${quarter}_${year}.pdf`,
    })

    passthrough.on('error', reject)
    doc.on('error', reject)

    // ---- Header ----
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('The Anchor, Stanwell Moor Village', { align: 'center' })
      .moveDown(0.3)

    doc
      .fontSize(14)
      .font('Helvetica')
      .text('Quarterly Financial Claims Summary', { align: 'center' })
      .moveDown(0.3)

    const monthRange = quarterMonthRange(quarter)
    doc
      .fontSize(12)
      .text(`Q${quarter} ${year} (${monthRange})`, { align: 'center' })
      .moveDown(0.3)

    doc
      .fontSize(9)
      .fillColor(STAFF.textMuted)
      .text(`Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}`, {
        align: 'center',
      })
      .fillColor(STAFF.text)
      .moveDown(1.5)

    // ---- Section 1: Mileage ----
    sectionHeading(doc, '1. Mileage')

    for (const row of mileageSummaryRows(mileage)) {
      addRow(doc, row.label, row.value, row.bold)
    }
    doc.moveDown(1)

    // ---- Section 2: Expenses ----
    sectionHeading(doc, '2. Expenses (Petty Cash)')

    addRow(doc, 'Total entries', String(expenses.totalEntries))
    addRow(doc, 'Gross total', formatGbp(expenses.grossTotal))
    addRow(doc, 'VAT reclaimable', formatGbp(expenses.vatTotal))
    addRow(doc, 'Expenses claim total', formatGbp(expenses.grossTotal), true)
    doc.moveDown(1)

    // ---- Section 3: MGD ----
    sectionHeading(doc, '3. Machine Games Duty (Informational)')

    doc
      .fontSize(9)
      .fillColor(STAFF.textMuted)
      .text(
        'For information only \u2014 MGD is paid directly to HMRC and is not included in the claim total.',
        { width: 495 }
      )
      .fillColor(STAFF.text)
      .moveDown(0.5)

    addRow(doc, 'Period', mgd.periodLabel)
    addRow(doc, 'Collections in period', String(mgd.totalCollections))
    addRow(doc, 'Total net takings', formatGbp(mgd.totalNetTake))
    addRow(doc, 'MGD due (20%)', formatGbp(mgd.totalMgd))
    addRow(doc, 'VAT on supplier', formatGbp(mgd.totalVatOnSupplier))
    doc.moveDown(1.5)

    // ---- Footer: Amount to Transfer ----
    doc
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .strokeColor(STAFF.text)
      .lineWidth(1)
      .stroke()
      .moveDown(0.8)

    doc.fontSize(14).font('Helvetica-Bold').text('Claimed for this quarter', { align: 'left' })
    doc.moveDown(0.5)

    doc.fontSize(11).font('Helvetica')
    const claimed = claimedForQuarterRows(mileage, expenses.grossTotal)
    for (const row of claimed.rows) {
      addRow(doc, row.label, row.value)
    }

    doc.moveDown(0.3)
    doc.fontSize(14).font('Helvetica-Bold').text(claimed.total, { align: 'right' })
    doc.font('Helvetica')

    doc.moveDown(1.5)

    // ---- Supporting documents note ----
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor(STAFF.textMuted)
      .text('Supporting documents included in this bundle:', { continued: false })
      .moveDown(0.3)

    const docs = [
      `Receipts_Q${quarter}_${year}.csv`,
      ...(mileage ? [mileage.csvFileName, mileage.reportFileName] : []),
      `Expenses_Q${quarter}_${year}.csv`,
      mgdFileName,
    ]
    if (hasExpenseImages) {
      docs.push('expense-receipts/ (folder)')
    }
    docs.push('receipts/ (folder)')

    for (const docName of docs) {
      doc.text(`  \u2022 ${docName}`)
    }

    doc.fillColor(STAFF.text)

    // ---- Detail pages ----

    // Expenses detail
    const expenseTableRows = input.expenseRows.map(exp => [
      formatDateDdMmYyyy(exp.expense_date),
      exp.company_ref,
      exp.justification,
      Number(exp.amount).toFixed(2),
      exp.vat_applicable ? Number(exp.vat_amount).toFixed(2) : '\u2014',
    ])

    drawTable(doc, {
      title: 'Expenses \u2014 Transaction Detail',
      columns: [
        { header: 'Date', width: 65, align: 'left' },
        { header: 'Company', width: 110, align: 'left' },
        { header: 'Justification', width: 160, align: 'left' },
        { header: 'Amount (\u00A3)', width: 80, align: 'right' },
        { header: 'VAT (\u00A3)', width: 80, align: 'right' },
      ],
      rows: expenseTableRows,
      totalRow: [
        'Total',
        '',
        '',
        formatGbp(expenses.grossTotal),
        formatGbp(expenses.vatTotal),
      ],
    })

    // MGD detail
    const mgdTableRows = input.mgdRows.map(c => [
      formatDateDdMmYyyy(c.collection_date),
      Number(c.net_take).toFixed(2),
      Number(c.mgd_amount).toFixed(2),
      Number(c.vat_on_supplier).toFixed(2),
    ])

    drawTable(doc, {
      title: 'MGD \u2014 Collection Detail',
      columns: [
        { header: 'Date', width: 120, align: 'left' },
        { header: 'Net Take (\u00A3)', width: 125, align: 'right' },
        { header: 'MGD 20% (\u00A3)', width: 125, align: 'right' },
        { header: 'VAT on Supplier (\u00A3)', width: 125, align: 'right' },
      ],
      rows: mgdTableRows,
      totalRow: [
        'Total',
        formatGbp(mgd.totalNetTake),
        formatGbp(mgd.totalMgd),
        formatGbp(mgd.totalVatOnSupplier),
      ],
    })

    // Finish the PDF
    doc.end()

    // Wait for the stream to finish
    passthrough.on('end', resolve)
  })
}

// ---- Layout helpers ----

function sectionHeading(doc: PDFKit.PDFDocument, text: string): void {
  doc
    .fontSize(13)
    .font('Helvetica-Bold')
    .text(text)
    .moveDown(0.4)
  doc.font('Helvetica').fontSize(11)
}

/**
 * Renders a label+value row with both items on the same y coordinate.
 * Uses explicit y tracking to avoid pdfkit's line-height quirks.
 */
function addRow(doc: PDFKit.PDFDocument, label: string, value: string, bold = false): void {
  const labelX = 50
  const valueX = 545
  const y = doc.y

  if (bold) doc.font('Helvetica-Bold')

  doc.text(label, labelX, y, { width: 300, continued: false })
  // Reset y to the same line for the value
  doc.y = y
  doc.text(value, labelX, y, { width: valueX - labelX, align: 'right' })

  if (bold) doc.font('Helvetica')
}

/**
 * Renders a full-width table on a new page with optional total row.
 * Automatically paginates by checking remaining page space before each row.
 */
function drawTable(doc: PDFKit.PDFDocument, options: TableOptions): void {
  const { title, columns, rows, totalRow } = options
  const startX = 50
  const pageWidth = 495 // 545 - 50
  const rowHeight = 18
  const headerHeight = 22
  const pageBottom = 750 // leave bottom margin on A4

  // Each detail section starts on a fresh page
  doc.addPage()
  doc.fontSize(13).font('Helvetica-Bold').text(title, startX, 50)
  doc.moveDown(0.6)

  function drawHeaderRow(): void {
    const y = doc.y
    // Header background
    doc.rect(startX, y, pageWidth, headerHeight).fill(STAFF.surfaceHover)
    doc.fillColor(STAFF.text).fontSize(8).font('Helvetica-Bold')

    let x = startX
    for (const col of columns) {
      const textX = col.align === 'right' ? x : x + 4
      const textW = col.align === 'right' ? col.width - 4 : col.width - 8
      doc.text(col.header, textX, y + 6, { width: textW, align: col.align })
      x += col.width
    }

    doc.y = y + headerHeight
    doc.fillColor(STAFF.text)
  }

  drawHeaderRow()

  // Data rows
  doc.font('Helvetica').fontSize(8)

  for (const row of rows) {
    if (doc.y + rowHeight > pageBottom) {
      doc.addPage()
      doc.y = 50
      drawHeaderRow()
      doc.font('Helvetica').fontSize(8)
    }

    const y = doc.y
    let x = startX

    // Subtle row separator
    doc
      .moveTo(startX, y)
      .lineTo(startX + pageWidth, y)
      .strokeColor(STAFF.border)
      .lineWidth(0.5)
      .stroke()

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      const cellValue = row[i] ?? ''
      const textX = col.align === 'right' ? x : x + 4
      const textW = col.align === 'right' ? col.width - 4 : col.width - 8
      doc.fillColor(STAFF.text).text(cellValue, textX, y + 4, { width: textW, align: col.align })
      x += col.width
    }

    doc.y = y + rowHeight
  }

  // Total row
  if (totalRow) {
    const y = doc.y
    doc
      .moveTo(startX, y)
      .lineTo(startX + pageWidth, y)
      .strokeColor(STAFF.text)
      .lineWidth(1)
      .stroke()

    doc.font('Helvetica-Bold').fontSize(8)
    let x = startX

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i]
      const cellValue = totalRow[i] ?? ''
      const textX = col.align === 'right' ? x : x + 4
      const textW = col.align === 'right' ? col.width - 4 : col.width - 8
      doc.fillColor(STAFF.text).text(cellValue, textX, y + 4, { width: textW, align: col.align })
      x += col.width
    }

    doc.y = y + rowHeight
    doc.font('Helvetica')
  }
}

/**
 * Formats a date string (YYYY-MM-DD) as DD/MM/YYYY.
 */
function formatDateDdMmYyyy(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00Z')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function formatGbp(amount: number): string {
  return `\u00A3${amount.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
