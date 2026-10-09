import { generatePDFFromHTML } from '@/lib/pdf-generator'
import { escapeHtml } from '@/lib/cron/alerting'
import { STAFF } from '@/lib/brand/palette'
import {
  renderDocumentFooter,
  renderDocumentHead,
  renderDocumentHeader,
} from '@/lib/pdf/document-chrome'
import { getDocumentLogoDataUri } from '@/lib/pdf/document-logo'
import type { WorkRecord, WorkRecordInvoiceBlock, WorkRecordLine } from '@/lib/oj-projects/work-record'
import type { WorkRecordAccount } from '@/app/actions/oj-projects/work-record'

/**
 * The Work Record PDF: what work was done, what it was worth, and which invoice
 * charged it.
 *
 * A sibling of the account statement, on the same shared chrome. It never asks
 * for money, so it carries no bank details and no ageing. Page one is designed
 * to be a complete answer on its own; the per-invoice evidence follows.
 *
 * It does say where the account stands, what is unpaid and what is still to be
 * invoiced (owner request, 9 October 2026). A client reading "nothing to pay
 * for this yet" beside 28 unbilled hours had no way to see what was coming.
 */
export interface WorkRecordPDFInput {
  vendorName: string
  periodFrom: string
  periodTo: string
  record: WorkRecord
  /** Shown under the carry-forward strip for clients on a flat monthly amount. */
  monthlyCapIncVat?: number | null
  /** Today's position. Omitted for a record that stops before today. */
  account?: WorkRecordAccount
  logoUrl?: string
}

function money(amount: number): string {
  return `£${Math.abs(amount).toFixed(2)}`
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function formatMonth(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const BODY_CSS = `
    .record-meta {
      font-size: 8pt;
      color: ${STAFF.textMuted};
    }

    .record-meta strong {
      color: ${STAFF.text};
    }

    .lede {
      font-size: 9pt;
      margin: 0 0 10px 0;
    }

    h2 {
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: ${STAFF.textStrong};
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
      background: ${STAFF.surfaceHover};
      padding: 4px 6px;
      text-align: left;
      font-size: 7pt;
      font-weight: 600;
      color: ${STAFF.text};
      border-bottom: 2px solid ${STAFF.borderStrong};
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    table.grid td {
      padding: 4px 6px;
      border-bottom: 1px solid ${STAFF.border};
      font-size: 8pt;
      vertical-align: top;
      word-break: break-word;
    }

    table.grid th.num,
    table.grid td.num {
      text-align: right;
      white-space: nowrap;
    }

    /*
     * Line tables share fixed column widths. Left to size themselves, a table
     * with one long description squeezed the date and project onto two lines
     * while its neighbour did not, so the same columns sat at different widths
     * down the page.
     */
    table.lines {
      table-layout: fixed;
    }

    table.lines col.c-date { width: 13%; }
    table.lines col.c-project { width: 24%; }
    table.lines col.c-time { width: 10%; }
    table.lines col.c-value { width: 12%; }

    table.grid td.nowrap {
      white-space: nowrap;
    }

    table.grid tr.total td {
      border-top: 2px solid ${STAFF.borderStrong};
      border-bottom: none;
      font-weight: 700;
    }

    .unpaid,
    .invoice-block h3 span.unpaid {
      color: ${STAFF.danger};
      font-weight: 600;
    }

    /* Short tables that read as one thing are not split across a page. */
    table.keep {
      page-break-inside: avoid;
    }

    .split-note {
      display: block;
      color: ${STAFF.textMuted};
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
      border-bottom: 1px solid ${STAFF.border};
      color: ${STAFF.textStrong};
    }

    .invoice-block h3 span {
      font-weight: 400;
      color: ${STAFF.textMuted};
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
      border-top: 1px solid ${STAFF.borderStrong};
      font-weight: 700;
    }

    .note {
      font-size: 7.5pt;
      color: ${STAFF.textMuted};
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
        <td class="nowrap">${escapeHtml(formatDate(l.date))}</td>
        <td>${escapeHtml(l.project)}</td>
        <td>${escapeHtml(l.description)}${l.splitNote ? `<span class="split-note">${escapeHtml(l.splitNote)}</span>` : ''}</td>
        <td class="num">${escapeHtml(l.quantity)}</td>${showValue ? `
        <td class="num">${money(l.exVat)}</td>` : ''}
      </tr>`
    )
    .join('\n')

  return `  <table class="grid lines">
    <colgroup>
      <col class="c-date"><col class="c-project"><col><col class="c-time">${showValue ? '<col class="c-value">' : ''}
    </colgroup>
    <thead>
      <tr>
        <th scope="col">Date</th>
        <th scope="col">Project</th>
        <th scope="col">Work carried out</th>
        <th scope="col" class="num">Time</th>${showValue ? `
        <th scope="col" class="num">Value ex VAT</th>` : ''}
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>`
}

