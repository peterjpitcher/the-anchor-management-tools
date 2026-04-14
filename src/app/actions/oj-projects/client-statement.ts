'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { roundMoney } from '@/lib/oj-projects/utils'
import { sendEmail } from '@/lib/email/emailService'
import { generateStatementPDF } from '@/lib/oj-statement'
import { logAuditEvent } from '@/app/actions/audit'
import { escapeHtml } from '@/lib/cron/alerting'

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

  // Fetch all OJ Projects invoices for this vendor (dual-filter pattern)
  // Exclude void, written_off, and draft invoices (per decision D1)
  const { data: allInvoices, error: invoicesError } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, status, total_amount, paid_amount, created_at')
    .eq('vendor_id', vendorId)
    .is('deleted_at', null)
    .ilike('reference', 'OJ Projects %')
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
      // credit_notes table may not exist yet — gracefully handle
      console.warn('[client-statement] credit_notes query failed (table may not exist):', cnError.message)
    } else {
      allCreditNotes = creditNotes || []
    }
  }

  // Opening balance: sum of unpaid amounts on invoices created BEFORE dateFrom
  const openingBalance = roundMoney(
    invoices
      .filter((inv) => inv.invoice_date < dateFrom)
      .reduce((acc, inv) => {
        const total = Number(inv.total_amount || 0)
        // Subtract payments made before dateFrom for these invoices
        const paymentsBefore = allPayments
          .filter((p) => p.invoice_id === inv.id && p.payment_date < dateFrom)
          .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        // Subtract credit notes created before dateFrom
        const creditsBefore = allCreditNotes
          .filter((cn) => cn.invoice_id === inv.id && cn.created_at.slice(0, 10) < dateFrom)
          .reduce((sum, cn) => sum + Number(cn.amount_inc_vat || 0), 0)
        return acc + Math.max(total - paymentsBefore - creditsBefore, 0)
      }, 0)
  )

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
        ? ` — ${payment.payment_method.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
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

  return {
    statement: {
      vendor: { id: vendor.id, name: vendor.name, email: vendor.email || null },
      period: { from: dateFrom, to: dateTo },
      openingBalance,
      transactions,
      closingBalance,
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
  const hasPermission = await checkUserPermission('oj_projects', 'view')
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
  })

  // Format date range for subject
  const fromDate = new Date(dateFrom + 'T00:00:00Z')
  const toDate = new Date(dateTo + 'T00:00:00Z')
  const fromLabel = fromDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const toLabel = toDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const subject = `Account Statement — ${statement.vendor.name} — ${fromLabel} to ${toLabel}`
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

  if (!emailResult.success) {
    return { error: emailResult.error || 'Failed to send statement email' }
  }

  // Log to invoice_email_logs
  const { data: { user } } = await supabase.auth.getUser()

  await supabase.from('invoice_email_logs').insert({
    invoice_id: null,
    sent_to: recipientResult.to,
    sent_by: user?.id || null,
    subject,
    body: bodyHtml,
    status: 'sent',
  })

  await logAuditEvent({
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
