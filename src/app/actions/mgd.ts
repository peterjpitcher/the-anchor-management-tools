'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getMgdQuarter, getCurrentMgdQuarter } from '@/lib/mgd/quarterMapping'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MgdCollection {
  id: string
  collection_date: string
  net_take: number
  mgd_amount: number
  vat_on_supplier: number
  notes: string | null
  return_id: string
  created_at: string
  updated_at: string
}

export interface MgdReturn {
  id: string
  period_start: string
  period_end: string
  total_net_take: number
  total_mgd: number
  total_vat_on_supplier: number
  status: 'open' | 'submitted' | 'paid'
  submitted_at: string | null
  submitted_by: string | null
  date_paid: string | null
  created_at: string
  updated_at: string
  collection_count?: number
}

type ActionResult<T = undefined> = Promise<
  { success: true; data?: T } | { error: string }
>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireMgdPermission(): Promise<
  { userId: string } | { error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const allowed = await checkUserPermission('mgd', 'manage', user.id)
  if (!allowed) return { error: 'Insufficient permissions' }

  return { userId: user.id }
}

// ---------------------------------------------------------------------------
// Validation Schemas
// ---------------------------------------------------------------------------

const collectionSchema = z.object({
  collection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  net_take: z.number().min(0, 'Net take must be >= 0'),
  vat_on_supplier: z.number().min(0, 'VAT on supplier must be >= 0'),
  notes: z.string().optional().nullable(),
})

const updateCollectionSchema = collectionSchema.extend({
  id: z.string().uuid(),
})

const updateReturnStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'submitted', 'paid']),
  date_paid: z.string().optional().nullable(),
  confirm_reopen_from_paid: z.boolean().optional(),
})

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch collections, optionally filtered by return period.
 */
export async function getCollections(
  periodStart?: string,
  periodEnd?: string
): ActionResult<MgdCollection[]> {
  const auth = await requireMgdPermission()
  if ('error' in auth) return { error: auth.error }

  const db = createAdminClient()
  let query = db
    .from('mgd_collections')
    .select('*')
    .order('collection_date', { ascending: false })

  if (periodStart && periodEnd) {
    // Filter collections whose return matches this period
    // First get the return id for this period
    const { data: ret } = await db
      .from('mgd_returns')
      .select('id')
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .maybeSingle()

    if (!ret) {
      return { success: true, data: [] }
    }
    query = query.eq('return_id', ret.id)
  }

  const { data, error } = await query

  if (error) return { error: error.message }
  return { success: true, data: data as MgdCollection[] }
}

/**
 * Fetch all returns ordered by period_start DESC, with collection count.
 */
export async function getReturns(): ActionResult<MgdReturn[]> {
  const auth = await requireMgdPermission()
  if ('error' in auth) return { error: auth.error }

  const db = createAdminClient()
  const { data, error } = await db
    .from('mgd_returns')
    .select('*, mgd_collections(count)')
    .order('period_start', { ascending: false })

  if (error) return { error: error.message }

  const returns: MgdReturn[] = (data ?? []).map((r: Record<string, unknown>) => {
    const collectionAgg = r.mgd_collections as
      | Array<{ count: number }>
      | undefined
    return {
      id: r.id as string,
      period_start: r.period_start as string,
      period_end: r.period_end as string,
      total_net_take: r.total_net_take as number,
      total_mgd: r.total_mgd as number,
      total_vat_on_supplier: r.total_vat_on_supplier as number,
      status: r.status as MgdReturn['status'],
      submitted_at: r.submitted_at as string | null,
      submitted_by: r.submitted_by as string | null,
      date_paid: r.date_paid as string | null,
      created_at: r.created_at as string,
      updated_at: r.updated_at as string,
      collection_count: collectionAgg?.[0]?.count ?? 0,
    }
  })

  return { success: true, data: returns }
}

/**
 * Fetch the return for the current MGD quarter.
 * If none exists yet, returns null — the trigger will auto-create it
 * when the first collection is inserted.
 */
