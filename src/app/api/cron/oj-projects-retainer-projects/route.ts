import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatInTimeZone } from 'date-fns-tz'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LONDON_TZ = 'Europe/London'

function deriveClientCode(vendorName: string) {
  const stopWords = new Set(['THE', 'LIMITED', 'LTD', 'CO', 'COMPANY', 'GROUP', 'SERVICES', 'SERVICE', 'AND'])
  const tokens = String(vendorName || '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .map((t) => t.toUpperCase())
    .filter((t) => !stopWords.has(t))

  if (tokens.length === 0) return 'CLIENT'

  const initials = tokens.slice(0, 3).map((t) => t[0]).join('')
  if (initials.length >= 3) return initials
  return tokens[0].slice(0, 3)
}

function randomSuffix(length = 5) {
  while (true) {
    const raw = crypto.randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (raw.length >= length) return raw.slice(0, length)
  }
}

async function generateRetainerProjectCode(
  supabase: ReturnType<typeof createAdminClient>,
  vendorId: string,
  periodYyyymm: string
) {
  let clientCode: string | null = null
  try {
    const { data: settings } = await supabase
      .from('oj_vendor_billing_settings')
      .select('client_code')
      .eq('vendor_id', vendorId)
      .maybeSingle()
    if (settings?.client_code) {
      clientCode = String(settings.client_code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || null
    }
  } catch {}

  if (!clientCode) {
    const { data: vendor } = await supabase
      .from('invoice_vendors')
      .select('name')
      .eq('id', vendorId)
      .maybeSingle()
    clientCode = deriveClientCode(String(vendor?.name || 'CLIENT'))
  }

  const periodCompact = periodYyyymm.replace('-', '')
  const base = `OJP-${clientCode}-RET-${periodCompact}`

  // Best-effort uniqueness: deterministic base, then suffix if needed.
  const { data: existing } = await supabase
    .from('oj_projects')
    .select('id')
    .eq('project_code', base)
    .maybeSingle()

  if (!existing) return base
  return `${base}-${randomSuffix(4)}`
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

  const periodYyyymm = formatInTimeZone(now, LONDON_TZ, 'yyyy-MM')
  const monthLabel = formatInTimeZone(now, LONDON_TZ, 'MMM yyyy')

  const supabase = createAdminClient()

  const { data: retainerSettings, error: settingsError } = await supabase
    .from('oj_vendor_billing_settings')
    .select('vendor_id, retainer_included_hours_per_month')
    .gt('retainer_included_hours_per_month', 0)
    .limit(10000)

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 500 })
  }

  const vendorIds = (retainerSettings || [])
    .map((s: any) => String(s.vendor_id || ''))
    .filter(Boolean)

  if (vendorIds.length === 0) {
    return NextResponse.json({ period_yyyymm: periodYyyymm, created: 0, skipped: 0, vendors: [] })
  }

  const { data: vendors, error: vendorsError } = await supabase
    .from('invoice_vendors')
    .select('id, name')
    .in('id', vendorIds)
    .limit(10000)

  if (vendorsError) {
    return NextResponse.json({ error: vendorsError.message }, { status: 500 })
  }

  const vendorNameById = new Map<string, string>()
  for (const v of vendors || []) {
    if (v?.id) vendorNameById.set(String(v.id), String(v.name || ''))
  }

  let createdCount = 0
  let skippedCount = 0

  const results: Array<{
    vendor_id: string
    vendor_name: string
    status: 'created' | 'skipped' | 'failed'
    project_id?: string
    project_code?: string
    error?: string
  }> = []

  for (const row of retainerSettings || []) {
    const vendorId = String((row as any)?.vendor_id || '')
    if (!vendorId) continue

    const vendorName = vendorNameById.get(vendorId) || ''
    const hours = Number((row as any)?.retainer_included_hours_per_month || 0)

    try {
      const { data: existing, error: existingError } = await supabase
        .from('oj_projects')
        .select('id, project_code')
        .eq('vendor_id', vendorId)
        .eq('is_retainer', true)
        .eq('retainer_period_yyyymm', periodYyyymm)
        .maybeSingle()

      if (existingError) throw new Error(existingError.message)

      if (existing?.id) {
        skippedCount++
        results.push({
          vendor_id: vendorId,
          vendor_name: vendorName,
          status: 'skipped',
          project_id: String(existing.id),
          project_code: String(existing.project_code || ''),
        })
        continue
      }

      const projectCode = await generateRetainerProjectCode(supabase, vendorId, periodYyyymm)
      const projectName = `${vendorName || 'Client'} — Retainer (${monthLabel})`
      const brief = `Monthly retainer bucket for ${monthLabel}. Log small BAU work here.`
      const internalNotes = `Auto-created by OJ Projects retainer cron for ${periodYyyymm}.`

      const { data: created, error: createError } = await supabase
        .from('oj_projects')
        .insert({
          vendor_id: vendorId,
          project_code: projectCode,
          project_name: projectName,
          brief,
          internal_notes: internalNotes,
          deadline: null,
          budget_ex_vat: null,
          budget_hours: Number.isFinite(hours) && hours > 0 ? hours : null,
          status: 'active',
          is_retainer: true,
          retainer_period_yyyymm: periodYyyymm,
        })
        .select('id, project_code')
        .single()

      if (createError) throw new Error(createError.message)

      createdCount++
      results.push({
        vendor_id: vendorId,
        vendor_name: vendorName,
        status: 'created',
        project_id: String(created.id),
        project_code: String(created.project_code || projectCode),
      })
    } catch (err) {
      results.push({
        vendor_id: vendorId,
        vendor_name: vendorName,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Failed to create retainer project',
      })
    }
  }

  return NextResponse.json({
    period_yyyymm: periodYyyymm,
    created: createdCount,
    skipped: skippedCount,
    vendors: results,
  })
}