/** "paid", or what is still owed, so an unpaid invoice cannot be read past. */
function invoiceStatusHtml(block: WorkRecordInvoiceBlock): string {
  if (block.settled) return 'paid'
  const partPaid = block.outstandingIncVat > 0 && block.outstandingIncVat < block.invoiceIncVat - 0.005
  return `<span class="unpaid">${partPaid ? 'part paid' : 'unpaid'}, ${money(block.outstandingIncVat)} outstanding</span>`
}

/**
 * The row that closes the gap between an invoice and the work listed on it.
 *
 * A flat monthly invoice that charged more than the work on it took the rest on
 * account, and one that charged less used some of that up. Both used to be
 * described as work "carried forward", which told a client that INV-003VB paid
 * for earlier work when it was the first invoice on the account.
 */
function differenceRow(block: WorkRecordInvoiceBlock): string {
  const carried = block.carriedForwardExVat
  // A fixed-price stage says so plainly. Printing a difference against an
  // agreed price would invent a balance that does not exist.
  if (block.fixedPrice) {
    return `      <tr>
        <td>Agreed fixed price for this stage</td>
        <td class="num"></td>
      </tr>`
  }
  if (Math.abs(carried) < 0.005) return ''

  const label = block.flatMonthly
    ? carried > 0
      ? 'Invoiced on account, set against work still to be invoiced'
      : 'Covered by amounts already invoiced on account'
    : carried > 0
      ? 'Invoiced above the work logged on this invoice'
      : 'Work logged above the amount invoiced'

  return `      <tr>
        <td>${label}</td>
        <td class="num">${carried < 0 ? '-' : ''}${money(carried)}</td>
      </tr>`
}

/** Page one: where the account stands today, inc VAT throughout. */
function accountSummary(account: WorkRecordAccount | undefined): string {
  if (!account) return ''
  const p = account.position
  const total = roundMoney(p.invoicedUnpaid + p.notYetInvoicedNet)
  const row = (label: string, amount: string, cls = '') => `      <tr${cls ? ` class="${cls}"` : ''}>
        <td>${label}</td>
        <td class="num">${amount}</td>
      </tr>`

  const unpaidLabel = `Invoiced and unpaid${p.unpaidInvoiceCount ? `, ${p.unpaidInvoiceCount} invoice${p.unpaidInvoiceCount === 1 ? '' : 's'}` : ''}`

  return `  <h2>Where your account stands</h2>
  <table class="grid">
    <tbody>
${row('Invoiced to date', money(p.invoicedTotal))}
${row('Paid to date', money(p.paidTotal))}
${row(unpaidLabel, p.invoicedUnpaid > 0 ? `<span class="unpaid">${money(p.invoicedUnpaid)}</span>` : money(0))}
${row('Work done, not yet invoiced', money(p.notYetInvoicedNet))}
${row('Total for all work to date', money(total), 'total')}
    </tbody>
  </table>
  <p class="note">As at ${escapeHtml(formatDate(account.asAt))}, including VAT. Only invoiced amounts are due for payment.</p>
`
}

/**
 * Everything not yet on an invoice, what it comes to, and when it will be
 * invoiced. The lines are the work inside the record's dates; the total is the
 * whole account, so anything older is stated as its own row rather than hidden
 * inside the VAT.
 */
