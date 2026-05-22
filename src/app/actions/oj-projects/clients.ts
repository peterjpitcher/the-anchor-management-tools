'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

export type OJClientSummary = {
  id: string
  name: string
  projectCount: number
  retainerHours: number | null
}

export async function getOJClients() {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects clients' }

  const supabase = await createClient()

  const { data: vendors, error: vendorsError } = await supabase
    .from('invoice_vendors')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
    .limit(10000)

  if (vendorsError) return { error: vendorsError.message }

  const vendorIds = (vendors || []).map((vendor) => String(vendor.id)).filter(Boolean)
  const projectCountByVendor = new Map<string, number>()
  const retainerHoursByVendor = new Map<string, number | null>()

  if (vendorIds.length > 0) {
    const { data: projects, error: projectsError } = await supabase
      .from('oj_projects')
      .select('vendor_id')
      .in('vendor_id', vendorIds)
      .limit(10000)

    if (projectsError) return { error: projectsError.message }

    for (const project of projects || []) {
      const vendorId = String(project.vendor_id || '')
      if (!vendorId) continue
      projectCountByVendor.set(vendorId, (projectCountByVendor.get(vendorId) || 0) + 1)
    }

    const { data: settings, error: settingsError } = await supabase
      .from('oj_vendor_billing_settings')
      .select('vendor_id, retainer_included_hours_per_month')
      .in('vendor_id', vendorIds)
      .limit(10000)

    if (settingsError) return { error: settingsError.message }

    for (const row of settings || []) {
      const vendorId = String(row.vendor_id || '')
      if (!vendorId) continue
      const hours = Number(row.retainer_included_hours_per_month || 0)
      retainerHoursByVendor.set(vendorId, Number.isFinite(hours) && hours > 0 ? hours : null)
    }
  }

  const clients: OJClientSummary[] = (vendors || []).map((vendor) => ({
    id: String(vendor.id),
    name: String(vendor.name || 'Unknown'),
    projectCount: projectCountByVendor.get(String(vendor.id)) || 0,
    retainerHours: retainerHoursByVendor.get(String(vendor.id)) ?? null,
  }))

  return { clients }
}
