import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { escapeHtml } from '@/lib/cron/alerting'
import { COMPANY_DETAILS } from '@/lib/company-details'
import type { StatementTransaction } from '@/app/actions/oj-projects/client-statement'

export interface StatementPDFInput {
  vendorName: string
  periodFrom: string
  periodTo: string
  openingBalance: number
  transactions: StatementTransaction[]
  closingBalance: number
}

function formatCurrency(amount: number): string {
  return `£${Math.abs(amount).toFixed(2)}`
}

function formatStatementDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function generateStatementHTML(input: StatementPDFInput): string {
  const vendorName = escapeHtml(input.vendorName)
  const periodFrom = escapeHtml(formatStatementDate(input.periodFrom))
  const periodTo = escapeHtml(formatStatementDate(input.periodTo))

  const transactionRows = input.transactions
    .map((txn) => {
      const debitCell = txn.debit !== null ? formatCurrency(txn.debit) : ''
      const creditCell = txn.credit !== null ? formatCurrency(txn.credit) : ''
      const balanceCell = txn.balance < 0
        ? `<span style="color: #dc2626;">(${formatCurrency(txn.balance)})</span>`
        : formatCurrency(txn.balance)

      return `
        <tr style="page-break-inside: avoid;">
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${escapeHtml(formatStatementDate(txn.date))}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${escapeHtml(txn.description)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;">${escapeHtml(txn.reference)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right;">${debitCell}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right;">${creditCell}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right; font-weight: 500;">${balanceCell}</td>
        </tr>`
    })
    .join('\n')

  const closingBalanceDisplay = input.closingBalance < 0
    ? `Credit Balance: ${formatCurrency(input.closingBalance)}`
    : formatCurrency(input.closingBalance)

  const companyName = escapeHtml(COMPANY_DETAILS?.name || 'Orange Jelly Limited')
  const companyAddress = escapeHtml(COMPANY_DETAILS?.fullAddress || '')
  const companyPhone = escapeHtml(COMPANY_DETAILS?.phone || '')
  const companyEmail = escapeHtml(COMPANY_DETAILS?.email || '')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page {
      margin: 20mm 15mm 25mm 15mm;
      @bottom-center {
        content: "Page " counter(page) " of " counter(pages);
        font-size: 10px;
        color: #9ca3af;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1f2937;
      line-height: 1.5;
      margin: 0;
      padding: 0;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tr { page-break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px;">
    <div>
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 4px 0; color: #111827;">ACCOUNT STATEMENT</h1>
      <p style="font-size: 14px; color: #6b7280; margin: 0;">${companyName}</p>
    </div>
    <div style="text-align: right;">
      <p style="font-size: 13px; color: #6b7280; margin: 0;">${companyAddress}</p>
      <p style="font-size: 13px; color: #6b7280; margin: 0;">${companyPhone}</p>
      <p style="font-size: 13px; color: #6b7280; margin: 0;">${companyEmail}</p>
    </div>
  </div>

  <!-- Client & Period -->
  <div style="display: flex; justify-content: space-between; margin-bottom: 24px; padding: 16px; background: #f9fafb; border-radius: 8px;">
    <div>
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.05em;">Client</p>
      <p style="font-size: 16px; font-weight: 600; margin: 0;">${vendorName}</p>
    </div>
    <div style="text-align: right;">
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.05em;">Period</p>
      <p style="font-size: 14px; font-weight: 500; margin: 0;">${periodFrom} — ${periodTo}</p>
    </div>
  </div>

  <!-- Transactions Table -->
  <table>
    <thead>
      <tr style="background: #f3f4f6;">
        <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Date</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Description</th>
        <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Reference</th>
        <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Debit</th>
        <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Credit</th>
        <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 2px solid #d1d5db; text-transform: uppercase; letter-spacing: 0.05em;">Balance</th>
      </tr>
    </thead>
    <tbody>
      <!-- Opening Balance -->
      <tr style="background: #fefce8; page-break-inside: avoid;">
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px;" colspan="5"><strong>Opening Balance</strong></td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; text-align: right; font-weight: 600;">${formatCurrency(input.openingBalance)}</td>
      </tr>
      ${transactionRows}
    </tbody>
    <tfoot>
      <!-- Closing Balance -->
      <tr style="background: #f0fdf4; page-break-inside: avoid;">
        <td style="padding: 12px; border-top: 2px solid #16a34a; font-size: 14px; font-weight: 700;" colspan="5">Closing Balance</td>
        <td style="padding: 12px; border-top: 2px solid #16a34a; font-size: 14px; font-weight: 700; text-align: right;">${closingBalanceDisplay}</td>
      </tr>
    </tfoot>
  </table>

  <!-- Note -->
  <div style="margin-top: 24px; padding: 12px 16px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
    <p style="font-size: 12px; color: #1e40af; margin: 0; font-style: italic;">
      This statement reflects invoiced amounts only. Unbilled work in progress is not included.
    </p>
  </div>

  <!-- Footer -->
  <div style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
    <p style="font-size: 11px; color: #9ca3af; text-align: center; margin: 0;">
      ${companyName} | Generated on ${escapeHtml(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/London' }))}
    </p>
  </div>
</body>
</html>`
}

export async function generateStatementPDF(input: StatementPDFInput): Promise<Buffer> {
  const html = generateStatementHTML(input)
  return generatePDFFromHTML(html, {
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '25mm', left: '15mm', right: '15mm' },
  })
}
