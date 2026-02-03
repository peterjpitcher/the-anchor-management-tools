import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateInvoiceTotals, type InvoiceTotalsResult } from '@/lib/invoiceCalculations'
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

function formatCurrency(amount: number) {
  return `£${roundMoney(amount).toFixed(2)}`
}

function parseIsoDateUtc(dateIso: string) {
  const [y, m, d] = dateIso.split('-').map((v) => Number.parseInt(v, 10))
  return new Date(Date.UTC(y, m - 1, d))
}

function addMonthsUtc(date: Date, months: number) {
  const dt = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  dt.setUTCMonth(dt.getUTCMonth() + months)
  return dt
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function formatMonthLabel(date: Date) {
  return formatInTimeZone(date, LONDON_TZ, 'MMM yyyy')
}

function getProjectLabel(project: any) {
  if (!project) return 'Project'
  const code = project?.project_code ? String(project.project_code) : ''
  const name = project?.project_name ? String(project.project_name) : ''
  if (code && name) return `${code} — ${name}`
  return code || name || 'Project'
}

function formatPeriodLabel(periodYyyymm: string | null | undefined) {
  const raw = String(periodYyyymm || '')
  const match = raw.match(/^\d{4}-\d{2}/)
  return match ? match[0] : raw
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

function getEntryCharge(entry: any, settings: any) {
  const entryType = String(entry?.entry_type || '')
  if (entryType === 'mileage') {
    const miles = Number(entry.miles || 0)
    const rate = Number(entry.mileage_rate_snapshot || settings?.mileage_rate || 0.42)
    const exVat = roundMoney(miles * rate)
    const vatRate = 0
    const incVat = roundMoney(exVat)
    return { exVat, vatRate, incVat }
  }

  const minutes = Number(entry.duration_minutes_rounded || 0)
  const hours = minutes / 60
  const rate = Number(entry.hourly_rate_ex_vat_snapshot || settings?.hourly_rate_ex_vat || 75)
  const vatRate = Number(entry.vat_rate_snapshot ?? settings?.vat_rate ?? 20)
  const exVat = roundMoney(hours * rate)
  const incVat = moneyIncVat(exVat, vatRate)
  return { exVat, vatRate, incVat }
}

function getRecurringCharge(instance: any) {
  const exVat = roundMoney(Number(instance.amount_ex_vat_snapshot || 0))
  const vatRate = Number(instance.vat_rate_snapshot || 0)
  const incVat = moneyIncVat(exVat, vatRate)
  return { exVat, vatRate, incVat }
}

function computeTimeCharge(rate: number, vatRate: number, minutes: number) {
  const exVat = roundMoney((minutes / 60) * rate)
  const incVat = moneyIncVat(exVat, vatRate)
  return { exVat, incVat }
}

function computePartialExVatForHeadroom(headroomIncVat: number, vatRate: number) {
  const safeHeadroom = roundMoney(Number(headroomIncVat) || 0)
  if (!Number.isFinite(safeHeadroom) || safeHeadroom <= 0) return null
  const divisor = 1 + vatRate / 100
  if (!Number.isFinite(divisor) || divisor <= 0) return null
  let exVat = roundMoney(safeHeadroom / divisor)
  if (exVat <= 0) return null
  let incVat = moneyIncVat(exVat, vatRate)
  let guard = 0
  while (exVat > 0 && incVat - safeHeadroom > 0.009 && guard < 500) {
    exVat = roundMoney(exVat - 0.01)
    incVat = moneyIncVat(exVat, vatRate)
    guard += 1
  }
  if (exVat <= 0) return null
  return { exVat, incVat }
}

function computeExVatForTargetIncVat(targetIncVat: number, vatRate: number) {
  const safeTarget = roundMoney(Number(targetIncVat) || 0)
  if (!Number.isFinite(safeTarget) || safeTarget <= 0) return null
  const divisor = 1 + vatRate / 100
  if (!Number.isFinite(divisor) || divisor <= 0) return null

  let exVat = roundMoney(safeTarget / divisor)
  let incVat = moneyIncVat(exVat, vatRate)

  let guard = 0
  while (incVat < safeTarget - 0.009 && guard < 500) {
    exVat = roundMoney(exVat + 0.01)
    incVat = moneyIncVat(exVat, vatRate)
    guard += 1
  }
  if (incVat - safeTarget > 0.009) {
    exVat = roundMoney(exVat - 0.01)
    incVat = moneyIncVat(exVat, vatRate)
  }

  if (exVat <= 0) return null
  return { exVat, incVat }
}

function computePartialMinutesForHeadroom(totalMinutes: number, rate: number, vatRate: number, headroomIncVat: number) {
  const safeTotal = Number(totalMinutes || 0)
  const safeRate = Number(rate || 0)
  const safeVat = Number(vatRate || 0)
  const safeHeadroom = roundMoney(Number(headroomIncVat) || 0)
  if (!Number.isFinite(safeTotal) || safeTotal <= 0) return null
  if (!Number.isFinite(safeRate) || safeRate <= 0) return null
  if (!Number.isFinite(safeHeadroom) || safeHeadroom <= 0) return null

  const block = 15
  const maxBlocks = Math.floor(safeTotal / block)
  if (maxBlocks <= 0) return null

  const perMinuteInc = (safeRate * (1 + safeVat / 100)) / 60
  if (!Number.isFinite(perMinuteInc) || perMinuteInc <= 0) return null

  let minutes = Math.floor((safeHeadroom / perMinuteInc) / block) * block
  minutes = Math.min(minutes, maxBlocks * block)
  if (minutes <= 0) return null
  if (minutes >= safeTotal) minutes = safeTotal - block
  if (minutes <= 0) return null

  let { incVat } = computeTimeCharge(safeRate, safeVat, minutes)
  let guard = 0
  while (minutes > 0 && incVat - safeHeadroom > 0.009 && guard < 500) {
    minutes -= block
    if (minutes <= 0) break
    incVat = computeTimeCharge(safeRate, safeVat, minutes).incVat
    guard += 1
  }
  if (minutes <= 0) return null

  const charge = computeTimeCharge(safeRate, safeVat, minutes)
  return { minutes, exVat: charge.exVat, incVat: charge.incVat }
}

function computePartialMilesForHeadroom(totalMiles: number, rate: number, headroomIncVat: number) {
  const safeMiles = Number(totalMiles || 0)
  const safeRate = Number(rate || 0)
  const safeHeadroom = roundMoney(Number(headroomIncVat) || 0)
  if (!Number.isFinite(safeMiles) || safeMiles <= 0) return null
  if (!Number.isFinite(safeRate) || safeRate <= 0) return null
  if (!Number.isFinite(safeHeadroom) || safeHeadroom <= 0) return null

  let miles = Math.floor((safeHeadroom / safeRate) * 100) / 100
  miles = Math.min(miles, roundMoney(safeMiles - 0.01))
  if (miles <= 0) return null

  let incVat = roundMoney(miles * safeRate)
  let guard = 0
  while (miles > 0 && incVat - safeHeadroom > 0.009 && guard < 500) {
    miles = roundMoney(miles - 0.01)
    if (miles <= 0) break
    incVat = roundMoney(miles * safeRate)
    guard += 1
  }
  if (miles <= 0) return null

  return { miles, exVat: incVat, incVat }
}

function buildEntryInsertPayload(entry: any, overrides: Record<string, any>) {
  return {
    vendor_id: entry.vendor_id,
    project_id: entry.project_id,
    entry_type: entry.entry_type,
    entry_date: entry.entry_date,
    start_at: entry.start_at ?? null,
    end_at: entry.end_at ?? null,
    duration_minutes_raw: entry.duration_minutes_raw ?? null,
    duration_minutes_rounded: entry.duration_minutes_rounded ?? null,
    miles: entry.miles ?? null,
    work_type_id: entry.work_type_id ?? null,
    work_type_name_snapshot: entry.work_type_name_snapshot ?? null,
    description: entry.description ?? null,
    internal_notes: entry.internal_notes ?? null,
    billable: entry.billable ?? true,
    status: 'unbilled',
    billing_run_id: null,
    invoice_id: null,
    billed_at: null,
    paid_at: null,
    hourly_rate_ex_vat_snapshot: entry.hourly_rate_ex_vat_snapshot ?? null,
    vat_rate_snapshot: entry.vat_rate_snapshot ?? null,
    mileage_rate_snapshot: entry.mileage_rate_snapshot ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function buildRecurringInstanceInsertPayload(instance: any, overrides: Record<string, any>) {
  return {
    vendor_id: instance.vendor_id,
    recurring_charge_id: instance.recurring_charge_id,
    period_yyyymm: instance.period_yyyymm,
    period_start: instance.period_start,
    period_end: instance.period_end,
    description_snapshot: instance.description_snapshot,
    amount_ex_vat_snapshot: instance.amount_ex_vat_snapshot,
    vat_rate_snapshot: instance.vat_rate_snapshot,
    sort_order_snapshot: instance.sort_order_snapshot,
    status: 'unbilled',
    billing_run_id: null,
    invoice_id: null,
    billed_at: null,
    paid_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function getNextSplitPeriodYyyymm(basePeriod: string, existingPeriods: string[]) {
  const base = formatPeriodLabel(basePeriod)
  if (!base) return `${basePeriod}-S1`
  const prefix = `${base}-S`
  let maxIndex = 0
  for (const period of existingPeriods) {
    const text = String(period || '')
    if (!text.startsWith(prefix)) continue
    const suffix = text.slice(prefix.length)
    const parsed = Number.parseInt(suffix, 10)
    if (Number.isFinite(parsed) && parsed > maxIndex) maxIndex = parsed
  }
  return `${base}-S${maxIndex + 1}`
}

async function splitRecurringInstanceForCap(input: {
  supabase: ReturnType<typeof createAdminClient> | null
  persist: boolean
  headroom: number
  selectedRecurringInstances: any[]
  skippedRecurringInstances: any[]
}) {
  const index = input.skippedRecurringInstances.findIndex((item) => getRecurringCharge(item).incVat > 0)
  if (index < 0) return null

  const candidate = input.skippedRecurringInstances[index]
  const fullCharge = getRecurringCharge(candidate)
  if (fullCharge.incVat <= 0) return null

  const partial = computePartialExVatForHeadroom(input.headroom, fullCharge.vatRate)
  if (!partial) return null
  if (partial.exVat < 0.01) return null

  const remainderExVat = roundMoney(fullCharge.exVat - partial.exVat)
  if (remainderExVat < 0.01) return null

  const nowIso = new Date().toISOString()
  let remainderPeriod = String(candidate.period_yyyymm || '')

  if (input.persist) {
    if (!input.supabase) throw new Error('Supabase client required for split persist')
    const { data: existingPeriods, error: existingError } = await input.supabase
      .from('oj_recurring_charge_instances')
      .select('period_yyyymm')
      .eq('vendor_id', candidate.vendor_id)
      .eq('recurring_charge_id', candidate.recurring_charge_id)
      .limit(10000)
    if (existingError) throw new Error(existingError.message)
    remainderPeriod = getNextSplitPeriodYyyymm(
      String(candidate.period_yyyymm || ''),
      (existingPeriods || []).map((row: any) => String(row.period_yyyymm || ''))
    )
  } else {
    const existingPeriods = [...input.selectedRecurringInstances, ...input.skippedRecurringInstances].map((row: any) =>
      String(row.period_yyyymm || '')
    )
    remainderPeriod = getNextSplitPeriodYyyymm(String(candidate.period_yyyymm || ''), existingPeriods)
  }

  const partialInstance = {
    ...candidate,
    amount_ex_vat_snapshot: partial.exVat,
    updated_at: nowIso,
  }

  let remainderInstance = {
    ...candidate,
    amount_ex_vat_snapshot: remainderExVat,
    period_yyyymm: remainderPeriod,
    status: 'unbilled',
    billing_run_id: null,
    invoice_id: null,
    billed_at: null,
    paid_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  }

  if (input.persist) {
    const { error: updateError } = await input.supabase!
      .from('oj_recurring_charge_instances')
      .update({
        amount_ex_vat_snapshot: partial.exVat,
        updated_at: nowIso,
      })
      .eq('id', candidate.id)
    if (updateError) throw new Error(updateError.message)

    const { data: inserted, error: insertError } = await input.supabase!
      .from('oj_recurring_charge_instances')
      .insert(
        buildRecurringInstanceInsertPayload(candidate, {
          amount_ex_vat_snapshot: remainderExVat,
          period_yyyymm: remainderPeriod,
          created_at: nowIso,
          updated_at: nowIso,
        })
      )
      .select('*')
      .single()
    if (insertError) throw new Error(insertError.message)
    remainderInstance = inserted
  }

  input.skippedRecurringInstances.splice(index, 1, remainderInstance)
  input.selectedRecurringInstances.push(partialInstance)

  return { addedIncVat: partial.incVat }
}

async function splitMileageEntryForCap(input: {
  supabase: ReturnType<typeof createAdminClient> | null
  persist: boolean
  headroom: number
  settings: any
  selectedMileageEntries: any[]
  skippedMileageEntries: any[]
}) {
  const index = input.skippedMileageEntries.findIndex((item) => Number(item.miles || 0) > 0)
  if (index < 0) return null

  const candidate = input.skippedMileageEntries[index]
  const totalMiles = Number(candidate.miles || 0)
  if (!Number.isFinite(totalMiles) || totalMiles <= 0) return null

  const rate = Number(candidate.mileage_rate_snapshot || input.settings?.mileage_rate || 0.42)
  const partial = computePartialMilesForHeadroom(totalMiles, rate, input.headroom)
  if (!partial) return null
  if (partial.miles < 0.01) return null

  const remainderMiles = roundMoney(totalMiles - partial.miles)
  if (remainderMiles < 0.01) return null

  const nowIso = new Date().toISOString()

  const partialEntry = {
    ...candidate,
    miles: partial.miles,
    updated_at: nowIso,
  }

  let remainderEntry = {
    ...candidate,
    miles: remainderMiles,
    status: 'unbilled',
    billing_run_id: null,
    invoice_id: null,
    billed_at: null,
    paid_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  }

  if (input.persist) {
    if (!input.supabase) throw new Error('Supabase client required for split persist')
    const { error: updateError } = await input.supabase
      .from('oj_entries')
      .update({
        miles: partial.miles,
        updated_at: nowIso,
      })
      .eq('id', candidate.id)
    if (updateError) throw new Error(updateError.message)

    const { data: inserted, error: insertError } = await input.supabase
      .from('oj_entries')
      .insert(
        buildEntryInsertPayload(candidate, {
          miles: remainderMiles,
          duration_minutes_raw: null,
          duration_minutes_rounded: null,
          start_at: null,
          end_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        })
      )
      .select('*')
      .single()
    if (insertError) throw new Error(insertError.message)

    remainderEntry = { ...inserted, project: candidate.project, work_type: candidate.work_type }
  }

  input.skippedMileageEntries.splice(index, 1, remainderEntry)
  input.selectedMileageEntries.push(partialEntry)

  return { addedIncVat: partial.incVat }
}

async function splitTimeEntryForCap(input: {
  supabase: ReturnType<typeof createAdminClient> | null
  persist: boolean
  headroom: number
  settings: any
  selectedTimeEntries: any[]
  skippedTimeEntries: any[]
}) {
  const index = input.skippedTimeEntries.findIndex((item) => Number(item.duration_minutes_rounded || 0) > 0)
  if (index < 0) return null

  const candidate = input.skippedTimeEntries[index]
  const totalMinutes = Number(candidate.duration_minutes_rounded || 0)
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null

  const rate = Number(candidate.hourly_rate_ex_vat_snapshot || input.settings?.hourly_rate_ex_vat || 75)
  const vatRate = Number(candidate.vat_rate_snapshot ?? input.settings?.vat_rate ?? 20)
  const partial = computePartialMinutesForHeadroom(totalMinutes, rate, vatRate, input.headroom)
  if (!partial) return null

  const remainingMinutes = totalMinutes - partial.minutes
  if (remainingMinutes <= 0) return null

  const startAtRaw = candidate.start_at ? new Date(candidate.start_at) : null
  const endAtRaw = candidate.end_at ? new Date(candidate.end_at) : null
  if (!startAtRaw || !endAtRaw || Number.isNaN(startAtRaw.getTime()) || Number.isNaN(endAtRaw.getTime())) return null

  const diffMinutes = Math.max(Math.round((endAtRaw.getTime() - startAtRaw.getTime()) / 60000), 0)
  if (diffMinutes <= 0) return null

  let rawBilled = Math.round(diffMinutes * (partial.minutes / totalMinutes))
  rawBilled = Math.max(rawBilled, 1)
  if (rawBilled >= diffMinutes) rawBilled = Math.max(diffMinutes - 1, 1)

  const rawRemaining = Math.max(diffMinutes - rawBilled, 0)
  if (rawRemaining <= 0) return null

  const billedEnd = addMinutes(startAtRaw, rawBilled)
  const nowIso = new Date().toISOString()

  const partialEntry = {
    ...candidate,
    duration_minutes_rounded: partial.minutes,
    duration_minutes_raw: rawBilled,
    end_at: billedEnd.toISOString(),
    updated_at: nowIso,
  }

  let remainderEntry = {
    ...candidate,
    duration_minutes_rounded: remainingMinutes,
    duration_minutes_raw: rawRemaining,
    start_at: billedEnd.toISOString(),
    end_at: endAtRaw.toISOString(),
    status: 'unbilled',
    billing_run_id: null,
    invoice_id: null,
    billed_at: null,
    paid_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  }

  if (input.persist) {
    if (!input.supabase) throw new Error('Supabase client required for split persist')
    const { error: updateError } = await input.supabase
      .from('oj_entries')
      .update({
        duration_minutes_rounded: partial.minutes,
        duration_minutes_raw: rawBilled,
        end_at: billedEnd.toISOString(),
        updated_at: nowIso,
      })
      .eq('id', candidate.id)
    if (updateError) throw new Error(updateError.message)

    const { data: inserted, error: insertError } = await input.supabase
      .from('oj_entries')
      .insert(
        buildEntryInsertPayload(candidate, {
          duration_minutes_rounded: remainingMinutes,
          duration_minutes_raw: rawRemaining,
          start_at: billedEnd.toISOString(),
          end_at: endAtRaw.toISOString(),
          miles: null,
          created_at: nowIso,
          updated_at: nowIso,
        })
      )
      .select('*')
      .single()
    if (insertError) throw new Error(insertError.message)

    remainderEntry = { ...inserted, project: candidate.project, work_type: candidate.work_type }
  }

  input.skippedTimeEntries.splice(index, 1, remainderEntry)
  input.selectedTimeEntries.push(partialEntry)

  return { addedIncVat: partial.incVat }
}

async function applyPartialSplit(input: {
  supabase: ReturnType<typeof createAdminClient> | null
  persist: boolean
  billingMode: 'full' | 'cap'
  capIncVat: number | null
  runningIncVat: number
  settings: any
  selectedRecurringInstances: any[]
  skippedRecurringInstances: any[]
  selectedMileageEntries: any[]
  skippedMileageEntries: any[]
  selectedTimeEntries: any[]
  skippedTimeEntries: any[]
}) {
  if (input.billingMode !== 'cap') return { addedIncVat: 0 }
  const capPounds = input.capIncVat != null ? roundMoney(Number(input.capIncVat) || 0) : null
  if (!capPounds || capPounds <= 0) return { addedIncVat: 0 }

  const headroom = roundMoney(capPounds - Number(input.runningIncVat || 0))
  if (headroom <= 0.01) return { addedIncVat: 0 }

  const recurringSplit = await splitRecurringInstanceForCap({
    supabase: input.supabase,
    persist: input.persist,
    headroom,
    selectedRecurringInstances: input.selectedRecurringInstances,
    skippedRecurringInstances: input.skippedRecurringInstances,
  })
  if (recurringSplit) return { addedIncVat: recurringSplit.addedIncVat }

  const mileageSplit = await splitMileageEntryForCap({
    supabase: input.supabase,
    persist: input.persist,
    headroom,
    settings: input.settings,
    selectedMileageEntries: input.selectedMileageEntries,
    skippedMileageEntries: input.skippedMileageEntries,
  })
  if (mileageSplit) return { addedIncVat: mileageSplit.addedIncVat }

  const timeSplit = await splitTimeEntryForCap({
    supabase: input.supabase,
    persist: input.persist,
    headroom,
    settings: input.settings,
    selectedTimeEntries: input.selectedTimeEntries,
    skippedTimeEntries: input.skippedTimeEntries,
  })
  if (timeSplit) return { addedIncVat: timeSplit.addedIncVat }

  return { addedIncVat: 0 }
}

async function computeStatementBalanceBefore(input: {
  supabase: ReturnType<typeof createAdminClient>
  vendorId: string
  settings: any
  selectedRecurringInstances: any[]
  skippedRecurringInstances: any[]
  selectedMileageEntries: any[]
  skippedMileageEntries: any[]
  selectedTimeEntries: any[]
  skippedTimeEntries: any[]
}) {
  const unbilledEntries = [
    ...(input.selectedTimeEntries || []),
    ...(input.selectedMileageEntries || []),
    ...(input.skippedTimeEntries || []),
    ...(input.skippedMileageEntries || []),
  ]

  const unbilledRecurring = [
    ...(input.selectedRecurringInstances || []),
    ...(input.skippedRecurringInstances || []),
  ]

  let unbilledProjectsTotal = 0
  for (const entry of unbilledEntries) {
    const { incVat } = getEntryCharge(entry, input.settings)
    if (incVat <= 0) continue
    unbilledProjectsTotal = roundMoney(unbilledProjectsTotal + incVat)
  }

  let unbilledRecurringTotal = 0
  for (const instance of unbilledRecurring) {
    const { incVat } = getRecurringCharge(instance)
    if (incVat <= 0) continue
    unbilledRecurringTotal = roundMoney(unbilledRecurringTotal + incVat)
  }

  const { data: unpaidInvoices, error: unpaidInvoiceError } = await input.supabase
    .from('invoices')
    .select('id, total_amount, paid_amount, status, reference')
    .eq('vendor_id', input.vendorId)
    .is('deleted_at', null)
    .ilike('reference', 'OJ Projects %')
    .not('status', 'in', '(paid,void,written_off)')
    .limit(10000)

  if (unpaidInvoiceError) throw new Error(unpaidInvoiceError.message)

  const unpaidInvoiceBalance = roundMoney(
    (unpaidInvoices || []).reduce((acc: number, inv: any) => {
      const total = Number(inv.total_amount || 0)
      const paid = Number(inv.paid_amount || 0)
      return acc + Math.max(total - paid, 0)
    }, 0)
  )

  const unbilledTotal = roundMoney(unbilledProjectsTotal + unbilledRecurringTotal)
  const balanceBefore = roundMoney(unpaidInvoiceBalance + unbilledTotal)

  return { balanceBefore, unpaidInvoiceBalance, unbilledTotal }
}

function applyStatementCapTopUp(input: {
  lineItems: Array<{
    catalog_item_id: string | null
    description: string
    quantity: number
    unit_price: number
    discount_percentage: number
    vat_rate: number
  }>
  totals: InvoiceTotalsResult
  targetIncVat: number
  vatRate: number
}) {
  let totals = input.totals
  const target = roundMoney(Number(input.targetIncVat))
  if (!Number.isFinite(target) || target <= 0) return { lineItems: input.lineItems, totals }

  let diff = roundMoney(target - Number(totals.totalAmount))
  if (!Number.isFinite(diff) || diff <= 0.009) return { lineItems: input.lineItems, totals }

  const vatRate = Number(input.vatRate || 0)
  const label =
    vatRate === 0
      ? 'Account balance payment (zero-rated)'
      : `Account balance payment (${vatRate}% VAT)`

  let existingIndex = input.lineItems.findIndex(
    (item) => item.vat_rate === vatRate && item.description.startsWith('Account balance payment')
  )

  if (existingIndex < 0) {
    input.lineItems.push({
      catalog_item_id: null,
      description: label,
      quantity: 1,
      unit_price: 0,
      discount_percentage: 0,
      vat_rate: vatRate,
    })
    existingIndex = input.lineItems.length - 1
  }

  const adjustment = computeExVatForTargetIncVat(diff, vatRate)
  if (!adjustment) return { lineItems: input.lineItems, totals }

  const existing = input.lineItems[existingIndex]
  input.lineItems[existingIndex] = {
    ...existing,
    unit_price: roundMoney(Number(existing.unit_price || 0) + adjustment.exVat),
  }

  totals = calculateInvoiceTotals(input.lineItems, 0)
  diff = roundMoney(target - Number(totals.totalAmount))

  if (Math.abs(diff) > 0.009) {
    let guard = 0
    while (Math.abs(diff) > 0.009 && guard < 500) {
      const step = diff > 0 ? 0.01 : -0.01
      const current = input.lineItems[existingIndex]
      input.lineItems[existingIndex] = {
        ...current,
        unit_price: roundMoney(Number(current.unit_price || 0) + step),
      }
      totals = calculateInvoiceTotals(input.lineItems, 0)
      diff = roundMoney(target - Number(totals.totalAmount))
      guard += 1
    }
  }

  return { lineItems: input.lineItems, totals }
}

function buildStatementLineItems(input: {
  selectedRecurringInstances: any[]
  selectedMileageEntries: any[]
  selectedTimeEntries: any[]
  settings: any
}) {
  const vatGroups = new Map<number, number>()
  const addGroup = (vatRate: number, exVat: number) => {
    if (!Number.isFinite(exVat) || exVat <= 0) return
    const key = Number(vatRate || 0)
    vatGroups.set(key, roundMoney((vatGroups.get(key) || 0) + exVat))
  }

  for (const c of input.selectedRecurringInstances || []) {
    const charge = getRecurringCharge(c)
    addGroup(charge.vatRate, charge.exVat)
  }

  for (const e of input.selectedMileageEntries || []) {
    const charge = getEntryCharge(e, input.settings)
    addGroup(charge.vatRate, charge.exVat)
  }

  for (const e of input.selectedTimeEntries || []) {
    const charge = getEntryCharge(e, input.settings)
    addGroup(charge.vatRate, charge.exVat)
  }

  const lineItems: Array<{
    catalog_item_id: string | null
    description: string
    quantity: number
    unit_price: number
    discount_percentage: number
    vat_rate: number
  }> = []

  const sortedVatRates = [...vatGroups.keys()].sort((a, b) => b - a)
  for (const vatRate of sortedVatRates) {
    const exVat = vatGroups.get(vatRate) || 0
    if (exVat <= 0) continue
    const label =
      vatRate === 0
        ? 'Account balance payment (zero-rated)'
        : `Account balance payment (${vatRate}% VAT)`
    lineItems.push({
      catalog_item_id: null,
      description: label,
      quantity: 1,
      unit_price: roundMoney(exVat),
      discount_percentage: 0,
      vat_rate: vatRate,
    })
  }

  return lineItems
}

function buildDetailedLineItems(input: {
  selectedRecurringInstances: any[]
  selectedMileageEntries: any[]
  selectedTimeEntries: any[]
  settings: any
  periodYyyymm: string
}) {
  const lineItems: Array<{
    catalog_item_id: string | null
    description: string
    quantity: number
    unit_price: number
    discount_percentage: number
    vat_rate: number
  }> = []

  for (const c of input.selectedRecurringInstances || []) {
    const baseDescription = String(c.description_snapshot || '')
    const periodLabel = formatPeriodLabel(c?.period_yyyymm)
    const description =
      periodLabel && String(periodLabel) !== input.periodYyyymm
        ? `${baseDescription} (${periodLabel})`
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

  const selectedMileage = input.selectedMileageEntries || []
  if (selectedMileage.length > 0) {
    const totalMiles = selectedMileage.reduce((acc: number, e: any) => acc + Number(e.miles || 0), 0)
    const rateSet = new Set(selectedMileage.map((e: any) => Number(e.mileage_rate_snapshot || input.settings?.mileage_rate || 0.42)))
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
        const rate = Number(e.mileage_rate_snapshot || input.settings?.mileage_rate || 0.42)
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
  for (const e of input.selectedTimeEntries || []) {
    const vatRate = Number(e.vat_rate_snapshot ?? input.settings?.vat_rate ?? 20)
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
      const rate = Number(e.hourly_rate_ex_vat_snapshot || input.settings?.hourly_rate_ex_vat || 75)
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

  return lineItems
}

async function buildDryRunPreview(input: {
  supabase: ReturnType<typeof createAdminClient>
  vendorId: string
  vendor: any
  period: { period_start: string; period_end: string; period_yyyymm: string }
  invoiceDate: string
}) {
  const { supabase, vendorId, vendor, period, invoiceDate } = input

  const { data: settings } = await supabase
    .from('oj_vendor_billing_settings')
    .select('*')
    .eq('vendor_id', vendorId)
    .maybeSingle()

  const billingMode: 'full' | 'cap' = settings?.billing_mode === 'cap' ? 'cap' : 'full'
  const capIncVat = billingMode === 'cap' && typeof settings?.monthly_cap_inc_vat === 'number' ? settings.monthly_cap_inc_vat : null
  const statementMode = !!settings?.statement_mode

  const { data: recurringChargeDefs, error: recurringError } = await supabase
    .from('oj_vendor_recurring_charges')
    .select('*')
    .eq('vendor_id', vendorId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (recurringError) throw new Error(recurringError.message)

  const { data: existingInstances, error: existingInstanceError } = await supabase
    .from('oj_recurring_charge_instances')
    .select('*')
    .eq('vendor_id', vendorId)
    .eq('status', 'unbilled')
    .lte('period_end', period.period_end)
    .order('period_end', { ascending: true })
    .order('sort_order_snapshot', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(10000)
  if (existingInstanceError) throw new Error(existingInstanceError.message)

  const { data: periodInstances, error: periodInstancesError } = await supabase
    .from('oj_recurring_charge_instances')
    .select('recurring_charge_id, period_yyyymm')
    .eq('vendor_id', vendorId)
    .eq('period_yyyymm', period.period_yyyymm)
    .limit(10000)

  if (periodInstancesError) throw new Error(periodInstancesError.message)

  const existingPeriodChargeIds = new Set(
    (periodInstances || [])
      .concat(
        (existingInstances || []).filter((c: any) => String(c.period_yyyymm || '') === period.period_yyyymm)
      )
      .map((c: any) => String(c?.recurring_charge_id || ''))
  )

  const virtualInstances = (recurringChargeDefs || [])
    .filter((c: any) => !existingPeriodChargeIds.has(String(c.id)))
    .map((c: any) => ({
      vendor_id: vendorId,
      recurring_charge_id: c.id,
      period_yyyymm: period.period_yyyymm,
      period_start: period.period_start,
      period_end: period.period_end,
      description_snapshot: String(c.description || ''),
      amount_ex_vat_snapshot: roundMoney(Number(c.amount_ex_vat || 0)),
      vat_rate_snapshot: Number(c.vat_rate || 0),
      sort_order_snapshot: Number(c.sort_order || 0),
      created_at: new Date().toISOString(),
    }))

  const eligibleRecurringInstances = [...(existingInstances || []), ...virtualInstances].sort((a: any, b: any) => {
    if (String(a.period_end || '') !== String(b.period_end || '')) {
      return String(a.period_end || '').localeCompare(String(b.period_end || ''))
    }
    if (Number(a.sort_order_snapshot || 0) !== Number(b.sort_order_snapshot || 0)) {
      return Number(a.sort_order_snapshot || 0) - Number(b.sort_order_snapshot || 0)
    }
    return String(a.created_at || '').localeCompare(String(b.created_at || ''))
  })

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
    const charge = getRecurringCharge(c)
    if (includeItem(charge.incVat)) selectedRecurringInstances.push(c)
    else skippedRecurringInstances.push(c)
  }

  for (const e of mileageEntries) {
    const charge = getEntryCharge(e, settings)
    if (includeItem(charge.incVat)) selectedMileage.push(e)
    else skippedMileage.push(e)
  }

  for (const e of timeEntries) {
    const charge = getEntryCharge(e, settings)
    if (includeItem(charge.incVat)) selectedTime.push(e)
    else skippedTime.push(e)
  }

  const splitResult = await applyPartialSplit({
    supabase,
    persist: false,
    billingMode,
    capIncVat,
    runningIncVat,
    settings,
    selectedRecurringInstances,
    skippedRecurringInstances,
    selectedMileageEntries: selectedMileage,
    skippedMileageEntries: skippedMileage,
    selectedTimeEntries: selectedTime,
    skippedTimeEntries: skippedTime,
  })

  if (splitResult.addedIncVat > 0) {
    runningIncVat = roundMoney(runningIncVat + splitResult.addedIncVat)
  }

  let statementBalanceBefore: number | null = null
  if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0) {
    const summary = await computeStatementBalanceBefore({
      supabase,
      vendorId,
      settings,
      selectedRecurringInstances,
      skippedRecurringInstances,
      selectedMileageEntries: selectedMileage,
      skippedMileageEntries: skippedMileage,
      selectedTimeEntries: selectedTime,
      skippedTimeEntries: skippedTime,
    })
    statementBalanceBefore = summary.balanceBefore
  }

  const carriedForwardIncVat =
    billingMode === 'cap'
      ? roundMoney(
        (skippedRecurringInstances || []).reduce((acc: number, item: any) => {
          const charge = getRecurringCharge(item)
          return acc + charge.incVat
        }, 0) +
        (skippedMileage || []).reduce((acc: number, item: any) => {
          const charge = getEntryCharge(item, settings)
          return acc + charge.incVat
        }, 0) +
        (skippedTime || []).reduce((acc: number, item: any) => {
          const charge = getEntryCharge(item, settings)
          return acc + charge.incVat
        }, 0)
      )
      : null

  const hasAnyEligible = (eligibleRecurringInstances?.length || 0) > 0 || (eligibleEntries?.length || 0) > 0
  const hasAnySelected = selectedRecurringInstances.length + selectedMileage.length + selectedTime.length > 0

  if (!hasAnySelected) {
    return {
      vendor_id: vendorId,
      vendor_name: vendor?.name || '',
      billing_mode: billingMode,
      statement_mode: statementMode,
      would_invoice: false,
      reason: hasAnyEligible && billingMode === 'cap'
        ? 'Nothing could be billed within the monthly cap.'
        : 'No eligible items to bill.',
    }
  }

  let lineItems = statementMode
    ? buildStatementLineItems({
        selectedRecurringInstances,
        selectedMileageEntries: selectedMileage,
        selectedTimeEntries: selectedTime,
        settings,
      })
    : buildDetailedLineItems({
        selectedRecurringInstances,
        selectedMileageEntries: selectedMileage,
        selectedTimeEntries: selectedTime,
        settings,
        periodYyyymm: period.period_yyyymm,
      })

  if (lineItems.length === 0) {
    return {
      vendor_id: vendorId,
      vendor_name: vendor?.name || '',
      billing_mode: billingMode,
      statement_mode: statementMode,
      would_invoice: false,
      reason: 'No invoice line items generated.',
    }
  }

  let totals = calculateInvoiceTotals(lineItems, 0)
  if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0 && statementBalanceBefore != null) {
    const targetIncVat = roundMoney(Math.min(statementBalanceBefore, capIncVat))
    const adjusted = applyStatementCapTopUp({
      lineItems,
      totals,
      targetIncVat,
      vatRate: Number(settings?.vat_rate ?? 20),
    })
    lineItems = adjusted.lineItems
    totals = adjusted.totals
  }
  const paymentTerms = typeof vendor?.payment_terms === 'number' ? vendor.payment_terms : 30
  const dueDate = addDaysIsoDate(invoiceDate, paymentTerms)

  let notes = ''
  let attachTimesheet = false
  if (statementMode) {
    notes = await buildStatementNotes({
      supabase,
      vendorId,
      period_start: period.period_start,
      period_end: period.period_end,
      invoiceDate,
      capIncVat,
      settings,
      selectedRecurringInstances,
      skippedRecurringInstances,
      selectedMileageEntries: selectedMileage,
      skippedMileageEntries: skippedMileage,
      selectedTimeEntries: selectedTime,
      skippedTimeEntries: skippedTime,
      invoiceTotalIncVat: totals.totalAmount,
    })
  } else {
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
    attachTimesheet = notesFull.length > OJ_INVOICE_NOTES_MAX_CHARS
    notes = attachTimesheet ? `${notesCompact}\n\nFull breakdown attached as Timesheet PDF.` : notesFull
  }

  return {
    vendor_id: vendorId,
    vendor_name: vendor?.name || '',
    billing_mode: billingMode,
    statement_mode: statementMode,
    would_invoice: true,
    invoice_preview: {
      invoice_date: invoiceDate,
      due_date: dueDate,
      reference: `OJ Projects ${period.period_yyyymm}`,
      totals,
      line_items: lineItems,
      notes,
      attach_timesheet: attachTimesheet,
      cap_inc_vat: capIncVat,
      carried_forward_inc_vat: carriedForwardIncVat,
      selected_counts: {
        recurring: selectedRecurringInstances.length,
        mileage: selectedMileage.length,
        time: selectedTime.length,
      },
      skipped_counts: {
        recurring: skippedRecurringInstances.length,
        mileage: skippedMileage.length,
        time: skippedTime.length,
      },
    },
  }
}

async function buildStatementNotes(input: {
  supabase: ReturnType<typeof createAdminClient>
  vendorId: string
  period_start: string
  period_end: string
  invoiceDate: string
  capIncVat: number | null
  settings: any
  selectedRecurringInstances: any[]
  skippedRecurringInstances: any[]
  selectedMileageEntries: any[]
  skippedMileageEntries: any[]
  selectedTimeEntries: any[]
  skippedTimeEntries: any[]
  invoiceTotalIncVat: number
}) {
  const supabase = input.supabase

  const unbilledEntries = [
    ...(input.selectedTimeEntries || []),
    ...(input.selectedMileageEntries || []),
    ...(input.skippedTimeEntries || []),
    ...(input.skippedMileageEntries || []),
  ]
  const unbilledRecurring = [
    ...(input.selectedRecurringInstances || []),
    ...(input.skippedRecurringInstances || []),
  ]

  const unbilledProjectBalances = new Map<string, { label: string; amount: number }>()
  let unbilledProjectsTotal = 0
  for (const entry of unbilledEntries) {
    const { incVat } = getEntryCharge(entry, input.settings)
    if (incVat <= 0) continue
    const projectLabel = getProjectLabel(entry?.project)
    const key = String(entry?.project_id || projectLabel)
    const existing = unbilledProjectBalances.get(key) || { label: projectLabel, amount: 0 }
    existing.amount = roundMoney(existing.amount + incVat)
    unbilledProjectBalances.set(key, existing)
    unbilledProjectsTotal = roundMoney(unbilledProjectsTotal + incVat)
  }

  let unbilledRecurringTotal = 0
  for (const instance of unbilledRecurring) {
    const { incVat } = getRecurringCharge(instance)
    if (incVat <= 0) continue
    unbilledRecurringTotal = roundMoney(unbilledRecurringTotal + incVat)
  }

  const { data: unpaidInvoices, error: unpaidInvoiceError } = await supabase
    .from('invoices')
    .select('id, total_amount, paid_amount, status, reference')
    .eq('vendor_id', input.vendorId)
    .is('deleted_at', null)
    .ilike('reference', 'OJ Projects %')
    .not('status', 'in', '(paid,void,written_off)')
    .limit(10000)

  if (unpaidInvoiceError) throw new Error(unpaidInvoiceError.message)

  const unpaidInvoiceIds = (unpaidInvoices || []).map((i: any) => String(i.id))
  const unpaidInvoiceBalance = roundMoney(
    (unpaidInvoices || []).reduce((acc: number, inv: any) => {
      const total = Number(inv.total_amount || 0)
      const paid = Number(inv.paid_amount || 0)
      return acc + Math.max(total - paid, 0)
    }, 0)
  )

  const billedProjectBalances = new Map<string, { label: string; amount: number }>()
  let billedRecurringTotal = 0

  if (unpaidInvoiceIds.length > 0) {
    const { data: billedEntries, error: billedEntriesError } = await supabase
      .from('oj_entries')
      .select(
        `
        entry_type,
        entry_date,
        project_id,
        project:oj_projects(
          project_code,
          project_name
        ),
        duration_minutes_rounded,
        miles,
        hourly_rate_ex_vat_snapshot,
        vat_rate_snapshot,
        mileage_rate_snapshot
      `
      )
      .eq('vendor_id', input.vendorId)
      .eq('billable', true)
      .eq('status', 'billed')
      .in('invoice_id', unpaidInvoiceIds)
      .lte('entry_date', input.period_end)
      .limit(10000)

    if (billedEntriesError) throw new Error(billedEntriesError.message)

    for (const entry of billedEntries || []) {
      const { incVat } = getEntryCharge(entry, input.settings)
      if (incVat <= 0) continue
      const projectLabel = getProjectLabel((entry as any)?.project)
      const key = String((entry as any)?.project_id || projectLabel)
      const existing = billedProjectBalances.get(key) || { label: projectLabel, amount: 0 }
      existing.amount = roundMoney(existing.amount + incVat)
      billedProjectBalances.set(key, existing)
    }

    const { data: billedRecurring, error: billedRecurringError } = await supabase
      .from('oj_recurring_charge_instances')
      .select('amount_ex_vat_snapshot, vat_rate_snapshot, period_end')
      .eq('vendor_id', input.vendorId)
      .eq('status', 'billed')
      .in('invoice_id', unpaidInvoiceIds)
      .lte('period_end', input.period_end)
      .limit(10000)

    if (billedRecurringError) throw new Error(billedRecurringError.message)

    for (const instance of billedRecurring || []) {
      const { incVat } = getRecurringCharge(instance)
      if (incVat <= 0) continue
      billedRecurringTotal = roundMoney(billedRecurringTotal + incVat)
    }
  }

  const grossProjectBalances = new Map<string, { label: string; amount: number }>()
  for (const [key, value] of billedProjectBalances.entries()) {
    grossProjectBalances.set(key, { ...value })
  }
  for (const [key, value] of unbilledProjectBalances.entries()) {
    const existing = grossProjectBalances.get(key) || { label: value.label, amount: 0 }
    existing.amount = roundMoney(existing.amount + value.amount)
    grossProjectBalances.set(key, existing)
  }

  const grossProjectsTotal = roundMoney(
    [...grossProjectBalances.values()].reduce((acc, item) => acc + Number(item.amount || 0), 0)
  )

  const grossRecurringTotal = roundMoney(unbilledRecurringTotal + billedRecurringTotal)
  const grossOutstanding = roundMoney(grossProjectsTotal + grossRecurringTotal)

  const unbilledTotal = roundMoney(unbilledProjectsTotal + unbilledRecurringTotal)
  const balanceBefore = roundMoney(unpaidInvoiceBalance + unbilledTotal)
  const balanceAfter = roundMoney(Math.max(balanceBefore - input.invoiceTotalIncVat, 0))

  const unallocatedBalance = grossOutstanding <= 0 && balanceBefore > 0 ? balanceBefore : 0
  const scale = grossOutstanding > 0 ? balanceBefore / grossOutstanding : 0
  const netProjectBalances = [...grossProjectBalances.values()].map((item) => ({
    label: item.label,
    amount: roundMoney(item.amount * scale),
  }))
  let netRecurringTotal = roundMoney(grossRecurringTotal * scale)

  netProjectBalances.sort((a, b) => b.amount - a.amount)

  const projectedTotal = roundMoney(netProjectBalances.reduce((acc, item) => acc + item.amount, 0) + netRecurringTotal)
  const balanceDiff = roundMoney(balanceBefore - projectedTotal)
  if (Math.abs(balanceDiff) >= 0.01) {
    if (netRecurringTotal > 0) {
      netRecurringTotal = roundMoney(netRecurringTotal + balanceDiff)
    } else if (netProjectBalances.length > 0) {
      netProjectBalances[netProjectBalances.length - 1].amount = roundMoney(
        netProjectBalances[netProjectBalances.length - 1].amount + balanceDiff
      )
    }
  }

  const lines: string[] = []
  lines.push('Account balance summary (inc VAT)')
  lines.push(`Billing month: ${input.period_start} to ${input.period_end}`)
  lines.push(`Balance before this invoice: ${formatCurrency(balanceBefore)}`)
  lines.push(`This invoice: ${formatCurrency(input.invoiceTotalIncVat)}`)
  lines.push(`Balance after this invoice is paid: ${formatCurrency(balanceAfter)}`)

  lines.push('')
  lines.push('Outstanding balance by project (inc VAT)')
  if (unallocatedBalance > 0) {
    lines.push(`- Unallocated balance: ${formatCurrency(unallocatedBalance)}`)
  } else if (netProjectBalances.length === 0 && netRecurringTotal <= 0) {
    lines.push('- No outstanding balance')
  } else {
    for (const item of netProjectBalances) {
      if (item.amount <= 0) continue
      lines.push(`- ${item.label}: ${formatCurrency(item.amount)}`)
    }
    if (netRecurringTotal > 0) {
      lines.push(`- Recurring charges: ${formatCurrency(netRecurringTotal)}`)
    }
  }

  const monthlyCap = typeof input.capIncVat === 'number' && input.capIncVat > 0
    ? Number(input.capIncVat)
    : Number(input.invoiceTotalIncVat)

  const projectionBase = balanceAfter > 0 ? balanceAfter : 0
  const projectionStartOffset = input.invoiceTotalIncVat > 0 ? 1 : 0

  if (Number.isFinite(monthlyCap) && monthlyCap > 0 && projectionBase > 0) {
    lines.push('')
    lines.push(`Payment plan projection (after this invoice is paid, assuming ${formatCurrency(monthlyCap)} / month and no new work):`)

    let remaining = projectionBase
    let monthOffset = 0
    const maxMonths = 120
    const invoiceDateUtc = parseIsoDateUtc(input.invoiceDate)

    while (remaining > 0 && monthOffset < maxMonths) {
      const payment = roundMoney(Math.min(monthlyCap, remaining))
      const label = formatMonthLabel(addMonthsUtc(invoiceDateUtc, monthOffset + projectionStartOffset))
      lines.push(`- ${label}: ${formatCurrency(payment)}`)
      remaining = roundMoney(remaining - payment)
      monthOffset += 1
    }

    if (remaining > 0) {
      lines.push(`- Remaining after ${maxMonths} months: ${formatCurrency(remaining)}`)
    }
  }

  lines.push('')
  lines.push('Payments are applied proportionally across the total balance.')

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
  const preview = url.searchParams.get('preview') === 'true'
  const dryRun = url.searchParams.get('dry_run') === 'true'
  const vendorFilter = url.searchParams.get('vendor_id')

  const now = new Date()
  const londonDay = Number(formatInTimeZone(now, LONDON_TZ, 'd'))
  if (londonDay !== 1 && !force) {
    return NextResponse.json({ skipped: true, reason: 'Not the 1st in Europe/London' })
  }

  const period = getPreviousMonthPeriod(now)
  const invoiceDate = formatInTimeZone(now, LONDON_TZ, 'yyyy-MM-dd')

  const supabase = createAdminClient()

  const vendorIds = new Set<string>()

  if (vendorFilter) {
    vendorIds.add(String(vendorFilter))
  } else {
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
  }

  if (dryRun) {
    const previews: any[] = []
    for (const vendorId of vendorIds) {
      const { data: vendor, error: vendorError } = await supabase
        .from('invoice_vendors')
        .select('id, name, email, contact_name, payment_terms')
        .eq('id', vendorId)
        .maybeSingle()

      if (vendorError || !vendor) {
        previews.push({
          vendor_id: vendorId,
          would_invoice: false,
          reason: vendorError?.message || 'Vendor not found',
        })
        continue
      }

      try {
        const previewResult = await buildDryRunPreview({
          supabase,
          vendorId,
          vendor,
          period,
          invoiceDate,
        })
        previews.push(previewResult)
      } catch (err) {
        previews.push({
          vendor_id: vendorId,
          vendor_name: vendor?.name || '',
          would_invoice: false,
          reason: err instanceof Error ? err.message : 'Failed to build preview',
        })
      }
    }

    return NextResponse.json({
      dry_run: true,
      period: period.period_yyyymm,
      invoice_date: invoiceDate,
      vendors: previews,
    })
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

        if (preview) {
          results.skipped++
          results.vendors.push({
            vendor_id: vendorId,
            status: 'skipped',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            error: 'Preview only',
          })
          continue
        }

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
      const statementMode = !!settings?.statement_mode

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

      const splitResult = await applyPartialSplit({
        supabase,
        persist: true,
        billingMode,
        capIncVat,
        runningIncVat,
        settings,
        selectedRecurringInstances,
        skippedRecurringInstances,
        selectedMileageEntries: selectedMileage,
        skippedMileageEntries: skippedMileage,
        selectedTimeEntries: selectedTime,
        skippedTimeEntries: skippedTime,
      })

      if (splitResult.addedIncVat > 0) {
        runningIncVat = roundMoney(runningIncVat + splitResult.addedIncVat)
      }

      let statementBalanceBefore: number | null = null
      if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0) {
        const summary = await computeStatementBalanceBefore({
          supabase,
          vendorId,
          settings,
          selectedRecurringInstances,
          skippedRecurringInstances,
          selectedMileageEntries: selectedMileage,
          skippedMileageEntries: skippedMileage,
          selectedTimeEntries: selectedTime,
          skippedTimeEntries: skippedTime,
        })
        statementBalanceBefore = summary.balanceBefore
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
      let lineItems: Array<{
        catalog_item_id: string | null
        description: string
        quantity: number
        unit_price: number
        discount_percentage: number
        vat_rate: number
      }> = []

      if (statementMode) {
        lineItems.push(
          ...buildStatementLineItems({
            selectedRecurringInstances,
            selectedMileageEntries: selectedMileage,
            selectedTimeEntries: selectedTime,
            settings,
          })
        )
      } else {
        lineItems.push(
          ...buildDetailedLineItems({
            selectedRecurringInstances,
            selectedMileageEntries: selectedMileage,
            selectedTimeEntries: selectedTime,
            settings,
            periodYyyymm: period.period_yyyymm,
          })
        )
      }

      if (lineItems.length === 0) {
        throw new Error('No invoice line items generated')
      }

      let totals = calculateInvoiceTotals(lineItems, 0)
      if (statementMode && billingMode === 'cap' && capIncVat != null && capIncVat > 0 && statementBalanceBefore != null) {
        const targetIncVat = roundMoney(Math.min(statementBalanceBefore, capIncVat))
        const adjusted = applyStatementCapTopUp({
          lineItems,
          totals,
          targetIncVat,
          vatRate: Number(settings?.vat_rate ?? 20),
        })
        lineItems = adjusted.lineItems
        totals = adjusted.totals
      }

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

      let notes = ''
      let internalNotes = ''
      let attachTimesheet = false

      if (statementMode) {
        notes = await buildStatementNotes({
          supabase,
          vendorId,
          period_start: period.period_start,
          period_end: period.period_end,
          invoiceDate,
          capIncVat,
          settings,
          selectedRecurringInstances,
          skippedRecurringInstances,
          selectedMileageEntries: selectedMileage,
          skippedMileageEntries: skippedMileage,
          selectedTimeEntries: selectedTime,
          skippedTimeEntries: skippedTime,
          invoiceTotalIncVat: totals.totalAmount,
        })

        internalNotes = `Auto-generated by OJ Projects billing run ${billingRun.id} (${period.period_yyyymm}). Statement mode.`
      } else {
        attachTimesheet = notesFull.length > OJ_INVOICE_NOTES_MAX_CHARS
        notes = attachTimesheet ? `${notesCompact}\n\nFull breakdown attached as Timesheet PDF.` : notesFull
        internalNotes = attachTimesheet
          ? `Auto-generated by OJ Projects billing run ${billingRun.id} (${period.period_yyyymm}). ${OJ_TIMESHEET_MARKER}`
          : `Auto-generated by OJ Projects billing run ${billingRun.id} (${period.period_yyyymm}).`
      }

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

      if (preview) {
        results.skipped++
        results.vendors.push({ vendor_id: vendorId, status: 'skipped', invoice_id: invoiceId, invoice_number: invoiceNumber, error: 'Preview only' })
        continue
      }

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
      const body = statementMode
        ? `Hi ${vendor.contact_name || vendor.name || 'there'},\n\nPlease find attached invoice ${invoiceNumber}.\n\nThe invoice includes a balance summary and payment projection.\n\nBest regards,\nPeter\nOrange Jelly Limited`
        : `Hi ${vendor.contact_name || vendor.name || 'there'},\n\nPlease find attached invoice ${invoiceNumber}.\n\nThe invoice notes include a breakdown of hours and mileage.\n\nBest regards,\nPeter\nOrange Jelly Limited`

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
