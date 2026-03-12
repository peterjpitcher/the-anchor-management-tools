'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { z } from 'zod'

const TimeEntrySchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID'),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  duration_minutes: z.coerce.number().min(1, 'Duration must be at least 1 minute'),
  work_type_id: z.string().uuid('Invalid work type').optional().or(z.literal('')).optional(),
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

const MileageEntrySchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID'),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  miles: z.coerce.number().min(0.01, 'Miles must be greater than 0'),
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

const OneOffChargeSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID'),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  amount_ex_vat: z.coerce.number().positive('Amount must be greater than 0'),
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

const UpdateEntrySchema = z.object({
  id: z.string().uuid('Invalid entry ID'),
  entry_type: z.enum(['time', 'mileage', 'one_off'] as const),
  vendor_id: z.string().uuid('Invalid vendor ID'),
  project_id: z.string().uuid('Invalid project ID'),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  duration_minutes: z.coerce.number().min(1).optional(),
  miles: z.coerce.number().optional(),
  amount_ex_vat: z.coerce.number().positive().optional(),
  work_type_id: z.string().uuid().optional().or(z.literal('')).optional(),
  description: z.string().max(5000).optional(),
  internal_notes: z.string().max(10000).optional(),
  billable: z.coerce.boolean().optional(),
})

async function getVendorSettingsOrDefault(supabase: Awaited<ReturnType<typeof createClient>>, vendorId: string) {
  const { data } = await supabase
    .from('oj_vendor_billing_settings')
    .select('hourly_rate_ex_vat, vat_rate, mileage_rate')
    .eq('vendor_id', vendorId)
    .maybeSingle()

  return {
    hourly_rate_ex_vat: typeof data?.hourly_rate_ex_vat === 'number' ? data.hourly_rate_ex_vat : 75,
    vat_rate: typeof data?.vat_rate === 'number' ? data.vat_rate : 20,
    mileage_rate: typeof data?.mileage_rate === 'number' ? data.mileage_rate : 0.42,
  }
}

async function ensureProjectMatchesVendor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  vendorId: string
) {
  const { data: project, error } = await supabase
    .from('oj_projects')
    .select('id, vendor_id, status')
    .eq('id', projectId)
    .single()

  if (error) return { error: error.message }
  if (project.vendor_id !== vendorId) {
    return { error: 'Selected project does not belong to the selected vendor' }
  }
  if (project.status === 'completed' || project.status === 'archived') {
    return { error: 'Cannot add entries to a closed project' }
  }
  return { success: true as const }
}

async function getWorkTypeName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workTypeId: string | null
) {
  if (!workTypeId) return null
  const { data } = await supabase
    .from('oj_work_types')
    .select('name')
    .eq('id', workTypeId)
    .maybeSingle()
  return data?.name ? String(data.name) : null
}

export async function getEntries(options?: {
  vendorId?: string
  projectId?: string
  status?: string
  entryType?: string
  startDate?: string
  endDate?: string
  limit?: number
}) {
  const hasPermission = await checkUserPermission('oj_projects', 'view')
  if (!hasPermission) return { error: 'You do not have permission to view entries' }

  const supabase = await createClient()
  let query = supabase
    .from('oj_entries')
    .select(`
      *,
      project:oj_projects(
        id,
        project_code,
        project_name
      ),
      vendor:invoice_vendors(
        id,
        name
      ),
      work_type:oj_work_types(
        id,
        name
      )
    `)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (options?.vendorId) query = query.eq('vendor_id', options.vendorId)
  if (options?.projectId) query = query.eq('project_id', options.projectId)
  if (options?.status && options.status !== 'all') query = query.eq('status', options.status)
  if (options?.entryType && options.entryType !== 'all') query = query.eq('entry_type', options.entryType)
  if (options?.startDate) query = query.gte('entry_date', options.startDate)
  if (options?.endDate) query = query.lte('entry_date', options.endDate)
  if (options?.limit) query = query.limit(options.limit)

  const { data, error } = await query
  if (error) return { error: error.message }
  return { entries: data || [] }
}

