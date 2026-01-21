import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import { isGraphConfigured, sendInvoiceEmail } from '@/lib/microsoft-graph'
import { generateOjTimesheetPDF } from '@/lib/oj-timesheet'
import { formatInTimeZone } from 'date-fns-tz'
import type { InvoiceWithDetails } from '@/types/invoices'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const LONDON_TZ = 'Europe/London'
const OJ_INVOICE_NOTES_MAX_CHARS = 8000
const OJ_TIMESHEET_MARKER = 'OJ_TIMESHEET_ATTACHMENT=1'

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function toIsoDateUtc(date: Date) {
  return date.toISOString().slice(0, 10)
}

function moneyIncVat(exVat: number, vatRate: number) {
  const safeExVat = Number.isFinite(exVat) ? exVat : 0
  const safeVatRate = Number.isFinite(vatRate) ? vatRate : 0
  const vat = roundMoney(safeExVat * (safeVatRate / 100))
  return roundMoney(safeExVat + vat)
}

function parseRecipientList(raw: string | null) {
  if (!raw) return []
  return String(raw)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function toLondonTimeHm(iso: string | null) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: LONDON_TZ,
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

function addDaysIsoDate(dateIso: string, days: number) {
  const [y, m, d] = dateIso.split('-').map((v) => Number.parseInt(v, 10))
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function getPreviousMonthPeriod(now: Date) {
  const year = Number(formatInTimeZone(now, LONDON_TZ, 'yyyy'))
  const month1 = Number(formatInTimeZone(now, LONDON_TZ, 'MM')) // 1..12 (current month)
  const currentMonthIndex = month1 - 1 // 0..11

  const prevMonthEndUtc = new Date(Date.UTC(year, currentMonthIndex, 0))
  const prevMonthStartUtc = new Date(Date.UTC(year, currentMonthIndex - 1, 1))

  return {
    period_start: toIsoDateUtc(prevMonthStartUtc),
    period_end: toIsoDateUtc(prevMonthEndUtc),
    period_yyyymm: formatInTimeZone(prevMonthEndUtc, LONDON_TZ, 'yyyy-MM'),
  }
}

async function resolveInvoiceRecipients(
  supabase: ReturnType<typeof createAdminClient>,
  vendorId: string,
  vendorEmailRaw: string | null
) {
  const recipientsFromVendor = parseRecipientList(vendorEmailRaw)

  const { data: contacts, error } = await supabase
    .from('invoice_vendor_contacts')
    .select('email, is_primary, receive_invoice_copy')
    .eq('vendor_id', vendorId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) return { error: error.message as string }

  const contactEmails = (contacts || [])
    .map((c: any) => ({
      email: c?.email ? String(c.email).trim() : '',
      isPrimary: !!c?.is_primary,
      cc: !!c?.receive_invoice_copy,
    }))
    .filter((c) => c.email && c.email.includes('@'))

  const primaryEmail = contactEmails.find((c) => c.isPrimary)?.email || null
  const firstVendorEmail = recipientsFromVendor[0] || null
  const to = primaryEmail || firstVendorEmail || contactEmails[0]?.email || null

  const ccRaw = [
    ...recipientsFromVendor.slice(firstVendorEmail ? 1 : 0),
    ...contactEmails.filter((c) => c.cc).map((c) => c.email),
  ]

  const seen = new Set<string>()
  const toLower = to ? to.toLowerCase() : null
  const cc = ccRaw
    .map((e) => e.trim())
    .filter((e) => e && e.includes('@') && e.toLowerCase() !== toLower)
    .filter((e) => {
      const key = e.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return { to, cc }
}

function buildInvoiceNotes(input: {
  period_start: string
  period_end: string
  selectedTimeEntries: any[]
  selectedMileageEntries: any[]
  includeEntryDetails: boolean
  billingMode: 'full' | 'cap'
  capIncVat: number | null
  carriedForwardIncVat: number | null
  carriedForwardRecurringInstances?: any[]
  carriedForwardMileageEntries?: any[]
  carriedForwardTimeEntries?: any[]
}) {
  const lines: string[] = []
  lines.push(`OJ Projects timesheet`)
  lines.push(`Billing month: ${input.period_start} to ${input.period_end}`)
  lines.push(`Includes unbilled billable work up to ${input.period_end} (older items may appear if previously unbilled).`)
  lines.push(`Rounding: time is rounded up to 15 minutes per entry`)

  const getWorkTypeLabel = (e: any) => String(e.work_type_name_snapshot || e.work_type?.name || 'Unspecified')

  // Invoice-wide work type totals
  const invoiceWorkTypeTotals = new Map<string, number>()
  for (const e of input.selectedTimeEntries || []) {
    const minutes = Number(e.duration_minutes_rounded || 0)
    if (minutes <= 0) continue
    const label = getWorkTypeLabel(e)
    invoiceWorkTypeTotals.set(label, (invoiceWorkTypeTotals.get(label) || 0) + minutes)
  }

  if (invoiceWorkTypeTotals.size > 0) {
    lines.push('')
    lines.push('Work type totals (invoice)')
    for (const [label, minutes] of invoiceWorkTypeTotals) {
      lines.push(`- ${label}: ${(minutes / 60).toFixed(2)}h`)
    }
  }

  // Time by project → work type → entry
  const timeByProject = new Map<string, { projectLabel: string; entries: any[] }>()
  for (const e of input.selectedTimeEntries || []) {
    const projectLabel = e?.project?.project_code
      ? `${e.project.project_code} — ${e.project.project_name || 'Project'}`
      : e?.project?.project_name || 'Project'
    const key = String(e.project_id)
    const bucket = timeByProject.get(key) || { projectLabel, entries: [] as any[] }
    bucket.entries.push(e)
    timeByProject.set(key, bucket)
  }

  if (timeByProject.size > 0) {
    lines.push('')
    lines.push('Time')
    for (const [, bucket] of timeByProject) {
      lines.push(`- ${bucket.projectLabel}`)

      const workTypeTotals = new Map<string, number>()
      let projectMinutes = 0
      for (const e of bucket.entries) {
        const minutes = Number(e.duration_minutes_rounded || 0)
        projectMinutes += minutes
        workTypeTotals.set(getWorkTypeLabel(e), (workTypeTotals.get(getWorkTypeLabel(e)) || 0) + minutes)
      }

      const projectHours = projectMinutes / 60
      lines.push(`  Total: ${projectHours.toFixed(2)} hours`)

      if (workTypeTotals.size > 0) {
        lines.push(`  Work types:`)
        for (const [name, minutes] of workTypeTotals) {
          lines.push(`    - ${name}: ${(minutes / 60).toFixed(2)}h`)
        }
      }

      if (input.includeEntryDetails) {
        lines.push(`  Entries:`)
        for (const e of bucket.entries) {
          const start = toLondonTimeHm(e.start_at) || ''
          const end = toLondonTimeHm(e.end_at) || ''
          const hours = Number(e.duration_minutes_rounded || 0) / 60
          const workType = getWorkTypeLabel(e)
          const desc = e.description ? String(e.description).replace(/\s+/g, ' ').trim() : ''
          lines.push(`    - ${e.entry_date} ${start}–${end} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`)
        }
      } else {
        lines.push(`  Entries: ${bucket.entries.length}`)
      }
    }
  }

  if ((input.selectedMileageEntries?.length ?? 0) > 0) {
    lines.push('')
    lines.push('Mileage')
    if (input.includeEntryDetails) {
      for (const e of input.selectedMileageEntries) {
        const miles = Number(e.miles || 0)
        const desc = e.description ? String(e.description).replace(/\s+/g, ' ').trim() : ''
        const projectLabel = e?.project?.project_code
          ? `${e.project.project_code} — ${e.project.project_name || 'Project'}`
          : e?.project?.project_name || 'Project'
        lines.push(`- ${e.entry_date} • ${projectLabel} • ${miles.toFixed(2)} miles${desc ? ` • ${desc}` : ''}`)
      }
    } else {
      const byProject = new Map<string, number>()
      let totalMiles = 0
      for (const e of input.selectedMileageEntries) {
        const miles = Number(e.miles || 0)
        totalMiles += miles
        const projectLabel = e?.project?.project_code
          ? `${e.project.project_code} — ${e.project.project_name || 'Project'}`
          : e?.project?.project_name || 'Project'
        byProject.set(projectLabel, (byProject.get(projectLabel) || 0) + miles)
      }
      lines.push(`Total: ${totalMiles.toFixed(2)} miles`)
      for (const [projectLabel, miles] of byProject) {
        lines.push(`- ${projectLabel}: ${miles.toFixed(2)} miles`)
      }
    }
  }

  if (input.billingMode === 'cap') {
    lines.push('')
    lines.push(`Billing mode: Monthly cap`)
    if (input.capIncVat != null) lines.push(`Cap (inc VAT): £${input.capIncVat.toFixed(2)}`)

    if (input.carriedForwardIncVat != null) {
      lines.push('')
      lines.push(`Carried forward / not billed yet`)
      lines.push(`Total (inc VAT): £${input.carriedForwardIncVat.toFixed(2)}`)

      const cfRecurring = input.carriedForwardRecurringInstances || []
      const cfMileage = input.carriedForwardMileageEntries || []
      const cfTime = input.carriedForwardTimeEntries || []

      if (cfRecurring.length + cfMileage.length + cfTime.length > 0) {
        const recurringIncVat = cfRecurring.reduce((acc: number, c: any) => {
          const exVat = roundMoney(Number(c.amount_ex_vat_snapshot || 0))
          const vatRate = Number(c.vat_rate_snapshot || 0)
          return acc + moneyIncVat(exVat, vatRate)
        }, 0)

        const mileageMiles = cfMileage.reduce((acc: number, e: any) => acc + Number(e.miles || 0), 0)
        const mileageIncVat = cfMileage.reduce((acc: number, e: any) => {
          const miles = Number(e.miles || 0)
          const rate = Number(e.mileage_rate_snapshot || 0.42)
          return acc + roundMoney(miles * rate)
        }, 0)

        const timeMinutes = cfTime.reduce((acc: number, e: any) => acc + Number(e.duration_minutes_rounded || 0), 0)
        const timeIncVat = cfTime.reduce((acc: number, e: any) => {
          const minutes = Number(e.duration_minutes_rounded || 0)
          const hours = minutes / 60
          const rate = Number(e.hourly_rate_ex_vat_snapshot || 0)
          const vatRate = Number(e.vat_rate_snapshot || 0)
          return acc + moneyIncVat(roundMoney(hours * rate), vatRate)
        }, 0)

        if (cfRecurring.length > 0) lines.push(`- Recurring charges: £${roundMoney(recurringIncVat).toFixed(2)} (${cfRecurring.length} items)`)
        if (cfMileage.length > 0) lines.push(`- Mileage: £${roundMoney(mileageIncVat).toFixed(2)} (${mileageMiles.toFixed(2)} miles)`)
        if (cfTime.length > 0) lines.push(`- Time: £${roundMoney(timeIncVat).toFixed(2)} (${(timeMinutes / 60).toFixed(2)} hours)`)
      }
    }
  }

  return lines.join('\n')
}

async function loadInvoiceWithDetails(supabase: ReturnType<typeof createAdminClient>, invoiceId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select(
      `
      *,
      vendor:invoice_vendors(*),
      line_items:invoice_line_items(*),
      payments:invoice_payments(*)
    `
    )
    .eq('id', invoiceId)
    .single()

  if (error) return { error: error.message as string }
  return { invoice: data as InvoiceWithDetails }
}

export async function GET(request: Request) {
  const authResult = authorizeCronRequest(request)
  if (!authResult.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const force = url.searchParams.get('force') === 'true'

  const now = new Date()
  const londonDay = Number(formatInTimeZone(now, LONDON_TZ, 'd'))
  if (londonDay !== 1 && !force) {
    return NextResponse.json({ skipped: true, reason: 'Not the 1st in Europe/London' })
  }

  const period = getPreviousMonthPeriod(now)
  const invoiceDate = formatInTimeZone(now, LONDON_TZ, 'yyyy-MM-dd')

  const supabase = createAdminClient()

  const vendorIds = new Set<string>()

  // Vendors with eligible entries up to period_end
  const { data: entryVendors, error: entryVendorError } = await supabase
    .from('oj_entries')
    .select('vendor_id')
    .eq('status', 'unbilled')
    .eq('billable', true)
    .lte('entry_date', period.period_end)
    .limit(10000)

  if (entryVendorError) {
    return NextResponse.json({ error: entryVendorError.message }, { status: 500 })
  }
  for (const row of entryVendors || []) {
    if (row?.vendor_id) vendorIds.add(String(row.vendor_id))
  }

  // Vendors with active recurring charges
  const { data: chargeVendors, error: chargeVendorError } = await supabase
    .from('oj_vendor_recurring_charges')
    .select('vendor_id')
    .eq('is_active', true)
    .limit(10000)

  if (chargeVendorError) {
    return NextResponse.json({ error: chargeVendorError.message }, { status: 500 })
  }
  for (const row of chargeVendors || []) {
    if (row?.vendor_id) vendorIds.add(String(row.vendor_id))
  }

  // Vendors with unbilled recurring charge instances (carry-forward)
  const { data: instanceVendors, error: instanceVendorError } = await supabase
    .from('oj_recurring_charge_instances')
    .select('vendor_id')
    .eq('status', 'unbilled')
    .lte('period_end', period.period_end)
    .limit(10000)

  if (instanceVendorError) {
    return NextResponse.json({ error: instanceVendorError.message }, { status: 500 })
  }
  for (const row of instanceVendors || []) {
    if (row?.vendor_id) vendorIds.add(String(row.vendor_id))
  }

  // Vendors with failed runs for this period (retry)
  const { data: failedRuns } = await supabase
    .from('oj_billing_runs')
    .select('vendor_id')
    .eq('period_yyyymm', period.period_yyyymm)
    .eq('status', 'failed')
    .limit(10000)

  for (const row of failedRuns || []) {
    if (row?.vendor_id) vendorIds.add(String(row.vendor_id))
  }

  const results = {
    period: period.period_yyyymm,
    invoice_date: invoiceDate,
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    vendors: [] as Array<{
      vendor_id: string
      status: 'sent' | 'skipped' | 'failed'
      invoice_id?: string
      invoice_number?: string
      error?: string
    }>,
  }

  for (const vendorId of vendorIds) {
    results.processed++
    try {
      // Load vendor
      const { data: vendor, error: vendorError } = await supabase
        .from('invoice_vendors')
        .select('id, name, email, contact_name, payment_terms')
        .eq('id', vendorId)
        .single()
      if (vendorError || !vendor) throw new Error(vendorError?.message || 'Vendor not found')

      // Create or load billing run (idempotency)
      let billingRun: any | null = null
      try {
        const { data: created, error: createError } = await supabase
          .from('oj_billing_runs')
          .insert({
            vendor_id: vendorId,
            period_yyyymm: period.period_yyyymm,
            period_start: period.period_start,
            period_end: period.period_end,
            status: 'processing',
          })
          .select('*')
          .single()

        if (createError) {
          const { data: existing, error: existingError } = await supabase
            .from('oj_billing_runs')
            .select('*')
            .eq('vendor_id', vendorId)
            .eq('period_yyyymm', period.period_yyyymm)
            .single()

          if (existingError || !existing) {
            throw new Error(createError.message || existingError?.message || 'Failed to create or load billing run')
          }

          billingRun = existing
        } else {
          billingRun = created
        }
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to initialise billing run')
      }

      if (!billingRun) throw new Error('Failed to initialise billing run')

      if (billingRun.status === 'sent') {
        results.skipped++
        results.vendors.push({ vendor_id: vendorId, status: 'skipped', invoice_id: billingRun.invoice_id || undefined })
        continue
      }

      // Recover invoice_id if the run created an invoice but crashed before persisting the linkage.
      if (!billingRun.invoice_id) {
        const { data: recoveredInvoice } = await supabase
          .from('invoices')
          .select('id')
          .eq('vendor_id', vendorId)
          .eq('reference', `OJ Projects ${period.period_yyyymm}`)
          .ilike('internal_notes', `%${billingRun.id}%`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (recoveredInvoice?.id) {
          billingRun.invoice_id = recoveredInvoice.id
          await supabase
            .from('oj_billing_runs')
            .update({ invoice_id: recoveredInvoice.id, updated_at: new Date().toISOString() })
            .eq('id', billingRun.id)
        }
      }

      // If an invoice exists for this run, attempt to send/reconcile it and avoid duplicates.
      if (billingRun.invoice_id) {
        const loaded = await loadInvoiceWithDetails(supabase, billingRun.invoice_id)
        if ('error' in loaded) throw new Error(loaded.error)
        const invoice = loaded.invoice

        if (!isGraphConfigured()) {
          await supabase
            .from('oj_billing_runs')
            .update({
              status: 'failed',
              error_message: 'Email service is not configured',
              updated_at: new Date().toISOString(),
            })
            .eq('id', billingRun.id)

          results.failed++
          results.vendors.push({
            vendor_id: vendorId,
            status: 'failed',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            error: 'Email service is not configured',
          })
          continue
        }

        const recipients = await resolveInvoiceRecipients(supabase, vendorId, vendor.email)
        if ('error' in recipients) throw new Error(recipients.error)
        if (!recipients.to) throw new Error('No invoice recipient email configured (primary contact or vendor email)')

        // If already sent/paid, just reconcile entries + run status
        if (['sent', 'paid', 'overdue', 'partially_paid'].includes(String(invoice.status))) {
          const nextStatus = invoice.status === 'paid' ? 'paid' : 'billed'
          const updatePayload: any =
            nextStatus === 'paid'
              ? { status: 'paid', invoice_id: invoice.id, billed_at: new Date().toISOString(), paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }
              : { status: 'billed', invoice_id: invoice.id, billed_at: new Date().toISOString(), updated_at: new Date().toISOString() }

          await supabase
            .from('oj_entries')
            .update(updatePayload)
            .eq('billing_run_id', billingRun.id)
            .eq('status', 'billing_pending')

          await supabase
            .from('oj_recurring_charge_instances')
            .update(updatePayload)
            .eq('billing_run_id', billingRun.id)
            .eq('status', 'billing_pending')

          await supabase
            .from('oj_billing_runs')
            .update({ status: 'sent', error_message: null, run_finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq('id', billingRun.id)

          results.sent++
          results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoice.id, invoice_number: invoice.invoice_number })
          continue
        }

        const subject = `Invoice ${invoice.invoice_number} from Orange Jelly Limited`
        const body = `Hi ${vendor.contact_name || vendor.name || 'there'},\n\nPlease find attached invoice ${invoice.invoice_number}.\n\nBest regards,\nPeter\nOrange Jelly Limited`

        const shouldAttachTimesheet =
          String(invoice.internal_notes || '').includes(OJ_TIMESHEET_MARKER) ||
          String(invoice.notes || '').includes('Full breakdown attached as Timesheet PDF.')

        let additionalAttachments: Array<{ name: string; contentType: string; buffer: Buffer }> | undefined
        if (shouldAttachTimesheet) {
          const { data: settings } = await supabase
            .from('oj_vendor_billing_settings')
            .select('billing_mode, monthly_cap_inc_vat')
            .eq('vendor_id', vendorId)
            .maybeSingle()

          const billingMode: 'full' | 'cap' = settings?.billing_mode === 'cap' ? 'cap' : 'full'
          const capIncVat = billingMode === 'cap' && typeof settings?.monthly_cap_inc_vat === 'number' ? settings.monthly_cap_inc_vat : null
          const carriedForwardIncVat = typeof billingRun?.carried_forward_inc_vat === 'number' ? billingRun.carried_forward_inc_vat : null

          const { data: runEntries, error: runEntriesError } = await supabase
            .from('oj_entries')
            .select(
              `
              *,
              project:oj_projects(
                id,
                project_code,
                project_name
              ),
              work_type:oj_work_types(
                id,
                name
              )
            `
            )
            .eq('billing_run_id', billingRun.id)
            .order('entry_date', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(10000)

          if (runEntriesError) throw new Error(runEntriesError.message)

          const selectedMileageEntries = (runEntries || []).filter((e: any) => e.entry_type === 'mileage')
          const selectedTimeEntries = (runEntries || []).filter((e: any) => e.entry_type === 'time')

          const timesheetNotes = buildInvoiceNotes({
            period_start: String(billingRun.period_start),
            period_end: String(billingRun.period_end),
            selectedTimeEntries,
            selectedMileageEntries,
            includeEntryDetails: true,
            billingMode,
            capIncVat,
            carriedForwardIncVat,
            carriedForwardRecurringInstances: [],
            carriedForwardMileageEntries: [],
            carriedForwardTimeEntries: [],
          })

          const timesheetPdf = await generateOjTimesheetPDF({
            invoiceNumber: invoice.invoice_number,
            vendorName: vendor.name,
            periodStart: String(billingRun.period_start),
            periodEnd: String(billingRun.period_end),
            notesText: timesheetNotes,
          })

          additionalAttachments = [
            {
              name: `timesheet-${invoice.invoice_number}.pdf`,
              contentType: 'application/pdf',
              buffer: timesheetPdf,
            },
          ]
        }

        const sendRes = await sendInvoiceEmail(invoice, recipients.to, subject, body, recipients.cc, additionalAttachments)
        if (!sendRes.success) {
          await supabase
            .from('oj_billing_runs')
            .update({ status: 'failed', error_message: sendRes.error || 'Failed to send invoice email', updated_at: new Date().toISOString() })
            .eq('id', billingRun.id)

          results.failed++
          results.vendors.push({
            vendor_id: vendorId,
            status: 'failed',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            error: sendRes.error || 'Failed to send invoice email',
          })
          continue
        }

        await supabase
          .from('invoices')
          .update({ status: 'sent', updated_at: new Date().toISOString() })
          .eq('id', invoice.id)

        // Log To + CC
        await supabase.from('invoice_email_logs').insert({
          invoice_id: invoice.id,
          sent_to: recipients.to,
          sent_by: 'system',
          subject,
          body: 'Automatically sent by OJ Projects monthly billing.',
          status: 'sent',
        })
        for (const cc of recipients.cc) {
          await supabase.from('invoice_email_logs').insert({
            invoice_id: invoice.id,
            sent_to: cc,
            sent_by: 'system',
            subject,
            body: 'Automatically sent by OJ Projects monthly billing.',
            status: 'sent',
          })
        }

        await supabase
          .from('oj_entries')
          .update({
            status: 'billed',
            invoice_id: invoice.id,
            billed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('billing_run_id', billingRun.id)
          .eq('status', 'billing_pending')

        await supabase
          .from('oj_recurring_charge_instances')
          .update({
            status: 'billed',
            invoice_id: invoice.id,
            billed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('billing_run_id', billingRun.id)
          .eq('status', 'billing_pending')

        await supabase
          .from('oj_billing_runs')
          .update({
            status: 'sent',
            error_message: null,
            run_finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', billingRun.id)

        results.sent++
        results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoice.id, invoice_number: invoice.invoice_number })
        continue
      }

      // If the run has no invoice and has stranded pending items (e.g. crash before invoice creation),
      // unlock them so they can be billed on the next attempt.
      const { data: strandedPending, error: strandedError } = await supabase
        .from('oj_entries')
        .select('id')
        .eq('billing_run_id', billingRun.id)
        .eq('status', 'billing_pending')
        .limit(10000)
      if (strandedError) throw new Error(strandedError.message)

      const { data: strandedRecurring, error: strandedRecurringError } = await supabase
        .from('oj_recurring_charge_instances')
        .select('id')
        .eq('billing_run_id', billingRun.id)
        .eq('status', 'billing_pending')
        .limit(10000)
      if (strandedRecurringError) throw new Error(strandedRecurringError.message)

      const hasStranded = (strandedPending?.length ?? 0) > 0 || (strandedRecurring?.length ?? 0) > 0
      if (hasStranded) {
        await supabase
          .from('oj_entries')
          .update({ status: 'unbilled', billing_run_id: null, updated_at: new Date().toISOString() })
          .eq('billing_run_id', billingRun.id)
          .eq('status', 'billing_pending')

        await supabase
          .from('oj_recurring_charge_instances')
          .update({ status: 'unbilled', billing_run_id: null, updated_at: new Date().toISOString() })
          .eq('billing_run_id', billingRun.id)
          .eq('status', 'billing_pending')

        await supabase
          .from('oj_billing_runs')
          .update({
            status: 'processing',
            selected_entry_ids: null,
            carried_forward_inc_vat: null,
            error_message: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', billingRun.id)
      }

      // Load billing settings
      const { data: settings } = await supabase
        .from('oj_vendor_billing_settings')
        .select('*')
        .eq('vendor_id', vendorId)
        .maybeSingle()

      const billingMode: 'full' | 'cap' = settings?.billing_mode === 'cap' ? 'cap' : 'full'
      const capIncVat = billingMode === 'cap' && typeof settings?.monthly_cap_inc_vat === 'number' ? settings.monthly_cap_inc_vat : null

      // Load recurring charge definitions (active)
      const { data: recurringChargeDefs, error: recurringError } = await supabase
        .from('oj_vendor_recurring_charges')
        .select('*')
        .eq('vendor_id', vendorId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (recurringError) throw new Error(recurringError.message)

      // Ensure recurring charge instances exist for this billing period (idempotent insert)
      if ((recurringChargeDefs?.length ?? 0) > 0) {
        const instancePayload = (recurringChargeDefs || []).map((c: any) => ({
          vendor_id: vendorId,
          recurring_charge_id: c.id,
          period_yyyymm: period.period_yyyymm,
          period_start: period.period_start,
          period_end: period.period_end,
          description_snapshot: String(c.description || ''),
          amount_ex_vat_snapshot: roundMoney(Number(c.amount_ex_vat || 0)),
          vat_rate_snapshot: Number(c.vat_rate || 0),
          sort_order_snapshot: Number(c.sort_order || 0),
        }))

        const { error: instanceUpsertError } = await supabase
          .from('oj_recurring_charge_instances')
          .upsert(instancePayload, {
            onConflict: 'vendor_id,recurring_charge_id,period_yyyymm',
            ignoreDuplicates: true,
          })

        if (instanceUpsertError) throw new Error(instanceUpsertError.message)
      }

      // Load eligible recurring charge instances (including older carry-forward items)
      const { data: eligibleRecurringInstances, error: recurringInstanceError } = await supabase
        .from('oj_recurring_charge_instances')
        .select('*')
        .eq('vendor_id', vendorId)
        .eq('status', 'unbilled')
        .lte('period_end', period.period_end)
        .order('period_end', { ascending: true })
        .order('sort_order_snapshot', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(10000)

      if (recurringInstanceError) throw new Error(recurringInstanceError.message)

      // Load eligible entries
      const { data: eligibleEntries, error: entriesError } = await supabase
        .from('oj_entries')
        .select(
          `
          *,
          project:oj_projects(
            id,
            project_code,
            project_name
          ),
          work_type:oj_work_types(
            id,
            name
          )
        `
        )
        .eq('vendor_id', vendorId)
        .eq('status', 'unbilled')
        .eq('billable', true)
        .lte('entry_date', period.period_end)
        .order('entry_date', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(10000)
      if (entriesError) throw new Error(entriesError.message)

      const mileageEntries = (eligibleEntries || []).filter((e: any) => e.entry_type === 'mileage')
      const timeEntries = (eligibleEntries || []).filter((e: any) => e.entry_type === 'time')

      const selectedRecurringInstances: any[] = []
      const selectedMileage: any[] = []
      const selectedTime: any[] = []

      const skippedRecurringInstances: any[] = []
      const skippedMileage: any[] = []
      const skippedTime: any[] = []

      let runningIncVat = 0

      const capPounds = capIncVat != null ? roundMoney(Number(capIncVat) || 0) : null

      const includeItem = (incVat: number) => {
        if (billingMode !== 'cap') return true
        if (!capPounds || capPounds <= 0) return false
        const next = roundMoney(runningIncVat + incVat)
        if (next <= capPounds) {
          runningIncVat = next
          return true
        }
        return false
      }

      for (const c of eligibleRecurringInstances || []) {
        const exVat = roundMoney(Number(c.amount_ex_vat_snapshot || 0))
        const vatRate = Number(c.vat_rate_snapshot || 0)
        const incVat = moneyIncVat(exVat, vatRate)
        if (includeItem(incVat)) selectedRecurringInstances.push(c)
        else skippedRecurringInstances.push(c)
      }

      for (const e of mileageEntries) {
        const miles = Number(e.miles || 0)
        const rate = Number(e.mileage_rate_snapshot || settings?.mileage_rate || 0.42)
        const exVat = roundMoney(miles * rate)
        const incVat = exVat
        if (includeItem(incVat)) selectedMileage.push(e)
        else skippedMileage.push(e)
      }

      for (const e of timeEntries) {
        const minutes = Number(e.duration_minutes_rounded || 0)
        const hours = minutes / 60
        const rate = Number(e.hourly_rate_ex_vat_snapshot || settings?.hourly_rate_ex_vat || 75)
        const vatRate = Number(e.vat_rate_snapshot ?? settings?.vat_rate ?? 20)
        const exVat = roundMoney(hours * rate)
        const incVat = moneyIncVat(exVat, vatRate)
        if (includeItem(incVat)) selectedTime.push(e)
        else skippedTime.push(e)
      }

      const carriedForwardIncVat =
        billingMode === 'cap'
          ? roundMoney(
            (skippedRecurringInstances || []).reduce((acc: number, item: any) => {
              const exVat = roundMoney(Number(item.amount_ex_vat_snapshot || 0))
              const vatRate = Number(item.vat_rate_snapshot || 0)
              return acc + moneyIncVat(exVat, vatRate)
            }, 0) +
            (skippedMileage || []).reduce((acc: number, item: any) => {
              const miles = Number(item.miles || 0)
              const rate = Number(item.mileage_rate_snapshot || settings?.mileage_rate || 0.42)
              return acc + roundMoney(miles * rate)
            }, 0) +
            (skippedTime || []).reduce((acc: number, item: any) => {
              const minutes = Number(item.duration_minutes_rounded || 0)
              const hours = minutes / 60
              const rate = Number(item.hourly_rate_ex_vat_snapshot || settings?.hourly_rate_ex_vat || 75)
              const vatRate = Number(item.vat_rate_snapshot ?? settings?.vat_rate ?? 20)
              return acc + moneyIncVat(roundMoney(hours * rate), vatRate)
            }, 0)
          )
          : null

      const selectedEntryIds = [...selectedMileage, ...selectedTime].map((e: any) => String(e.id))
      const selectedRecurringInstanceIds = (selectedRecurringInstances || []).map((c: any) => String(c.id))

      await supabase
        .from('oj_billing_runs')
        .update({
          selected_entry_ids: selectedEntryIds,
          carried_forward_inc_vat: carriedForwardIncVat,
          updated_at: new Date().toISOString(),
        })
        .eq('id', billingRun.id)

      // If nothing selected and nothing eligible, mark run sent (no invoice).
      const hasAnyEligible = (eligibleRecurringInstances?.length || 0) > 0 || (eligibleEntries?.length || 0) > 0
      const hasAnySelected = selectedRecurringInstances.length + selectedMileage.length + selectedTime.length > 0

      if (!hasAnySelected) {
        if (hasAnyEligible && billingMode === 'cap') {
          await supabase
            .from('oj_billing_runs')
            .update({
              status: 'failed',
              error_message: 'Nothing could be billed within the monthly cap. Increase the cap or reduce charges.',
              run_finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', billingRun.id)

          results.failed++
          results.vendors.push({ vendor_id: vendorId, status: 'failed', error: 'Nothing could be billed within the monthly cap.' })
          continue
        }

        await supabase
          .from('oj_billing_runs')
          .update({
            status: 'sent',
            invoice_id: null,
            error_message: null,
            run_finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', billingRun.id)

        results.skipped++
        results.vendors.push({ vendor_id: vendorId, status: 'skipped' })
        continue
      }

      // Lock selected entries to this billing run
      if (selectedEntryIds.length > 0) {
        const { error: lockError } = await supabase
          .from('oj_entries')
          .update({
            status: 'billing_pending',
            billing_run_id: billingRun.id,
            updated_at: new Date().toISOString(),
          })
          .in('id', selectedEntryIds)
          .eq('status', 'unbilled')

        if (lockError) throw new Error(lockError.message)
      }

      // Lock selected recurring charge instances to this billing run
      if (selectedRecurringInstanceIds.length > 0) {
        const { error: lockRecurringError } = await supabase
          .from('oj_recurring_charge_instances')
          .update({
            status: 'billing_pending',
            billing_run_id: billingRun.id,
            updated_at: new Date().toISOString(),
          })
          .in('id', selectedRecurringInstanceIds)
          .eq('status', 'unbilled')

        if (lockRecurringError) throw new Error(lockRecurringError.message)
      }

      // Build invoice line items
      const lineItems: Array<{
        catalog_item_id: string | null
        description: string
        quantity: number
        unit_price: number
        discount_percentage: number
        vat_rate: number
      }> = []

      for (const c of selectedRecurringInstances) {
        const baseDescription = String(c.description_snapshot || '')
        const description =
          c?.period_yyyymm && String(c.period_yyyymm) !== period.period_yyyymm
            ? `${baseDescription} (${c.period_yyyymm})`
            : baseDescription
        lineItems.push({
          catalog_item_id: null,
          description,
          quantity: 1,
          unit_price: Number(c.amount_ex_vat_snapshot || 0),
          discount_percentage: 0,
          vat_rate: Number(c.vat_rate_snapshot || 0),
        })
      }

      if (selectedMileage.length > 0) {
        const totalMiles = selectedMileage.reduce((acc: number, e: any) => acc + Number(e.miles || 0), 0)
        const rateSet = new Set(selectedMileage.map((e: any) => Number(e.mileage_rate_snapshot || settings?.mileage_rate || 0.42)))
        if (rateSet.size === 1) {
          const rate = [...rateSet][0]
          lineItems.push({
            catalog_item_id: null,
            description: `Mileage (${totalMiles.toFixed(2)} miles @ £${rate.toFixed(3)}/mile)`,
            quantity: roundMoney(totalMiles),
            unit_price: roundMoney(rate),
            discount_percentage: 0,
            vat_rate: 0,
          })
        } else {
          const totalExVat = selectedMileage.reduce((acc: number, e: any) => {
            const miles = Number(e.miles || 0)
            const rate = Number(e.mileage_rate_snapshot || settings?.mileage_rate || 0.42)
            return acc + roundMoney(miles * rate)
          }, 0)
          lineItems.push({
            catalog_item_id: null,
            description: `Mileage (${totalMiles.toFixed(2)} miles)`,
            quantity: 1,
            unit_price: roundMoney(totalExVat),
            discount_percentage: 0,
            vat_rate: 0,
          })
        }
      }

      const timeByProjectVat = new Map<string, { project: any; vatRate: number; entries: any[] }>()
      for (const e of selectedTime) {
        const vatRate = Number(e.vat_rate_snapshot ?? settings?.vat_rate ?? 20)
        const key = `${e.project_id}:${vatRate}`
        const bucket = timeByProjectVat.get(key) || { project: e.project, vatRate, entries: [] }
        bucket.entries.push(e)
        timeByProjectVat.set(key, bucket)
      }

      for (const [, bucket] of timeByProjectVat) {
        const project = bucket.project
        const totalMinutes = bucket.entries.reduce((acc: number, e: any) => acc + Number(e.duration_minutes_rounded || 0), 0)
        const totalHours = totalMinutes / 60
        const totalExVat = bucket.entries.reduce((acc: number, e: any) => {
          const minutes = Number(e.duration_minutes_rounded || 0)
          const hours = minutes / 60
          const rate = Number(e.hourly_rate_ex_vat_snapshot || settings?.hourly_rate_ex_vat || 75)
          return acc + roundMoney(hours * rate)
        }, 0)

        const label = project?.project_code
          ? `${project.project_code} — ${project.project_name || 'Project'}`
          : project?.project_name || 'Project'

        lineItems.push({
          catalog_item_id: null,
          description: `${label} (${totalHours.toFixed(2)}h)`,
          quantity: 1,
          unit_price: roundMoney(totalExVat),
          discount_percentage: 0,
          vat_rate: bucket.vatRate,
        })
      }

      if (lineItems.length === 0) {
        throw new Error('No invoice line items generated')
      }

      const totals = calculateInvoiceTotals(lineItems, 0)

      // Generate invoice number
      const { data: seqData, error: seqError } = await supabase
        .rpc('get_and_increment_invoice_series', { p_series_code: 'INV' })
        .single()

      if (seqError) throw new Error('Failed to generate invoice number')
      const nextSequence = (seqData as any)?.next_sequence
      const encoded = (Number(nextSequence) + 5000).toString(36).toUpperCase().padStart(5, '0')
      const invoiceNumber = `INV-${encoded}`

      const paymentTerms = typeof vendor.payment_terms === 'number' ? vendor.payment_terms : 30
      const dueDate = addDaysIsoDate(invoiceDate, paymentTerms)

      const notesFull = buildInvoiceNotes({
        period_start: period.period_start,
        period_end: period.period_end,
        selectedTimeEntries: selectedTime,
        selectedMileageEntries: selectedMileage,
        includeEntryDetails: true,
        billingMode,
        capIncVat,
        carriedForwardIncVat,
        carriedForwardRecurringInstances: skippedRecurringInstances,
        carriedForwardMileageEntries: skippedMileage,
        carriedForwardTimeEntries: skippedTime,
      })

      const notesCompact = buildInvoiceNotes({
        period_start: period.period_start,
        period_end: period.period_end,
        selectedTimeEntries: selectedTime,
        selectedMileageEntries: selectedMileage,
        includeEntryDetails: false,
        billingMode,
        capIncVat,
        carriedForwardIncVat,
        carriedForwardRecurringInstances: skippedRecurringInstances,
        carriedForwardMileageEntries: skippedMileage,
        carriedForwardTimeEntries: skippedTime,
      })

      const attachTimesheet = notesFull.length > OJ_INVOICE_NOTES_MAX_CHARS
      const notes = attachTimesheet ? `${notesCompact}\n\nFull breakdown attached as Timesheet PDF.` : notesFull

      const internalNotes = attachTimesheet
        ? `Auto-generated by OJ Projects billing run ${billingRun.id} (${period.period_yyyymm}). ${OJ_TIMESHEET_MARKER}`
        : `Auto-generated by OJ Projects billing run ${billingRun.id} (${period.period_yyyymm}).`

      const invoiceData = {
        invoice_number: invoiceNumber,
        vendor_id: vendorId,
        invoice_date: invoiceDate,
        due_date: dueDate,
        reference: `OJ Projects ${period.period_yyyymm}`,
        invoice_discount_percentage: 0,
        subtotal_amount: totals.subtotalBeforeInvoiceDiscount,
        discount_amount: totals.invoiceDiscountAmount,
        vat_amount: totals.vatAmount,
        total_amount: totals.totalAmount,
        notes,
        internal_notes: internalNotes,
        status: 'draft',
      }

      const { data: createdInvoice, error: createInvoiceError } = await supabase.rpc('create_invoice_transaction', {
        p_invoice_data: invoiceData,
        p_line_items: lineItems,
      })

      if (createInvoiceError || !createdInvoice) {
        // Revert locked entries so they can be re-billed later
        if (selectedEntryIds.length > 0) {
          await supabase
            .from('oj_entries')
            .update({ status: 'unbilled', billing_run_id: null, updated_at: new Date().toISOString() })
            .in('id', selectedEntryIds)
            .eq('status', 'billing_pending')
            .eq('billing_run_id', billingRun.id)
        }
        if (selectedRecurringInstanceIds.length > 0) {
          await supabase
            .from('oj_recurring_charge_instances')
            .update({ status: 'unbilled', billing_run_id: null, updated_at: new Date().toISOString() })
            .in('id', selectedRecurringInstanceIds)
            .eq('status', 'billing_pending')
            .eq('billing_run_id', billingRun.id)
        }
        throw new Error(createInvoiceError?.message || 'Failed to create invoice')
      }

      const invoiceId = (createdInvoice as any).id as string

      await supabase
        .from('oj_billing_runs')
        .update({ invoice_id: invoiceId, updated_at: new Date().toISOString() })
        .eq('id', billingRun.id)

      // If email not configured, leave invoice as draft + entries as billing_pending (retry later)
      if (!isGraphConfigured()) {
        await supabase
          .from('oj_billing_runs')
          .update({
            status: 'failed',
            error_message: 'Email service is not configured',
            run_finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', billingRun.id)

        results.failed++
        results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'Email service is not configured' })
        continue
      }

      const fullInvoiceRes = await loadInvoiceWithDetails(supabase, invoiceId)
      if ('error' in fullInvoiceRes) throw new Error(fullInvoiceRes.error)
      const fullInvoice = fullInvoiceRes.invoice

      const recipients = await resolveInvoiceRecipients(supabase, vendorId, vendor.email)
      if ('error' in recipients) throw new Error(recipients.error)
      if (!recipients.to) {
        await supabase
          .from('oj_billing_runs')
          .update({
            status: 'failed',
            error_message: 'No invoice recipient email configured (primary contact or vendor email)',
            run_finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', billingRun.id)

        results.failed++
        results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'No invoice recipient email configured' })
        continue
      }

      const subject = `Invoice ${invoiceNumber} from Orange Jelly Limited`
      const body = `Hi ${vendor.contact_name || vendor.name || 'there'},\n\nPlease find attached invoice ${invoiceNumber}.\n\nThe invoice notes include a breakdown of hours and mileage.\n\nBest regards,\nPeter\nOrange Jelly Limited`

      let additionalAttachments: Array<{ name: string; contentType: string; buffer: Buffer }> | undefined
      if (attachTimesheet) {
        const timesheetPdf = await generateOjTimesheetPDF({
          invoiceNumber,
          vendorName: vendor.name,
          periodStart: period.period_start,
          periodEnd: period.period_end,
          notesText: notesFull,
        })

        additionalAttachments = [
          {
            name: `timesheet-${invoiceNumber}.pdf`,
            contentType: 'application/pdf',
            buffer: timesheetPdf,
          },
        ]
      }

      const sendRes = await sendInvoiceEmail(fullInvoice, recipients.to, subject, body, recipients.cc, additionalAttachments)
      if (!sendRes.success) {
        await supabase
          .from('oj_billing_runs')
          .update({
            status: 'failed',
            error_message: sendRes.error || 'Failed to send invoice email',
            run_finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', billingRun.id)

        results.failed++
        results.vendors.push({ vendor_id: vendorId, status: 'failed', invoice_id: invoiceId, invoice_number: invoiceNumber, error: sendRes.error || 'Failed to send invoice email' })
        continue
      }

      await supabase.from('invoices').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', invoiceId)

      await supabase.from('invoice_email_logs').insert({
        invoice_id: invoiceId,
        sent_to: recipients.to,
        sent_by: 'system',
        subject,
        body: 'Automatically sent by OJ Projects monthly billing.',
        status: 'sent',
      })
      for (const cc of recipients.cc) {
        await supabase.from('invoice_email_logs').insert({
          invoice_id: invoiceId,
          sent_to: cc,
          sent_by: 'system',
          subject,
          body: 'Automatically sent by OJ Projects monthly billing.',
          status: 'sent',
        })
      }

      if (selectedEntryIds.length > 0) {
        await supabase
          .from('oj_entries')
          .update({
            status: 'billed',
            invoice_id: invoiceId,
            billed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in('id', selectedEntryIds)
          .eq('billing_run_id', billingRun.id)
          .eq('status', 'billing_pending')
      }

      if (selectedRecurringInstanceIds.length > 0) {
        await supabase
          .from('oj_recurring_charge_instances')
          .update({
            status: 'billed',
            invoice_id: invoiceId,
            billed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in('id', selectedRecurringInstanceIds)
          .eq('billing_run_id', billingRun.id)
          .eq('status', 'billing_pending')
      }

      await supabase
        .from('oj_billing_runs')
        .update({
          status: 'sent',
          error_message: null,
          run_finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', billingRun.id)

      results.sent++
      results.vendors.push({ vendor_id: vendorId, status: 'sent', invoice_id: invoiceId, invoice_number: invoiceNumber })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      results.failed++
      results.vendors.push({ vendor_id: vendorId, status: 'failed', error: message })
      try {
        await supabase
          .from('oj_billing_runs')
          .update({ status: 'failed', error_message: message, run_finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('vendor_id', vendorId)
          .eq('period_yyyymm', period.period_yyyymm)
      } catch { }
    }
  }

  return NextResponse.json(results)
}
