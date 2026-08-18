'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { roundMoney } from '@/lib/oj-projects/utils'
import { sendEmail } from '@/lib/email/emailService'
import { generateStatementPDF } from '@/lib/oj-statement'
import { logAuditEvent } from '@/app/actions/audit'
import { escapeHtml } from '@/lib/cron/alerting'
import { buildStatementAgeing, type StatementAgeing } from '@/lib/oj-projects/statement-ageing'

export interface StatementTransaction {
  date: string
  description: string
  reference: string
  debit: number | null
  credit: number | null
  balance: number
}

export interface ClientStatementData {
  vendor: { id: string; name: string; email: string | null }
  period: { from: string; to: string }
  openingBalance: number
  transactions: StatementTransaction[]
  closingBalance: number
  /** `ageing.netTotal` must equal `closingBalance`; the PDF prints that check. */
  ageing: StatementAgeing
}

export async function getClientStatement(
  vendorId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ statement?: ClientStatementData; error?: string }> {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects data' }

  if (!vendorId || !dateFrom || !dateTo) {
    return { error: 'Missing required parameters: vendorId, dateFrom, dateTo' }
  }

  // Validated here rather than at the route, so a hand-edited or shared link is
  // covered as well as the button. A lexical comparison alone accepted
  // '2026-8-18', which then silently pulled in invoices past the requested end
  // date and aged the whole balance as not yet due, while the email version
  // printed the literal words 'Invalid Date'.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
  const isRealDate = (value: string) => {
    if (!ISO_DATE.test(value)) return false
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }

  if (!isRealDate(dateFrom) || !isRealDate(dateTo)) {
    return { error: 'Dates must be real calendar dates in YYYY-MM-DD format' }
  }

  if (dateFrom > dateTo) {
    return { error: 'Date range is invalid: dateFrom must be before dateTo' }
  }

  const supabase = await createClient()

  // Fetch vendor details
  const { data: vendor, error: vendorError } = await supabase
    .from('invoice_vendors')
    .select('id, name, email')
    .eq('id', vendorId)
    .single()

  if (vendorError || !vendor) {
    return { error: vendorError?.message || 'Vendor not found' }
  }

  // Every invoice for this client, not just those the OJ billing cron raised.
  //
  // This used to filter on reference ILIKE 'OJ Projects %'. The document is
  // headed ACCOUNT STATEMENT and a client reads it as their whole account, but
  // the filter silently dropped anything invoiced by hand or under an older
  // reference convention: GBP 8,325 of Barons Pubs history and GBP 2,980 of
  // Golden Barrels'. It also failed open on NULL, because ILIKE against NULL is
  // NULL rather than false, so two invoices vanished for having no reference at
  // all. The billing engine keeps its own OJ-only scope; that is about which
  // work the monthly cap covers, which is a different question.
  //
  // Draft invoices stay out: the client has not been asked to pay them.
  const { data: allInvoices, error: invoicesError } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, due_date, status, total_amount, paid_amount, created_at')
    .eq('vendor_id', vendorId)
    .is('deleted_at', null)
    .not('status', 'in', '("void","written_off","draft")')
    .order('invoice_date', { ascending: true })

  if (invoicesError) return { error: invoicesError.message }

  const invoices = allInvoices || []

  // Fetch all payments for these invoices
  const invoiceIds = invoices.map((inv) => inv.id)
  let allPayments: Array<{
    id: string
    invoice_id: string
    amount: number
    payment_date: string
    payment_method: string | null
    reference: string | null
    created_at: string
  }> = []

  if (invoiceIds.length > 0) {
    const { data: payments, error: paymentsError } = await supabase
      .from('invoice_payments')
      .select('id, invoice_id, amount, payment_date, payment_method, reference, created_at')
      .in('invoice_id', invoiceIds)
      .order('payment_date', { ascending: true })

    if (paymentsError) return { error: paymentsError.message }
    allPayments = payments || []
  }

  // Fetch credit notes for these invoices (table may not exist yet)
  let allCreditNotes: Array<{
    id: string
    credit_note_number: string
    invoice_id: string
    amount_inc_vat: number
    created_at: string
    status: string
  }> = []

  if (invoiceIds.length > 0) {
    const { data: creditNotes, error: cnError } = await supabase
      .from('credit_notes')
      .select('id, credit_note_number, invoice_id, amount_inc_vat, created_at, status')
      .in('invoice_id', invoiceIds)
      .eq('status', 'issued')
      .order('created_at', { ascending: true })

    if (cnError) {
      // Deliberately fails closed. Continuing without credit notes produces a
      // statement that can ask a client to pay money already credited, and the
      // ageing totals would not reconcile against the closing balance either.
      console.error('[client-statement] credit_notes query failed:', cnError.message)
      return { error: 'Could not load credit notes, so the statement would be incomplete. Please try again.' }
    }
    allCreditNotes = creditNotes || []
  }

  // Opening balance: what was owed the moment before the period began.
  //
  // Invoices count only if they predate the period, but settlements count
  // whatever their invoice's date. A payment banked before the period against an
  // invoice raised inside it (a standing order arriving ahead of the invoice)
  // otherwise appears nowhere at all: the invoice shows as a debit in the ledger
  // and the money that cleared it is silently dropped, leaving the statement
  // demanding payment the client has already made.
  //
  // NOT clamped at zero. Clamping discarded an overpayment carried into the
  // period, so the opening balance overstated the debt and the ageing totals
  // could never reconcile against the closing balance.
  const invoicedBefore = invoices
    .filter((inv) => inv.invoice_date < dateFrom)
    .reduce((acc, inv) => acc + Number(inv.total_amount || 0), 0)

  const paidBefore = allPayments
    .filter((p) => p.payment_date < dateFrom)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0)

  const creditedBefore = allCreditNotes
    .filter((cn) => cn.created_at.slice(0, 10) < dateFrom)
    .reduce((sum, cn) => sum + Number(cn.amount_inc_vat || 0), 0)

  const openingBalance = roundMoney(invoicedBefore - paidBefore - creditedBefore)

  // Build transactions within the date range
  type RawTransaction = {
    date: string
    sortKey: string
    description: string
    reference: string
    debit: number | null
    credit: number | null
  }

  const rawTransactions: RawTransaction[] = []

  // Invoices (debits) within range
  for (const inv of invoices) {
    if (inv.invoice_date >= dateFrom && inv.invoice_date <= dateTo) {
      rawTransactions.push({
        date: inv.invoice_date,
        sortKey: `${inv.invoice_date}-A-${inv.created_at}`,
        description: `Invoice ${inv.invoice_number}`,
        reference: inv.invoice_number,
        debit: Number(inv.total_amount || 0),
        credit: null,
      })
    }
  }

  // Payments (credits) within range
  for (const payment of allPayments) {
    if (payment.payment_date >= dateFrom && payment.payment_date <= dateTo) {
      const inv = invoices.find((i) => i.id === payment.invoice_id)
      const methodLabel = payment.payment_method
        ? `, ${payment.payment_method.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
        : ''
      rawTransactions.push({
        date: payment.payment_date,
        sortKey: `${payment.payment_date}-B-${payment.created_at}`,
        description: `Payment received${methodLabel}`,
        reference: inv?.invoice_number || payment.reference || '',
        debit: null,
        credit: Number(payment.amount || 0),
      })
    }
  }

  // Credit notes within range
  for (const cn of allCreditNotes) {
    const cnDate = cn.created_at.slice(0, 10)
    if (cnDate >= dateFrom && cnDate <= dateTo) {
      rawTransactions.push({
        date: cnDate,
        sortKey: `${cnDate}-C-${cn.created_at}`,
        description: `Credit Note ${cn.credit_note_number}`,
        reference: cn.credit_note_number,
        debit: null,
        credit: Number(cn.amount_inc_vat || 0),
      })
    }
  }

  // Sort chronologically
  rawTransactions.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  // Compute running balance
  let runningBalance = openingBalance
  const transactions: StatementTransaction[] = rawTransactions.map((txn) => {
    if (txn.debit !== null) {
      runningBalance = roundMoney(runningBalance + txn.debit)
    }
    if (txn.credit !== null) {
      runningBalance = roundMoney(runningBalance - txn.credit)
    }
    return {
      date: txn.date,
      description: txn.description,
      reference: txn.reference,
      debit: txn.debit,
      credit: txn.credit,
      balance: runningBalance,
    }
  })

  const closingBalance = runningBalance

  // Ageing is measured per invoice as at the period end, using the same
  // payment and credit cut-off as the ledger above, so the two agree.
  const ageing = buildStatementAgeing(
    invoices
      .filter((inv) => inv.invoice_date <= dateTo)
      .map((inv) => {
        const paid = allPayments
          .filter((p) => p.invoice_id === inv.id && p.payment_date <= dateTo)
          .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        const credited = allCreditNotes
          .filter((cn) => cn.invoice_id === inv.id && cn.created_at.slice(0, 10) <= dateTo)
          .reduce((sum, cn) => sum + Number(cn.amount_inc_vat || 0), 0)
        return {
          dueDate: String(inv.due_date || inv.invoice_date),
          remaining: Number(inv.total_amount || 0) - paid - credited,
        }
      }),
    dateTo
  )

  return {
    statement: {
      vendor: { id: vendor.id, name: vendor.name, email: vendor.email || null },
      period: { from: dateFrom, to: dateTo },
      openingBalance,
      transactions,
      closingBalance,
      ageing,
    },
  }
}

/**
 * Helper to format a date string for display in statement emails.
 */
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
 * Helper to resolve invoice recipients for a vendor.
 * Checks vendor contacts for primary email, falls back to vendor email.
 */
async function resolveStatementRecipient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string,
  vendorEmailRaw: string | null
): Promise<{ to: string | null; cc: string[] }> {
  const vendorEmails = String(vendorEmailRaw || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s && s.includes('@'))

  const { data: contacts } = await supabase
    .from('invoice_vendor_contacts')
    .select('email, is_primary, receive_invoice_copy')
    .eq('vendor_id', vendorId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  const contactEmails = (contacts || [])
    .map((contact: { email: string | null; is_primary: boolean; receive_invoice_copy: boolean | null }) => ({
      email: typeof contact?.email === 'string' ? contact.email.trim() : '',
      isPrimary: !!contact?.is_primary,
      cc: !!contact?.receive_invoice_copy,
    }))
    .filter((contact) => contact.email && contact.email.includes('@'))

  const primaryEmail = contactEmails.find((c) => c.isPrimary)?.email || null
  const firstVendorEmail = vendorEmails[0] || null
  const to = primaryEmail || firstVendorEmail || contactEmails[0]?.email || null

  const ccRaw = [
    ...vendorEmails.slice(firstVendorEmail ? 1 : 0),
    ...contactEmails.filter((c) => c.cc).map((c) => c.email),
  ]

  const seen = new Set<string>()
  const toLower = to ? to.toLowerCase() : null
  const cc = ccRaw
    .map((email) => email.trim())
    .filter((email) => email && email.includes('@') && email.toLowerCase() !== toLower)
    .filter((email) => {
      const key = email.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return { to, cc }
}

export async function sendStatementEmail(
  vendorId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ success?: boolean; error?: string }> {
  // Sending a statement puts a PDF of the client's account in front of the
  // client, so it needs the same authority as any other outward-facing action
  // in this section. Viewing the statement on screen stays on 'view'.
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to send statements' }

  // Get statement data
  const result = await getClientStatement(vendorId, dateFrom, dateTo)
  if (result.error || !result.statement) {
    return { error: result.error || 'Failed to generate statement data' }
  }

  const { statement } = result
  const supabase = await createClient()

  // Resolve recipient
  const recipientResult = await resolveStatementRecipient(
    supabase,
    vendorId,
    statement.vendor.email
  )

  if (!recipientResult.to) {
    return { error: 'No billing email configured for this vendor' }
  }

  // Generate PDF
  const pdfBuffer = await generateStatementPDF({
    vendorName: statement.vendor.name,
    periodFrom: dateFrom,
    periodTo: dateTo,
    openingBalance: statement.openingBalance,
    transactions: statement.transactions,
    closingBalance: statement.closingBalance,
    ageing: statement.ageing,
  })

  // Format date range for subject
  const fromDate = new Date(dateFrom + 'T00:00:00Z')
  const toDate = new Date(dateTo + 'T00:00:00Z')
  const fromLabel = fromDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const toLabel = toDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const subject = `Account Statement: ${statement.vendor.name}, ${fromLabel} to ${toLabel}`
  const closingLabel = statement.closingBalance < 0
    ? `Credit balance: £${Math.abs(statement.closingBalance).toFixed(2)}`
    : `£${statement.closingBalance.toFixed(2)}`

  const bodyHtml = `
    <p>Dear ${escapeHtml(statement.vendor.name)},</p>
    <p>Please find attached your account statement for the period ${escapeHtml(formatStatementDate(dateFrom))} to ${escapeHtml(formatStatementDate(dateTo))}.</p>
    <p>Current balance: <strong>${closingLabel}</strong></p>
    <p>If you have any questions, please don't hesitate to get in touch.</p>
    <p>Kind regards,<br>Orange Jelly Limited</p>
  `

  // Derive vendor code for filename
  const vendorCode = statement.vendor.name
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()

  const emailResult = await sendEmail({
    to: recipientResult.to,
    subject,
    html: bodyHtml,
    cc: recipientResult.cc,
    attachments: [
      {
        name: `statement-${vendorCode}-${dateFrom}-${dateTo}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })

  // Looked up before the send so the failure path can be attributed too.
  const { data: { user } } = await supabase.auth.getUser()

  // invoice_email_logs requires a row to reference an invoice or a quote, and a
  // statement is neither, so every insert here was silently rejected and no
  // statement send has ever been recorded. The error was never checked and the
  // function reported success regardless. email_messages carries no such
  // constraint.
  const recordSend = async (status: 'sent' | 'failed', errorMessage?: string) => {
    const { error: logError } = await supabase.from('email_messages').insert({
      to_address: recipientResult.to,
      subject,
      body_html: bodyHtml,
      direction: 'outbound',
      comm_type: 'oj_statement',
      status,
      error: errorMessage || null,
      sent_at: status === 'sent' ? new Date().toISOString() : null,
      metadata: {
        vendor_id: vendorId,
        cc: recipientResult.cc || null,
        sent_by: user?.id || null,
        period_from: dateFrom,
        period_to: dateTo,
      },
    })

    // Checked, unlike the insert this replaces. A rejected log row is why no
    // statement send was ever recorded.
    if (logError) {
      console.error('[client-statement] failed to record statement email:', logError.message)
    }
  }

  if (!emailResult.success) {
    // Recorded before returning, so a send that timed out after the mail was
    // accepted leaves a trace. Without it the only visible outcome was an error
    // and the operator's instinct is to click again, sending a second copy.
    await recordSend('failed', emailResult.error)
    return { error: emailResult.error || 'Failed to send statement email' }
  }

  await recordSend('sent')

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'send',
    resource_type: 'statement',
    resource_id: vendorId,
    operation_status: 'success',
    new_values: {
      action: 'statement_sent',
      vendor_name: statement.vendor.name,
      period_from: dateFrom,
      period_to: dateTo,
      recipient: recipientResult.to,
    },
  })

  return { success: true }
}