export async function getCurrentReturn(): ActionResult<MgdReturn | null> {
  const auth = await requireMgdPermission()
  if ('error' in auth) return { error: auth.error }

  const { periodStart, periodEnd } = getCurrentMgdQuarter()
  const db = createAdminClient()

  const { data, error } = await db
    .from('mgd_returns')
    .select('*, mgd_collections(count)')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { success: true, data: null }

  const collectionAgg = data.mgd_collections as
    | Array<{ count: number }>
    | undefined

  return {
    success: true,
    data: {
      ...data,
      collection_count: collectionAgg?.[0]?.count ?? 0,
    } as MgdReturn,
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new MGD collection. Rejects if the return for the collection's
 * date period is 'submitted' or 'paid'.
 */
export async function createCollection(formData: {
  collection_date: string
  net_take: number
  vat_on_supplier: number
  notes?: string | null
}): ActionResult<MgdCollection> {
  const auth = await requireMgdPermission()
  if ('error' in auth) return { error: auth.error }

  const parsed = collectionSchema.safeParse(formData)
  if (!parsed.success) {
    return { error: parsed.error.errors.map((e) => e.message).join(', ') }
  }

  const { collection_date, net_take, vat_on_supplier, notes } = parsed.data

  // Determine the quarter for the collection date
  const [y, m, d] = collection_date.split('-').map(Number)
  const quarter = getMgdQuarter(new Date(y, m - 1, d))

  // Check if the return for this period is locked
  const db = createAdminClient()
  const { data: existingReturn } = await db
    .from('mgd_returns')
    .select('id, status')
    .eq('period_start', quarter.periodStart)
    .eq('period_end', quarter.periodEnd)
    .maybeSingle()

  if (existingReturn && (existingReturn.status === 'submitted' || existingReturn.status === 'paid')) {
    return {
      error: `Cannot add collections to a ${existingReturn.status} return. Reopen the return first.`,
    }
  }

  const { data, error } = await db
    .from('mgd_collections')
    .insert({
      collection_date,
      net_take,
      vat_on_supplier,
      notes: notes ?? null,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'create',
    resource_type: 'mgd_collection',
    resource_id: data.id,
    operation_status: 'success',
    new_values: { collection_date, net_take, vat_on_supplier },
  })

  revalidatePath('/mgd')
  return { success: true, data: data as MgdCollection }
}

/**
 * Update an existing MGD collection.
 * Rejects if the return is 'submitted' or 'paid'.
 */
export async function updateCollection(formData: {
  id: string
  collection_date: string
  net_take: number
  vat_on_supplier: number
  notes?: string | null
}): ActionResult<MgdCollection> {
  const auth = await requireMgdPermission()
  if ('error' in auth) return { error: auth.error }

  const parsed = updateCollectionSchema.safeParse(formData)
  if (!parsed.success) {
    return { error: parsed.error.errors.map((e) => e.message).join(', ') }
  }

  const { id, collection_date, net_take, vat_on_supplier, notes } = parsed.data
  const db = createAdminClient()

  // Fetch current collection to find its return
  const { data: existing, error: fetchErr } = await db
    .from('mgd_collections')
    .select('*, mgd_returns!inner(status)')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) return { error: 'Collection not found' }

  const returnStatus = (
    existing.mgd_returns as unknown as { status: string }
  )?.status
  if (returnStatus === 'submitted' || returnStatus === 'paid') {
    return {
      error: `Cannot edit collections in a ${returnStatus} return. Reopen the return first.`,
    }
  }

  // Also check the target period (if date changed, collections move periods via trigger)
  const [y, m, d] = collection_date.split('-').map(Number)
  const targetQuarter = getMgdQuarter(new Date(y, m - 1, d))
  const { data: targetReturn } = await db
    .from('mgd_returns')
    .select('id, status')
    .eq('period_start', targetQuarter.periodStart)
    .eq('period_end', targetQuarter.periodEnd)
    .maybeSingle()

  if (targetReturn && (targetReturn.status === 'submitted' || targetReturn.status === 'paid')) {
    return {
      error: `Cannot move collection into a ${targetReturn.status} return period.`,
    }
  }

  const { data: updated, error: updateErr } = await db
    .from('mgd_collections')
    .update({
      collection_date,
      net_take,
      vat_on_supplier,
      notes: notes ?? null,
    })
    .eq('id', id)
    .select()
    .single()

  if (updateErr) return { error: updateErr.message }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'mgd_collection',
    resource_id: id,
    operation_status: 'success',
    old_values: {
      collection_date: existing.collection_date,
      net_take: existing.net_take,
      vat_on_supplier: existing.vat_on_supplier,
    },
    new_values: { collection_date, net_take, vat_on_supplier },
  })

  revalidatePath('/mgd')
  return { success: true, data: updated as MgdCollection }
}

