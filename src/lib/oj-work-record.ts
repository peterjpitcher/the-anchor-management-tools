import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { escapeHtml } from '@/lib/cron/alerting'
import {
  renderDocumentFooter,
  renderDocumentHead,
  renderDocumentHeader,
} from '@/lib/pdf/document-chrome'
import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'
import type { WorkRecord, WorkRecordLine } from '@/lib/oj-projects/work-record'

/**
 * The Work Record PDF: what work was done, what it was worth, and which invoice
 * charged it.
 *
 * A sibling of the account statement, on the same shared chrome. It never asks
 * for money, so it carries no bank details and no ageing. Page one is designed
 * to be a complete answer on its own; the per-invoice evidence follows.
 */
export interface WorkRecordPDFInput {
  vendorName: string
  periodFrom: string
  periodTo: string
  record: WorkRecord
  /** Shown under the carry-forward strip for clients on a flat monthly amount. */
  monthlyCapIncVat?: number | null
  logoUrl?: string
}

function money(amount: number): string {
  return `£${Math.abs(amount).toFixed(2)}`
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const BODY_CSS = `
    .record-meta {
      font-size: 8pt;
      color: #6b7280;
    }

    .record-meta strong {
      color: #111827;
    }

    .lede {
      font-size: 9pt;
      margin: 0 0 10px 0;
    }

    h2 {
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: #111827;
      margin: 12px 0 5px 0;
    }

    table.grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
    }

    table.grid thead {
      display: table-header-group;
    }

    table.grid tr {
      page-break-inside: avoid;
    }

    table.grid th {
      background: #f3f4f6;
      padding: 4px 6px;
      text-align: left;
      font-size: 7pt;
      font-weight: 600;
      color: #374151;
      border-bottom: 2px solid #d1d5db;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    table.grid td {
      padding: 4px 6px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 8pt;
      vertical-align: top;
      word-break: break-word;
    }

    table.grid th.num,
    table.grid td.num {
      text-align: right;
      white-space: nowrap;
    }

    .split-note {
      display: block;
      color: #6b7280;
      font-size: 7pt;
    }

    .invoice-block {
      margin-bottom: 12px;
      page-break-inside: avoid;
    }

    .invoice-block h3 {
      font-size: 8.5pt;
      margin: 0 0 4px 0;
      padding-bottom: 3px;
      border-bottom: 1px solid #e5e7eb;
      color: #111827;
    }

    .invoice-block h3 span {
      font-weight: 400;
      color: #6b7280;
    }

    .closing {
      width: 100%;
      border-collapse: collapse;
      margin-top: 2px;
    }

    .closing td {
      padding: 2px 6px;
      font-size: 8pt;
    }

    .closing td.num {
      text-align: right;
      white-space: nowrap;
    }

    .closing tr.total td {
      border-top: 1px solid #d1d5db;
      font-weight: 700;
    }

    .note {
      font-size: 7.5pt;
      color: #6b7280;
      margin: 4px 0 10px 0;
    }

    .page-two {
      page-break-before: always;
    }
`

function linesTable(lines: WorkRecordLine[], showValue: boolean): string {
  const rows = lines
    .map(
      (l) => `      <tr>
        <td>${escapeHtml(formatDate(l.date))}</td>
        <td>${escapeHtml(l.project)}</td>
        <td>${escapeHtml(l.description)}${l.splitNote ? `<span class="split-note">${escapeHtml(l.splitNote)}</span>` : ''}</td>
        <td class="num">${escapeHtml(l.quantity)}</td>
      </tr>`
    )
    .join('\n')

  return `  <table class="grid">
    <thead>
      <tr>
        <th scope="col">Date</th>
        <th scope="col">Project</th>
        <th scope="col">Work carried out</th>
        <th scope="col" class="num">Time</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>`
}

export function generateWorkRecordHTML(input: WorkRecordPDFInput): string {
  const { record } = input
  const vendorName = escapeHtml(input.vendorName)
  const periodFrom = escapeHtml(formatDate(input.periodFrom))
  const periodTo = escapeHtml(formatDate(input.periodTo))

  const projectRows = record.projects
    .map(
      (p) => `      <tr>
        <td>${escapeHtml(p.project)}</td>
        <td class="num">${p.entries}</td>
        <td class="num">${p.hours.toFixed(2)} h</td>
      </tr>`
    )
    .join('\n')

  const carryRows = record.carryForward
    .map((row) => {
      const invoices = row.invoiceNumbers.length ? escapeHtml(row.invoiceNumbers.join(', ')) : ''
      const pending = row.uninvoicedHours > 0
        ? `${invoices ? ', plus ' : ''}${row.uninvoicedHours.toFixed(2)} h not yet charged`
        : ''
      return `      <tr>
        <td>${escapeHtml(row.month)}</td>
        <td class="num">${row.hours.toFixed(2)} h</td>
        <td>${invoices}${escapeHtml(pending)}</td>
      </tr>`
    })
    .join('\n')

  const capNote = input.monthlyCapIncVat
    ? `  <p class="note">You pay a fixed ${money(input.monthlyCapIncVat)} including VAT each month while there is a balance on your account, so a month's work is charged over several invoices.</p>`
    : ''

  const invoiceBlocks = record.invoiceBlocks
    .map((block) => {
      const carried = block.carriedForwardExVat
      // A fixed-price stage says so plainly. Printing a carry-forward against an
      // agreed price would invent a balance that does not exist.
      const carriedRow = block.fixedPrice
        ? `      <tr>
        <td>Agreed fixed price for this stage</td>
        <td class="num"></td>
      </tr>`
        : Math.abs(carried) < 0.005
          ? ''
          : `      <tr>
        <td>${carried > 0 ? 'Payment towards earlier work carried forward' : 'Work carried forward to a later invoice'}</td>
        <td class="num">${money(carried)}</td>
      </tr>`

      const recurringRow = block.recurringExVat
        ? `      <tr>
        <td>${escapeHtml(block.recurringLabels.join(', ') || 'Recurring charges')}</td>
        <td class="num">${money(block.recurringExVat)}</td>
      </tr>`
        : ''

      return `  <div class="invoice-block">
    <h3>${escapeHtml(block.invoiceNumber)} <span>${escapeHtml(formatDate(block.invoiceDate))}, ${escapeHtml(block.settled ? 'paid' : 'outstanding')}</span></h3>
${block.lines.length ? linesTable(block.lines, true) : '    <p class="note">No time entries on this invoice.</p>'}
    <table class="closing">
      <tr>
        <td>${block.fixedPrice ? `Time spent on this stage, ${block.hours.toFixed(2)} hours` : `Work on this invoice, ${block.hours.toFixed(2)} hours`}</td>
        <td class="num">${block.fixedPrice ? '' : money(block.workExVat)}</td>
      </tr>
${recurringRow}
${carriedRow}
      <tr class="total">
        <td>Invoice total excluding VAT</td>
        <td class="num">${money(block.invoiceExVat)}</td>
      </tr>
    </table>
  </div>`
    })
    .join('\n')

  const head = renderDocumentHead({
    titleHtml: `Work Record ${vendorName} ${periodFrom} to ${periodTo}`,
    metaClass: '.record-header',
    numberClass: '.record-period',
    bodyCss: BODY_CSS,
  })

  const header = renderDocumentHeader({
    logoUrl: input.logoUrl,
    metaClass: 'record-header',
    headingHtml: 'WORK RECORD',
    metaHtml: `      <div class="record-meta">
        <strong>${vendorName}</strong><br>
        ${periodFrom} to ${periodTo}
      </div>`,
  })

  return `${head}
<body>
${header}

  <p class="lede">This record covers the billable work carried out for ${vendorName} between ${periodFrom} and ${periodTo}: ${record.totalHours.toFixed(2)} hours across ${record.projectCount} project${record.projectCount === 1 ? '' : 's'}.</p>

  <h2>Where the time went</h2>
  <table class="grid">
    <thead>
      <tr>
        <th scope="col">Project</th>
        <th scope="col" class="num">Entries</th>
        <th scope="col" class="num">Hours</th>
      </tr>
    </thead>
    <tbody>
${projectRows}
    </tbody>
  </table>

  <h2>How it was invoiced</h2>
  <table class="grid">
    <thead>
      <tr>
        <th scope="col">Work carried out in</th>
        <th scope="col" class="num">Hours</th>
        <th scope="col">Charged on</th>
      </tr>
    </thead>
    <tbody>
${carryRows}
    </tbody>
  </table>
${capNote}

  <div class="page-two">
    <h2>What each invoice covered</h2>
${invoiceBlocks}
${
  record.notYetCharged.length
    ? `    <h2>Work done, not yet charged</h2>
    <p class="note">${record.notYetChargedHours.toFixed(2)} hours carried forward. There is nothing to pay for this yet.</p>
${linesTable(record.notYetCharged, true)}`
    : ''
}
${
  record.settledWithoutInvoice.length
    ? `    <h2>Work already settled, invoice reference not recorded</h2>
    <p class="note">${record.settledWithoutInvoiceHours.toFixed(2)} hours. This work has been paid for; our records simply do not show which invoice carried it.</p>
${linesTable(record.settledWithoutInvoice, true)}`
    : ''
}
  </div>

${renderDocumentFooter()}
</body>
</html>`
}

export async function generateWorkRecordPDF(input: WorkRecordPDFInput): Promise<Buffer> {
  if (!input.record.reconciles) {
    // The account statement prints a mismatch on its face. This document must
    // not: a client-facing breakdown that does not add up to its own invoice is
    // worse than no document at all.
    const unexplained = input.record.unexplainedInvoices ?? []
    throw new Error(
      unexplained.length
        ? `Work Record could not be produced: ${unexplained.join(', ')} ${unexplained.length === 1 ? 'has' : 'have'} no work recorded against ${unexplained.length === 1 ? 'it' : 'them'}, so the document would not agree with the account statement`
        : 'Work Record did not reconcile against its invoices, so no PDF was produced'
    )
  }

  const html = generateWorkRecordHTML({
    ...input,
    logoUrl: input.logoUrl ?? getDocumentLogoDataUri(),
  })

  return generatePDFFromHTML(html, {
    format: 'A4',
    printBackground: true,
    margin: { top: '8mm', bottom: '8mm', left: '8mm', right: '8mm' },
  })
}