function notYetInvoicedSection(input: WorkRecordPDFInput): string {
  const { record, account } = input
  const charges = account?.notYetInvoicedCharges ?? []
  if (!record.notYetCharged.length && !charges.length) return ''

  const chargesTable = charges.length
    ? `  <table class="grid keep">
    <thead>
      <tr>
        <th scope="col">Regular charge</th>
        <th scope="col">Month</th>
        <th scope="col" class="num">Value ex VAT</th>
      </tr>
    </thead>
    <tbody>
${charges
  .map(
    (c) => `      <tr>
        <td>${escapeHtml(c.description)}</td>
        <td>${escapeHtml(/^\d{4}-\d{2}$/.test(c.period) ? formatMonth(`${c.period}-01`) : c.period)}</td>
        <td class="num">${money(c.exVat)}</td>
      </tr>`
  )
  .join('\n')}
    </tbody>
  </table>`
    : ''

  if (!account) {
    return `    <h2>Work done, not yet invoiced</h2>
    <p class="note">${record.notYetChargedHours.toFixed(2)} hours, ${money(record.notYetChargedExVat)} excluding VAT. This has not been invoiced, so nothing is due for it yet.</p>
${linesTable(record.notYetCharged, true)}`
  }

  const p = account.position
  const chargesExVat = roundMoney(charges.reduce((acc, c) => acc + c.exVat, 0))
  const chargesIncVat = roundMoney(
    charges.reduce((acc, c) => acc + c.exVat + roundMoney(c.exVat * (c.vatRate / 100)), 0)
  )
  const listedExVat = roundMoney(record.notYetChargedExVat + chargesExVat)
  const listedIncVat = roundMoney(record.notYetChargedIncVat + chargesIncVat)
  const vat = roundMoney(listedIncVat - listedExVat)
  // Work not yet invoiced that falls outside the dates of this record.
  const outsidePeriod = roundMoney(p.notYetInvoicedGross - listedIncVat)

  const row = (label: string, amount: string, cls = '') => `      <tr${cls ? ` class="${cls}"` : ''}>
        <td>${label}</td>
        <td class="num">${amount}</td>
      </tr>`

  const totals = [
    record.notYetCharged.length
      ? row(`Work listed above, ${record.notYetChargedHours.toFixed(2)} hours`, money(record.notYetChargedExVat))
      : '',
    charges.length ? row('Regular charges listed above', money(chargesExVat)) : '',
    row('VAT', money(vat)),
    Math.abs(outsidePeriod) >= 0.01
      ? row('Other work not yet invoiced, outside the dates of this record', money(outsidePeriod))
      : '',
    p.invoicedOnAccount > 0 ? row('Less already invoiced on account', `-${money(p.invoicedOnAccount)}`) : '',
    row('Still to be invoiced, including VAT', money(p.notYetInvoicedNet), 'total'),
  ]
    .filter(Boolean)
    .join('\n')

  const forecast = account.forecast
  const forecastBlock =
    forecast && forecast.rows.length
      ? `    <h2>Invoices to come</h2>
  <table class="grid keep">
    <thead>
      <tr>
        <th scope="col">Invoice month</th>
        <th scope="col" class="num">Invoice</th>
        <th scope="col" class="num">Left to invoice after</th>
      </tr>
    </thead>
    <tbody>
${forecast.rows
  .map(
    (r) => `      <tr>
        <td>${escapeHtml(formatMonth(r.invoiceDate))}</td>
        <td class="num">${money(r.amount)}</td>
        <td class="num">${money(r.remainingAfter)}</td>
      </tr>`
  )
  .join('\n')}
    </tbody>
  </table>
    <p class="note">A forecast, including VAT, assuming no new work is added${
      account.monthlyChargesIncVat > 0
        ? ` and counting your regular charges of ${money(account.monthlyChargesIncVat)} a month`
        : ''
    }.${
      forecast.truncated
        ? ' The balance is not cleared within the months shown.'
        : account.monthlyChargesIncVat > 0
          ? ' After that, each invoice is your regular charges only.'
          : ''
    } These are in addition to the invoices already unpaid.</p>`
      : ''

  return `    <h2>Work done, not yet invoiced</h2>
    <p class="note">None of this has been invoiced, so nothing is due for it yet.</p>
${record.notYetCharged.length ? linesTable(record.notYetCharged, true) : ''}
${chargesTable}
    <table class="closing">
${totals}
    </table>
${forecastBlock}`
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
        ? `${invoices ? ', plus ' : ''}${row.uninvoicedHours.toFixed(2)} h not yet invoiced`
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
      const carriedRow = differenceRow(block)
      // A fixed-price stage with no time logged against it has nothing to say
      // about hours. "Time spent on this stage, 0.00 hours" read as though the
      // stage had taken no work.
      const workRow =
        block.fixedPrice && block.hours <= 0
          ? ''
          : `      <tr>
        <td>${block.fixedPrice ? `Time spent on this stage, ${block.hours.toFixed(2)} hours` : `Work on this invoice, ${block.hours.toFixed(2)} hours`}</td>
        <td class="num">${block.fixedPrice ? '' : money(block.workExVat)}</td>
      </tr>`

      const recurringRow = block.recurringExVat
        ? `      <tr>
        <td>${escapeHtml(block.recurringLabels.join(', ') || 'Recurring charges')}</td>
        <td class="num">${money(block.recurringExVat)}</td>
      </tr>`
        : ''

      return `  <div class="invoice-block">
    <h3>${escapeHtml(block.invoiceNumber)} <span>${escapeHtml(formatDate(block.invoiceDate))}, ${invoiceStatusHtml(block)}</span></h3>
${block.lines.length ? linesTable(block.lines, false) : '    <p class="note">No time entries on this invoice.</p>'}
    <table class="closing">
${workRow}
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

${accountSummary(input.account)}
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
${notYetInvoicedSection(input)}
${
  record.settledWithoutInvoice.length
    ? `    <h2>Work already settled, invoice reference not recorded</h2>
    <p class="note">${record.settledWithoutInvoiceHours.toFixed(2)} hours. This work has been paid for; our records simply do not show which invoice carried it.</p>
${linesTable(record.settledWithoutInvoice, false)}`
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