/**
 * Delete a collection. Rejects if return is submitted/paid.
 */
export async function deleteCollection(id: string): ActionResult {
  const auth = await requireMgdPermission()
  if ('error' in auth) return { error: auth.error }

  if (!id || !z.string().uuid().safeParse(id).success) {
    return { error: 'Invalid collection ID' }
  }

  const db = createAdminClient()

  const { data: existing, error: fetchErr } = await db
    .from('mgd_collections')
    .select('*, mgd_returns!inner(status)')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) return { error: 'Collection not found' }

  const returnStatus = (
    existing.mgd_returns as unknown as { status: string }
  )?.status
  if (returnStatus === 'submitted' || returnStatus === 'paid') {
    return {
      error: `Cannot delete collections from a ${returnStatus} return. Reopen the return first.`,
    }
  }

  const { error: delErr } = await db
    .from('mgd_collections')
    .delete()
    .eq('id', id)

  if (delErr) return { error: delErr.message }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'delete',
    resource_type: 'mgd_collection',
    resource_id: id,
    operation_status: 'success',
    old_values: {
      collection_date: existing.collection_date,
      net_take: existing.net_take,
    },
  })

  revalidatePath('/mgd')
  return { success: true }
}

/**
 * Update return status with lifecycle enforcement:
 *   open -> submitted: set submitted_at, submitted_by
 *   submitted -> paid: set date_paid (required)
 *   submitted -> open: clear submitted_at/submitted_by (reopen for corrections)
 *   paid -> open: requires confirm_reopen_from_paid flag (destructive)
 */
export async function updateReturnStatus(formData: {
  id: string
  status: 'open' | 'submitted' | 'paid'
  date_paid?: string | null
  confirm_reopen_from_paid?: boolean
}): ActionResult<MgdReturn> {
  const auth = await requireMgdPermission()
  if ('error' in auth) return { error: auth.error }

  const parsed = updateReturnStatusSchema.safeParse(formData)
  if (!parsed.success) {
    return { error: parsed.error.errors.map((e) => e.message).join(', ') }
  }

  const { id, status: newStatus, date_paid, confirm_reopen_from_paid } = parsed.data
  const db = createAdminClient()

  const { data: existing, error: fetchErr } = await db
    .from('mgd_returns')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !existing) return { error: 'Return not found' }

  const currentStatus = existing.status as string

  // Validate lifecycle transitions
  const validTransitions: Record<string, string[]> = {
    open: ['submitted'],
    submitted: ['paid', 'open'],
    paid: ['open'],
  }

  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    return {
      error: `Cannot transition from '${currentStatus}' to '${newStatus}'.`,
    }
  }

  // paid -> open requires explicit confirmation
  if (currentStatus === 'paid' && newStatus === 'open' && !confirm_reopen_from_paid) {
    return {
      error: 'Reopening a paid return requires explicit confirmation.',
    }
  }

  // submitted -> paid requires date_paid
  if (currentStatus === 'submitted' && newStatus === 'paid' && !date_paid) {
    return { error: 'Date paid is required when marking a return as paid.' }
  }

  // Build the update payload
  const updatePayload: Record<string, unknown> = { status: newStatus }

  if (currentStatus === 'open' && newStatus === 'submitted') {
    updatePayload.submitted_at = new Date().toISOString()
    updatePayload.submitted_by = auth.userId
  }

  if (currentStatus === 'submitted' && newStatus === 'paid') {
    updatePayload.date_paid = date_paid
  }

  if (newStatus === 'open') {
    // Reopening — clear submission/payment metadata
    updatePayload.submitted_at = null
    updatePayload.submitted_by = null
    updatePayload.date_paid = null
  }

  const { data: updated, error: updateErr } = await db
    .from('mgd_returns')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (updateErr) return { error: updateErr.message }

  await logAuditEvent({
    user_id: auth.userId,
    operation_type: 'update',
    resource_type: 'mgd_return',
    resource_id: id,
    operation_status: 'success',
    old_values: { status: currentStatus },
    new_values: { status: newStatus, date_paid },
  })

  revalidatePath('/mgd')
  return { success: true, data: updated as MgdReturn }
}
