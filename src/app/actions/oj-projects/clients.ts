'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { parsePaymentTermsValue } from '@/lib/vendors/paymentTerms'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

function optionalText(value: FormDataEntryValue | null): string | null {
  const text = String(value || '').trim()
  return text ? text : null
}

export type OJClientSummary = {
  id: string
  name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  vat_number: string | null
  payment_terms: number | null
  notes: string | null
  projectCount: number
  retainerHours: number | null
}

const OJClientSchema = z.object({
  name: z.string().trim().min(1, 'Client name is required').max(200),
  contact_name: z.string().trim().max(200).nullable(),
  email: z.string().trim().email('Invalid email format').nullable().or(z.literal(null)),
  phone: z.string().trim().max(50).nullable(),
  address: z.string().trim().max(1000).nullable(),
  vat_number: z.string().trim().max(50).nullable(),
  payment_terms: z.number().int().min(0).max(365),
  notes: z.string().trim().max(2000).nullable(),
})

function revalidateOJClientPaths(): void {
  revalidatePath('/oj-projects')
  revalidatePath('/oj-projects/clients')
  revalidatePath('/oj-projects/entries')
  revalidatePath('/oj-projects/projects')
}

export async function getOJClients() {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view OJ Projects clients' }

  const supabase = await createClient()

  const { data: vendors, error: vendorsError } = await supabase
    .from('invoice_vendors')
    .select('id, name, contact_name, email, phone, address, vat_number, payment_terms, notes')
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
    contact_name: vendor.contact_name ?? null,
    email: vendor.email ?? null,
    phone: vendor.phone ?? null,
    address: vendor.address ?? null,
    vat_number: vendor.vat_number ?? null,
    payment_terms: typeof vendor.payment_terms === 'number' ? vendor.payment_terms : null,
    notes: vendor.notes ?? null,
    projectCount: projectCountByVendor.get(String(vendor.id)) || 0,
    retainerHours: retainerHoursByVendor.get(String(vendor.id)) ?? null,
  }))

  return { clients }
}

export async function createOJClient(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create OJ clients' }

  const parsed = OJClientSchema.safeParse({
    name: formData.get('name'),
    contact_name: optionalText(formData.get('contact_name')),
    email: optionalText(formData.get('email')),
    phone: optionalText(formData.get('phone')),
    address: optionalText(formData.get('address')),
    vat_number: optionalText(formData.get('vat_number')),
    payment_terms: parsePaymentTermsValue(formData.get('payment_terms')),
    notes: optionalText(formData.get('notes')),
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('invoice_vendors')
    .insert({
      ...parsed.data,
      is_active: true,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_client',
    resource_id: data.id,
    operation_status: 'success',
    new_values: parsed.data,
  })

  revalidateOJClientPaths()
  return { client: data, success: true as const }
}

export async function updateOJClient(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to update OJ clients' }

  const id = String(formData.get('id') || '')
  if (!z.string().uuid().safeParse(id).success) return { error: 'Invalid client ID' }

  const parsed = OJClientSchema.safeParse({
    name: formData.get('name'),
    contact_name: optionalText(formData.get('contact_name')),
    email: optionalText(formData.get('email')),
    phone: optionalText(formData.get('phone')),
    address: optionalText(formData.get('address')),
    vat_number: optionalText(formData.get('vat_number')),
    payment_terms: parsePaymentTermsValue(formData.get('payment_terms')),
    notes: optionalText(formData.get('notes')),
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: before } = await supabase
    .from('invoice_vendors')
    .select('id, name, contact_name, email, phone, address, vat_number, payment_terms, notes')
    .eq('id', id)
    .maybeSingle()

  const { data, error } = await supabase
    .from('invoice_vendors')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'Client not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'update',
    resource_type: 'oj_client',
    resource_id: id,
    operation_status: 'success',
    old_values: before ?? undefined,
    new_values: parsed.data,
  })

  revalidateOJClientPaths()
  return { client: data, success: true as const }
}

export async function deleteOJClient(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'delete')
  if (!hasPermission) return { error: 'You do not have permission to delete OJ clients' }

  const id = String(formData.get('id') || '')
  if (!z.string().uuid().safeParse(id).success) return { error: 'Invalid client ID' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: projects, error: projectsError }, { data: invoices, error: invoicesError }] = await Promise.all([
    supabase.from('oj_projects').select('id').eq('vendor_id', id).limit(1),
    supabase.from('invoices').select('id').eq('vendor_id', id).is('deleted_at', null).limit(1),
  ])
  if (projectsError) return { error: projectsError.message }
  if (invoicesError) return { error: invoicesError.message }

  const hasLinkedRecords = Boolean(projects?.length || invoices?.length)
  const operation = hasLinkedRecords ? 'deactivate' : 'delete'
  const query = hasLinkedRecords
    ? supabase.from('invoice_vendors').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id)
    : supabase.from('invoice_vendors').delete().eq('id', id)

  const { data, error } = await query.select('id, name').maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Client not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: operation,
    resource_type: 'oj_client',
    resource_id: id,
    operation_status: 'success',
    additional_info: hasLinkedRecords ? { reason: 'Client has linked projects or invoices' } : undefined,
  })

  revalidateOJClientPaths()
  return { success: true as const, action: operation }
}
