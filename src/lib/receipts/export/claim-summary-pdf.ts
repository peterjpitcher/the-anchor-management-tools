/**
 * Claim Summary PDF generation for quarterly export.
 *
 * Generates a cover sheet PDF using pdfkit, streamed directly into the archiver.
 * Summarises mileage, expenses, and MGD for the quarter.
 */

import PDFDocument from 'pdfkit'
import { PassThrough } from 'stream'
import type { Archiver } from 'archiver'
import { STANDARD_RATE, REDUCED_RATE } from '@/lib/mileage/hmrcRates'
import type { MileageSummary } from './mileage-csv'
import type { ExpensesSummary } from './expenses-csv'
import type { MgdSummary } from './mgd-csv'
import { quarterMonthRange } from './csv-helpers'

interface ClaimSummaryInput {
  year: number
  quarter: number
  mileage: MileageSummary
  expenses: ExpensesSummary
  mgd: MgdSummary
  mgdFileName: string
  hasExpenseImages: boolean
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
      .fillColor('#666666')
      .text(`Generated: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}`, {
        align: 'center',
      })
      .fillColor('#000000')
      .moveDown(1.5)

    // ---- Section 1: Mileage ----
    sectionHeading(doc, '1. Mileage')

    addRow(doc, 'Total trips', String(mileage.totalTrips))
    addRow(doc, 'Total miles', formatMiles(mileage.totalMiles))

    if (mileage.totalMilesAtStandard > 0) {
      addRow(
        doc,
        `Miles @ \u00A3${STANDARD_RATE.toFixed(2)}`,
        formatMiles(mileage.totalMilesAtStandard)
      )
    }
    if (mileage.totalMilesAtReduced > 0) {
      addRow(
        doc,
        `Miles @ \u00A3${REDUCED_RATE.toFixed(2)}`,
        formatMiles(mileage.totalMilesAtReduced)
      )
    }

    addRow(doc, 'Tax year cumulative miles', formatMiles(mileage.taxYearTotalMiles))
    addRow(doc, 'Mileage claim total', formatGbp(mileage.totalClaimAmount), true)
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
      .fillColor('#666666')
      .text(
        'For information only \u2014 MGD is paid directly to HMRC and is not included in the claim total.',
        { width: 450 }
      )
      .fillColor('#000000')
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
      .strokeColor('#333333')
      .lineWidth(1)
      .stroke()
      .moveDown(0.8)

    doc.fontSize(14).font('Helvetica-Bold').text('Amount to Transfer to Owner', { align: 'left' })
    doc.moveDown(0.5)

    doc.fontSize(11).font('Helvetica')
    addRow(doc, 'Mileage', formatGbp(mileage.totalClaimAmount))
    addRow(doc, 'Expenses', formatGbp(expenses.grossTotal))

    doc.moveDown(0.3)

    const grandTotal = mileage.totalClaimAmount + expenses.grossTotal
    doc
      .fontSize(14)
      .font('Helvetica-Bold')
      .text(`Grand Total: ${formatGbp(grandTotal)}`, { align: 'right' })
    doc.moveDown(1.5)

    // ---- Supporting documents note ----
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Supporting documents included in this bundle:', { continued: false })
      .moveDown(0.3)

    const docs = [
      `Receipts_Q${quarter}_${year}.csv`,
      `Mileage_Q${quarter}_${year}.csv`,
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

    doc.fillColor('#000000')

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

function addRow(doc: PDFKit.PDFDocument, label: string, value: string, bold = false): void {
  const startX = 50
  const valueX = 350

  if (bold) {
    doc.font('Helvetica-Bold')
  }

  doc.text(label, startX, doc.y, { continued: false, width: 280 })
  // Move back to same line for value
  doc.text(value, valueX, doc.y - doc.currentLineHeight(), { align: 'right', width: 195 })

  if (bold) {
    doc.font('Helvetica')
  }
}

function formatGbp(amount: number): string {
  return `\u00A3${amount.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatMiles(miles: number): string {
  return miles.toLocaleString('en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}