export async function createTimeEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create entries' }

  const parsed = TimeEntrySchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id'),
    entry_date: formData.get('entry_date'),
    duration_minutes: formData.get('duration_minutes'),
    work_type_id: formData.get('work_type_id') || undefined,
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const rawMinutes = parsed.data.duration_minutes
  const roundedMinutes = Math.ceil(rawMinutes / 15) * 15
  if (roundedMinutes <= 0) return { error: 'Invalid duration after rounding' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
  if ('error' in match) return { error: match.error }

  const workTypeId = parsed.data.work_type_id ? String(parsed.data.work_type_id) : null
  const [settings, workTypeName] = await Promise.all([
    getVendorSettingsOrDefault(supabase, parsed.data.vendor_id),
    getWorkTypeName(supabase, workTypeId),
  ])

  const { data, error } = await supabase
    .from('oj_entries')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_id: parsed.data.project_id,
      entry_type: 'time',
      entry_date: parsed.data.entry_date,
      start_at: null,
      end_at: null,
      duration_minutes_raw: rawMinutes,
      duration_minutes_rounded: roundedMinutes,
      miles: null,
      work_type_id: workTypeId,
      work_type_name_snapshot: workTypeName,
      description: parsed.data.description || null,
      internal_notes: parsed.data.internal_notes || null,
      billable: parsed.data.billable ?? true,
      status: 'unbilled',
      hourly_rate_ex_vat_snapshot: settings.hourly_rate_ex_vat,
      vat_rate_snapshot: settings.vat_rate,
      mileage_rate_snapshot: null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_entry',
    resource_id: data.id,
    operation_status: 'success',
    new_values: {
      entry_type: 'time',
      project_id: data.project_id,
      entry_date: data.entry_date,
      duration_minutes_rounded: data.duration_minutes_rounded,
    },
  })

  return { entry: data, success: true as const }
}

export async function createMileageEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create entries' }

  const parsed = MileageEntrySchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id'),
    entry_date: formData.get('entry_date'),
    miles: formData.get('miles'),
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
  if ('error' in match) return { error: match.error }

  const settings = await getVendorSettingsOrDefault(supabase, parsed.data.vendor_id)

  const { data, error } = await supabase
    .from('oj_entries')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_id: parsed.data.project_id,
      entry_type: 'mileage',
      entry_date: parsed.data.entry_date,
      start_at: null,
      end_at: null,
      duration_minutes_raw: null,
      duration_minutes_rounded: null,
      miles: parsed.data.miles,
      work_type_id: null,
      work_type_name_snapshot: null,
      description: parsed.data.description || null,
      internal_notes: parsed.data.internal_notes || null,
      billable: parsed.data.billable ?? true,
      status: 'unbilled',
      hourly_rate_ex_vat_snapshot: null,
      vat_rate_snapshot: 0,
      mileage_rate_snapshot: settings.mileage_rate,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_entry',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { entry_type: 'mileage', project_id: data.project_id, entry_date: data.entry_date, miles: data.miles },
  })

  return { entry: data, success: true as const }
}

export async function createOneOffCharge(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create entries' }

  const parsed = OneOffChargeSchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id'),
    entry_date: formData.get('entry_date'),
    amount_ex_vat: formData.get('amount_ex_vat'),
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
  if ('error' in match) return { error: match.error }

  const settings = await getVendorSettingsOrDefault(supabase, parsed.data.vendor_id)

  const { data, error } = await supabase
    .from('oj_entries')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_id: parsed.data.project_id,
      entry_type: 'one_off',
      entry_date: parsed.data.entry_date,
      start_at: null,
      end_at: null,
      duration_minutes_raw: null,
      duration_minutes_rounded: null,
      miles: null,
      work_type_id: null,
      work_type_name_snapshot: null,
      description: parsed.data.description || null,
      internal_notes: parsed.data.internal_notes || null,
      billable: parsed.data.billable ?? true,
      status: 'unbilled',
      hourly_rate_ex_vat_snapshot: null,
      vat_rate_snapshot: settings.vat_rate,
      mileage_rate_snapshot: null,
      amount_ex_vat_snapshot: parsed.data.amount_ex_vat,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_entry',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { entry_type: 'one_off', project_id: data.project_id, entry_date: data.entry_date, amount_ex_vat_snapshot: data.amount_ex_vat_snapshot },
  })

  return { entry: data, success: true as const }
}

