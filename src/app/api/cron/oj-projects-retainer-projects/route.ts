import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatInTimeZone } from 'date-fns-tz'
import { resolveRetainerProject } from '@/lib/oj-projects/retainer-projects'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LONDON_TZ = 'Europe/London'

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

  const supabase = createAdminClient()

  const { data: retainerSettings, error: settingsError } = await supabase
    .from('oj_vendor_billing_settings')
    .select('vendor_id, retainer_included_hours_per_month')
    .gt('retainer_included_hours_per_month', 0)
    .limit(10000)

  if (settingsError) {
    console.error('Failed to load OJ retainer settings', settingsError)
    return NextResponse.json({ error: 'Failed to load retainer settings' }, { status: 500 })
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
    console.error('Failed to load OJ retainer vendors', vendorsError)
    return NextResponse.json({ error: 'Failed to load retainer vendors' }, { status: 500 })
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
    const vendorId = String(row?.vendor_id || '')
    if (!vendorId) continue

    const vendorName = vendorNameById.get(vendorId) || ''
    const hours = Number(row?.retainer_included_hours_per_month || 0)

    try {
      // Shared with the entries action, so a bucket created on demand when
      // someone logs future-dated work is identical to one created here.
      const result = await resolveRetainerProject(supabase, {
        vendorId,
        periodYyyymm,
        vendorName,
        includedHours: hours,
      })

      if ('error' in result) throw new Error(result.error)

      if (result.created) createdCount++
      else skippedCount++

      results.push({
        vendor_id: vendorId,
        vendor_name: vendorName,
        status: result.created ? 'created' : 'skipped',
        project_id: result.projectId,
        project_code: result.projectCode,
      })
    } catch (err) {
      console.error('Failed to create OJ retainer project for vendor', {
        vendorId,
        error: err instanceof Error ? err.message : String(err)
      })
      results.push({
        vendor_id: vendorId,
        vendor_name: vendorName,
        status: 'failed',
        error: 'Failed to create retainer project',
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
