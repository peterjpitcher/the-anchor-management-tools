import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { escapeHtml } from '@/lib/cron/alerting'
import { COMPANY_DETAILS } from '@/lib/company-details'
import {
  renderDocumentFooter,
  renderDocumentHead,
  renderDocumentHeader,
} from '@/lib/pdf/document-chrome'
import { getStatementLogoDataUri } from '@/lib/pdf/document-logo'
import type { StatementTransaction } from '@/app/actions/oj-projects/client-statement'
import type { StatementAgeing } from '@/lib/oj-projects/statement-ageing'

export interface StatementPDFInput {
  vendorName: string
  periodFrom: string
  periodTo: string
  openingBalance: number
  transactions: StatementTransaction[]
  closingBalance: number
  ageing?: StatementAgeing
  /** Data URI. Omitted when the bundled asset cannot be read, exactly as invoices behave. */
  logoUrl?: string
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function formatCurrency(amount: number): string {
  return `£${Math.abs(amount).toFixed(2)}`
}

/**
 * A balance with its sign made explicit. `formatCurrency` takes the absolute
 * value, so on its own it printed a credit as though the client owed it.
 */
function formatBalance(amount: number): string {
  return amount < 0 ? `${formatCurrency(amount)} credit` : formatCurrency(amount)
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

/**
 * Ledger-specific styling. The shared chrome owns page geometry, typography, the
 * header and the footer; this owns the six-column statement table and the
 * payment block, which no other document has.
 */
const STATEMENT_BODY_CSS = `
    .statement-meta {
      font-size: 8pt;
      color: #6b7280;
    }

    .statement-meta strong {
      color: #111827;
    }

    .ledger {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
    }

    .ledger thead {
      display: table-header-group;
    }

    .ledger tr {
      page-break-inside: avoid;
    }

    .ledger th {
      background: #f3f4f6;
      padding: 5px 6px;
      text-align: left;
      font-size: 8pt;
      font-weight: 600;
      color: #374151;
      border-bottom: 2px solid #d1d5db;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .ledger th.text-right,
    .ledger td.text-right {
      text-align: right;
    }

    .ledger td {
      padding: 4px 6px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 8pt;
      vertical-align: top;
      word-break: break-word;
    }

    .ledger .opening td {
      background: #fefce8;
      font-weight: 600;
    }

    .ledger .closing td {
      background: #f0fdf4;
      border-top: 2px solid #16a34a;
      border-bottom: none;
      font-size: 9pt;
      font-weight: 700;
      padding: 6px;
    }

    .credit-amount {
      color: #dc2626;
    }

    .ageing {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      page-break-inside: avoid;
    }

    .ageing th {
      background: #f9fafb;
      padding: 4px 6px;
      font-size: 7pt;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      text-align: right;
      border-bottom: 1px solid #e5e7eb;
    }

    .ageing th:first-child {
      text-align: left;
    }

    .ageing td {
      padding: 5px 6px;
      font-size: 9pt;
      font-weight: 600;
      text-align: right;
      border-bottom: 1px solid #e5e7eb;
    }

    .ageing td:first-child {
      text-align: left;
      font-weight: 400;
      color: #6b7280;
    }

    .ageing .overdue-most {
      color: #dc2626;
    }

    .reconciliation {
      font-size: 7pt;
      color: #6b7280;
      margin: 0 0 10px 0;
    }

    .statement-payment {
      margin-top: 12px;
      padding: 8px;
      background: #f9fafb;
      border-radius: 4px;
      page-break-inside: avoid;
    }

    .statement-payment h3 {
      margin: 0 0 5px 0;
      color: #111827;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .statement-payment p {
      margin: 1px 0;
      font-size: 8pt;
    }
`

/**
 * States the check rather than hiding it. If the buckets ever stop reconciling
 * against the closing balance the statement says so on its face, which is the
 * whole point of showing ageing next to a ledger.
 */
function buildReconciliationLine(ageing: StatementAgeing, closingBalance: number): string {
  // Split rather than lumped. Summing every bucket and calling the total
  // "amounts overdue" told a client inside their seven-day terms that money not
  // yet due was late, on the one line of the document that asserts lateness.
  const notYetDue = ageing.buckets.find((b) => b.key === 'not_yet_due')?.amount ?? 0
  const overdue = roundMoney(ageing.receivablesTotal - notYetDue)

  const parts: string[] = []
  if (notYetDue > 0) parts.push(`Not yet due ${formatCurrency(notYetDue)}`)
  parts.push(`${parts.length ? 'overdue' : 'Overdue'} ${formatCurrency(overdue)}`)
  if (ageing.creditTotal > 0) parts.push(`less credit ${formatCurrency(ageing.creditTotal)}`)
  parts.push(`equals the closing balance of ${formatBalance(closingBalance)}`)

  const reconciles = Math.abs(ageing.netTotal - closingBalance) < 0.005
  return reconciles
    ? escapeHtml(parts.join(', ') + '.')
    : escapeHtml(
        `${parts.join(', ')}. These figures do not agree, so please contact us before paying.`
      )
}

export function generateStatementHTML(input: StatementPDFInput): string {
  const vendorName = escapeHtml(input.vendorName)
  const periodFrom = escapeHtml(formatStatementDate(input.periodFrom))
  const periodTo = escapeHtml(formatStatementDate(input.periodTo))

  const balanceCell = (amount: number) =>
    amount < 0
      ? `<span class="credit-amount">(${formatCurrency(amount)}) credit</span>`
      : formatCurrency(amount)

  const transactionRows = input.transactions
    .map(
      (txn) => `      <tr>
        <td>${escapeHtml(formatStatementDate(txn.date))}</td>
        <td>${escapeHtml(txn.description)}</td>
        <td>${escapeHtml(txn.reference)}</td>
        <td class="text-right">${txn.debit !== null ? formatCurrency(txn.debit) : ''}</td>
        <td class="text-right">${txn.credit !== null ? formatCurrency(txn.credit) : ''}</td>
        <td class="text-right">${balanceCell(txn.balance)}</td>
      </tr>`
    )
    .join('\n')

  const emptyRow = `      <tr>
        <td colspan="6" style="text-align: center; color: #6b7280;">No transactions in this period.</td>
      </tr>`

  const closingBalanceDisplay = formatBalance(input.closingBalance)

  const ageing = input.ageing
  const ageingBlock = ageing
    ? `  <table class="ageing">
    <thead>
      <tr>
        <th scope="col">Aged by days overdue</th>
${ageing.buckets.map((b) => `        <th scope="col">${escapeHtml(b.label)}</th>`).join('\n')}
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>as at ${escapeHtml(formatStatementDate(ageing.asAt))}</td>
${ageing.buckets
  .map(
    (b) =>
      `        <td${b.key === 'overdue_90_plus' && b.amount > 0 ? ' class="overdue-most"' : ''}>${formatCurrency(b.amount)}</td>`
  )
  .join('\n')}
      </tr>
    </tbody>
  </table>

  <p class="reconciliation">${buildReconciliationLine(ageing, input.closingBalance)}</p>
`
    : ''

  const head = renderDocumentHead({
    titleHtml: `Account Statement ${vendorName} ${periodFrom} to ${periodTo}`,
    metaClass: '.statement-header',
    numberClass: '.statement-period',
    bodyCss: STATEMENT_BODY_CSS,
  })

  const header = renderDocumentHeader({
    logoUrl: input.logoUrl,
    metaClass: 'statement-header',
    headingHtml: 'ACCOUNT STATEMENT',
    metaHtml: `      <div class="statement-meta">
        <strong>${vendorName}</strong><br>
        ${periodFrom} to ${periodTo}
      </div>`,
  })

  return `${head}
<body>
${header}

${ageingBlock}  <table class="ledger">
    <thead>
      <tr>
        <th scope="col">Date</th>
        <th scope="col">Description</th>
        <th scope="col">Reference</th>
        <th scope="col" class="text-right">Debit</th>
        <th scope="col" class="text-right">Credit</th>
        <th scope="col" class="text-right">Balance</th>
      </tr>
    </thead>
    <tbody>
      <tr class="opening">
        <td colspan="5">Opening Balance</td>
        <td class="text-right">${balanceCell(input.openingBalance)}</td>
      </tr>
${input.transactions.length > 0 ? transactionRows : emptyRow}
      <tr class="closing">
        <td colspan="5">Closing Balance</td>
        <td class="text-right">${closingBalanceDisplay}</td>
      </tr>
    </tbody>
  </table>

  <div class="statement-payment">
    <h3>How to Pay</h3>
    <p><strong>Bank:</strong> ${COMPANY_DETAILS.bank.name}</p>
    <p><strong>Account Name:</strong> ${COMPANY_DETAILS.bank.accountName}</p>
    <p><strong>Sort Code:</strong> ${COMPANY_DETAILS.bank.sortCode}</p>
    <p><strong>Account: </strong> ${COMPANY_DETAILS.bank.accountNumber}</p>
    <p style="margin-top: 4px;">Please quote <strong>${vendorName}</strong> as the payment reference.</p>
  </div>

${renderDocumentFooter()}
</body>
</html>`
}

export async function generateStatementPDF(input: StatementPDFInput): Promise<Buffer> {
  const html = generateStatementHTML({
    ...input,
    logoUrl: input.logoUrl ?? getStatementLogoDataUri(),
  })

  // Same geometry as the invoice. The statement used to set its own 20/25/15/15mm,
  // which is a large part of why the two documents did not look related.
  return generatePDFFromHTML(html, {
    format: 'A4',
    printBackground: true,
    margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
  })
}