export async function updateEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'edit')
  if (!hasPermission) return { error: 'You do not have permission to edit entries' }

  const parsed = UpdateEntrySchema.safeParse({
    id: formData.get('id'),
    entry_type: formData.get('entry_type'),
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id'),
    entry_date: formData.get('entry_date'),
    duration_minutes: formData.get('duration_minutes') || undefined,
    miles: formData.get('miles') ?? undefined,
    amount_ex_vat: formData.get('amount_ex_vat') || undefined,
    work_type_id: formData.get('work_type_id') || undefined,
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: existing, error: fetchError } = await supabase
    .from('oj_entries')
    .select('id, status, start_at, end_at')
    .eq('id', parsed.data.id)
    .single()

  if (fetchError || !existing) return { error: fetchError?.message || 'Entry not found' }
  if (existing.status !== 'unbilled') return { error: 'Only unbilled entries can be edited' }

  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
  if ('error' in match) return { error: match.error }

  const entryWorkTypeId = parsed.data.entry_type === 'time' && parsed.data.work_type_id
    ? String(parsed.data.work_type_id)
    : null
  const [settings, preloadedWorkTypeName] = await Promise.all([
    getVendorSettingsOrDefault(supabase, parsed.data.vendor_id),
    parsed.data.entry_type === 'time' ? getWorkTypeName(supabase, entryWorkTypeId) : Promise.resolve(null),
  ])

  if (parsed.data.entry_type === 'time') {
    if (!parsed.data.duration_minutes) {
      return { error: 'Duration is required for time entries' }
    }

    const rawMinutes = parsed.data.duration_minutes
    const roundedMinutes = Math.ceil(rawMinutes / 15) * 15
    if (roundedMinutes <= 0) return { error: 'Invalid duration after rounding' }

    const workTypeId = entryWorkTypeId
    const workTypeName = preloadedWorkTypeName

    const { data, error } = await supabase
      .from('oj_entries')
      .update({
        vendor_id: parsed.data.vendor_id,
        project_id: parsed.data.project_id,
        entry_date: parsed.data.entry_date,
        start_at: existing.start_at ?? null,
        end_at: existing.end_at ?? null,
        duration_minutes_raw: rawMinutes,
        duration_minutes_rounded: roundedMinutes,
        work_type_id: workTypeId,
        work_type_name_snapshot: workTypeName,
        description: parsed.data.description ?? null,
        internal_notes: parsed.data.internal_notes ?? null,
        billable: parsed.data.billable ?? true,
        hourly_rate_ex_vat_snapshot: settings.hourly_rate_ex_vat,
        vat_rate_snapshot: settings.vat_rate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.id)
      .select('*')
      .maybeSingle()

    if (error) return { error: error.message }
    if (!data) return { error: 'Entry not found' }

    await logAuditEvent({
      user_id: user?.id,
      user_email: user?.email,
      operation_type: 'update',
      resource_type: 'oj_entry',
      resource_id: parsed.data.id,
      operation_status: 'success',
      new_values: { entry_type: 'time', duration_minutes_rounded: roundedMinutes },
    })

    return { entry: data, success: true as const }
  }

  // one_off
  if (parsed.data.entry_type === 'one_off') {
    if (typeof parsed.data.amount_ex_vat !== 'number' || !Number.isFinite(parsed.data.amount_ex_vat) || parsed.data.amount_ex_vat <= 0) {
      return { error: 'Amount must be greater than 0' }
    }

    const { data, error } = await supabase
      .from('oj_entries')
      .update({
        vendor_id: parsed.data.vendor_id,
        project_id: parsed.data.project_id,
        entry_date: parsed.data.entry_date,
        amount_ex_vat_snapshot: parsed.data.amount_ex_vat,
        description: parsed.data.description ?? null,
        internal_notes: parsed.data.internal_notes ?? null,
        billable: parsed.data.billable ?? true,
        vat_rate_snapshot: settings.vat_rate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.id)
      .select('*')
      .maybeSingle()

    if (error) return { error: error.message }
    if (!data) return { error: 'Entry not found' }

    await logAuditEvent({
      user_id: user?.id,
      user_email: user?.email,
      operation_type: 'update',
      resource_type: 'oj_entry',
      resource_id: parsed.data.id,
      operation_status: 'success',
      new_values: { entry_type: 'one_off', amount_ex_vat_snapshot: parsed.data.amount_ex_vat },
    })

    return { entry: data, success: true as const }
  }

  // mileage
  if (typeof parsed.data.miles !== 'number' || !Number.isFinite(parsed.data.miles) || parsed.data.miles <= 0) {
    return { error: 'Miles must be greater than 0' }
  }

  const { data, error } = await supabase
    .from('oj_entries')
    .update({
      vendor_id: parsed.data.vendor_id,
      project_id: parsed.data.project_id,
      entry_date: parsed.data.entry_date,
      miles: parsed.data.miles,
      description: parsed.data.description ?? null,
      internal_notes: parsed.data.internal_notes ?? null,
      billable: parsed.data.billable ?? true,
      mileage_rate_snapshot: settings.mileage_rate,
      vat_rate_snapshot: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .select('*')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'Entry not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'update',
    resource_type: 'oj_entry',
    resource_id: parsed.data.id,
    operation_status: 'success',
    new_values: { entry_type: 'mileage', miles: parsed.data.miles },
  })

  return { entry: data, success: true as const }
}

export async function deleteEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'delete')
  if (!hasPermission) return { error: 'You do not have permission to delete entries' }

  const id = String(formData.get('id') || '')
  if (!id) return { error: 'Entry ID is required' }

  // L16: Validate UUID format before using in DB query
  if (!z.string().uuid().safeParse(id).success) return { error: 'Invalid entry ID' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: entry, error: fetchError } = await supabase
    .from('oj_entries')
    .select('id, status')
    .eq('id', id)
    .single()

  if (fetchError || !entry) return { error: fetchError?.message || 'Entry not found' }
  if (entry.status !== 'unbilled') return { error: 'Only unbilled entries can be deleted' }

  const { data: deletedEntry, error } = await supabase
    .from('oj_entries')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!deletedEntry) return { error: 'Entry not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'delete',
    resource_type: 'oj_entry',
    resource_id: id,
    operation_status: 'success',
  })

  return { success: true as const }
}
