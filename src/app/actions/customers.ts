'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath, revalidateTag } from 'next/cache'
import { logAuditEvent } from './audit'
import { customerSchema } from '@/lib/validation'
import { checkUserPermission } from './rbac'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { CustomerService } from '@/services/customers'
import type { CreateCustomerInput } from '@/types/customers'
import type { Customer } from '@/types/database'
import { getBulkCustomerLabels } from './customer-labels-bulk'
import { getUnreadMessageCounts } from './messageActions'
import type { CustomerLabelAssignment } from './customer-labels'
import { sendBulkSms } from '@/lib/sms/bulk'

// ---------------------------------------------------------------------------
// Customer list query types
// ---------------------------------------------------------------------------

export interface CustomerCategoryStats {
  customer_id: string
  category_id: string
  times_attended: number
  last_attended_date: string
  event_categories: {
    id: string
    name: string
  }
}

type CustomerCategoryStatsQueryRow = {
  customer_id: string
  category_id: string
  times_attended: number
  last_attended_date: string
  event_categories: { id: string; name: string } | { id: string; name: string }[]
}

export interface CustomerListResult {
  customers: Customer[]
  totalCount: number
  customerPreferences: Record<string, CustomerCategoryStats[]>
  customerLabels: Record<string, CustomerLabelAssignment[]>
  unreadCounts: Record<string, number>
  error?: string
}

const CUSTOMER_LIST_SELECT =
  'id, first_name, last_name, mobile_number, email, sms_opt_in, created_at'

/**
 * Server-side customer list fetch with enrichment data (preferences, labels,
 * unread message counts).  Used by the Customers page Server Component to
 * provide data for the initial render — no skeleton flash on first visit.
 */
export async function getCustomerList(params: {
  page: number
  pageSize: number
  searchTerm: string
  showDeactivated: boolean
}): Promise<CustomerListResult> {
  const { page, pageSize, searchTerm, showDeactivated } = params

  const supabase = await createClient()

  // Build the base query for counting
  let countQuery = supabase
    .from('customers')
    .select('id', { count: 'estimated', head: true })

  // Build the data query
  let dataQuery = supabase
    .from('customers')
    .select(CUSTOMER_LIST_SELECT)
    .order('first_name', { ascending: true })

  // Apply SMS filter
  if (showDeactivated) {
    countQuery = countQuery.eq('sms_opt_in', false)
    dataQuery = dataQuery.eq('sms_opt_in', false)
  } else {
    countQuery = countQuery.or('sms_opt_in.is.null,sms_opt_in.eq.true')
    dataQuery = dataQuery.or('sms_opt_in.is.null,sms_opt_in.eq.true')
  }

  // Apply search filter across name, phone, and email
  if (searchTerm.trim()) {
    const term = `%${searchTerm.trim()}%`
    const searchFilter = `first_name.ilike.${term},last_name.ilike.${term},mobile_number.ilike.${term},email.ilike.${term}`
    countQuery = countQuery.or(searchFilter)
    dataQuery = dataQuery.or(searchFilter)
  }

  // Apply pagination
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  dataQuery = dataQuery.range(from, to)

  // Run count and data in parallel
  const [{ count, error: countError }, { data: rows, error: dataError }] =
    await Promise.all([countQuery, dataQuery])

  if (countError || dataError) {
    console.error('Error fetching customer list:', countError ?? dataError)
    return {
      customers: [],
      totalCount: 0,
      customerPreferences: {},
      customerLabels: {},
      unreadCounts: {},
      error: 'Failed to load customers'
    }
  }

  const customers = (rows ?? []) as Customer[]
  const totalCount = count ?? 0

  if (customers.length === 0) {
    return {
      customers: [],
      totalCount,
      customerPreferences: {},
      customerLabels: {},
      unreadCounts: {}
    }
  }

  // Enrich with preferences, labels, and unread counts in parallel
  const customerIds = customers.map(c => c.id)

  const [statsResult, labelResult, unreadResult] = await Promise.all([
    supabase
      .from('customer_category_stats')
      .select(
        `customer_id, category_id, times_attended, last_attended_date, event_categories!inner(id, name)`
      )
      .in('customer_id', customerIds)
      .order('times_attended', { ascending: false }),
    getBulkCustomerLabels(customerIds),
    getUnreadMessageCounts(customerIds)
  ])

  // Process category stats
  const customerPreferences: Record<string, CustomerCategoryStats[]> = {}
  if (!statsResult.error && statsResult.data) {
    ;(statsResult.data as CustomerCategoryStatsQueryRow[]).forEach(stat => {
      if (!customerPreferences[stat.customer_id]) {
        customerPreferences[stat.customer_id] = []
      }
      customerPreferences[stat.customer_id].push({
        customer_id: stat.customer_id,
        category_id: stat.category_id,
        times_attended: stat.times_attended,
        last_attended_date: stat.last_attended_date,
        event_categories: Array.isArray(stat.event_categories)
          ? stat.event_categories[0]
          : stat.event_categories
      })
    })
  }

  // Process labels
  const customerLabels: Record<string, CustomerLabelAssignment[]> =
    labelResult.assignments ?? {}

  // Process unread counts
  const unreadCounts: Record<string, number> =
    unreadResult && typeof unreadResult === 'object'
      ? (unreadResult as Record<string, number>)
      : {}

  return { customers, totalCount, customerPreferences, customerLabels, unreadCounts }
}

type ManageContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>
      user: SupabaseUser
    }

async function requireCustomerManageContext(): Promise<ManageContext> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'Unauthorized' }
  }

  const canManage = await checkUserPermission('customers', 'manage', user.id)
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  return { supabase, user }
}

export async function createCustomer(formData: FormData) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    const defaultCountryCode =
      (formData.get('default_country_code') as string | null)?.trim() || undefined

    const rawData = {
      first_name: (formData.get('first_name') as string | null)?.trim() || undefined,
      last_name: (formData.get('last_name') as string | null)?.trim() || undefined,
      mobile_number: (formData.get('mobile_number') as string | null)?.trim() || undefined,
      email: (formData.get('email') as string | null)?.trim() || undefined,
      sms_opt_in: formData.get('sms_opt_in') === 'on'
    }

    const validationResult = customerSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const customer = await CustomerService.createCustomer({
      ...validationResult.data,
      mobile_number: validationResult.data.mobile_number!, // Schema ensures this if valid
      default_country_code: defaultCountryCode
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'create',
      resource_type: 'customer',
      resource_id: customer.id,
      operation_status: 'success',
      new_values: customer
    })

    revalidatePath('/customers')
    revalidateTag('dashboard')
    return { success: true, data: customer }
  } catch (error) {
    console.error('Unexpected error creating customer:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}

export async function updateCustomer(id: string, formData: FormData) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    const defaultCountryCode =
      (formData.get('default_country_code') as string | null)?.trim() || undefined

    const rawData = {
      first_name: (formData.get('first_name') as string | null)?.trim() || undefined,
      last_name: (formData.get('last_name') as string | null)?.trim() || undefined,
      mobile_number: (formData.get('mobile_number') as string | null)?.trim() || undefined,
      email: (formData.get('email') as string | null)?.trim() || undefined,
      sms_opt_in: formData.get('sms_opt_in') === 'on'
    }

    const validationResult = customerSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const customer = await CustomerService.updateCustomer(id, {
      ...validationResult.data,
      mobile_number: validationResult.data.mobile_number!,
      default_country_code: defaultCountryCode
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'customer',
      resource_id: id,
      operation_status: 'success',
      new_values: customer
    })

    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    revalidateTag('dashboard')
    return { success: true, data: customer }
  } catch (error) {
    console.error('Unexpected error updating customer:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}

export async function deleteCustomer(id: string) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    const customer = await CustomerService.deleteCustomer(id)

    if (customer) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: 'delete',
        resource_type: 'customer',
        resource_id: id,
        operation_status: 'success',
        old_values: customer
      })
    }

    revalidatePath('/customers')
    revalidateTag('dashboard')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting customer:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}

interface ImportCustomerInput {
  first_name: string
  last_name?: string
  mobile_number: string
  email?: string
}

export async function importCustomers(entries: ImportCustomerInput[]) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    // Map input to Service input (ensure boolean for sms_opt_in)
    const serviceInput: CreateCustomerInput[] = entries.map(e => ({
      first_name: e.first_name,
      last_name: e.last_name,
      mobile_number: e.mobile_number,
      email: e.email,
      sms_opt_in: true
    }))

    const result = await CustomerService.importCustomers(serviceInput)

    if (result.created.length > 0) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: 'bulk_create',
        resource_type: 'customer',
        operation_status: 'success',
        additional_info: {
          total_received: entries.length,
          created: result.created.length,
          skipped_invalid: result.skippedInvalid,
          skipped_duplicate_in_file: result.skippedDuplicates,
          skipped_existing: result.skippedExisting
        }
      })
    }

    revalidatePath('/customers')
    revalidateTag('dashboard')

    return {
      success: true,
      created: result.created.length,
      skippedInvalid: result.skippedInvalid,
      skippedDuplicateInFile: result.skippedDuplicates,
      skippedExisting: result.skippedExisting
    }
  } catch (error) {
    console.error('Unexpected error importing customers:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}

// L3 fix: destructure supabase from context instead of creating a second client with createClient()
export async function updateCustomerNotes(id: string, notes: string) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { supabase, user } = context

    const { error } = await supabase
      .from('customers')
      .update({ internal_notes: notes.trim() || null })
      .eq('id', id)

    if (error) {
      console.error('Error updating customer notes:', error)
      return { error: 'Failed to save notes' }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'customer',
      resource_id: id,
      operation_status: 'success',
    })

    revalidatePath(`/customers/${id}`)
    return { success: true }
  } catch (error) {
    console.error('Unexpected error updating customer notes:', error)
    return { error: 'Failed to save notes' }
  }
}

// ---------------------------------------------------------------------------
// Win-Back Campaign
// ---------------------------------------------------------------------------

export interface WinBackCampaignParams {
  /** Send to customers with no booking in this many months (e.g. 3, 6, 12) */
  inactiveSinceMonths: number
  /** SMS message text. Max 160 characters. */
  message: string
  /** If true, return the count of eligible customers without sending. */
  dryRun?: boolean
}

export interface WinBackCampaignResult {
  success?: boolean
  error?: string
  /** Number of eligible customers (returned by both dryRun and live runs) */
  count?: number
  /** Number of messages actually dispatched (live runs only) */
  sent?: number
  /** Number of messages skipped or suppressed (live runs only) */
  skipped?: number
}

/**
 * Manual bulk-SMS win-back campaign.
 * Finds customers who opted in to SMS, have a mobile number, and whose most
 * recent booking (per `customer_scores.last_booking_date`) is older than
 * `inactiveSinceMonths` months ago. Sends the supplied message via the shared
 * `sendBulkSms` helper so every send passes through the full safety pipeline
 * (opt-in enforcement, quiet hours, rate limits, deduplication).
 *
 * Requires the `customers.manage` permission.
 */
export async function sendWinBackCampaign(
  params: WinBackCampaignParams
): Promise<WinBackCampaignResult> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    const canManage = await checkUserPermission('customers', 'manage', user.id)
    if (!canManage) {
      return { error: 'Insufficient permissions' }
    }

    const { inactiveSinceMonths, message, dryRun = false } = params

    if (
      !Number.isInteger(inactiveSinceMonths) ||
      inactiveSinceMonths < 1 ||
      inactiveSinceMonths > 24
    ) {
      return { error: 'inactiveSinceMonths must be a whole number between 1 and 24' }
    }

    const trimmedMessage = message?.trim()
    if (!trimmedMessage) {
      return { error: 'Message is required' }
    }
    if (trimmedMessage.length > 160) {
      return { error: 'Message must be 160 characters or fewer' }
    }

    // Compute the cutoff date: customers whose last_booking_date is before this date
    // are considered inactive.
    const cutoffDate = new Date()
    cutoffDate.setMonth(cutoffDate.getMonth() - inactiveSinceMonths)
    const cutoffIso = cutoffDate.toISOString().slice(0, 10)

    // Use admin client for the cross-table query so RLS doesn't block the join.
    const admin = createAdminClient()

    // Find customers who:
    //   1. Have sms_opt_in = true
    //   2. Have a non-null mobile_number
    //   3. Have a customer_scores row with last_booking_date older than the cutoff
    //      (or have a score row with null last_booking_date, meaning they have never booked)
    // We join via customer_scores to avoid a slow full-table subquery on private_bookings.
    const { data: scoreRows, error: fetchError } = await admin
      .from('customer_scores')
      .select(
        `
        customer_id,
        last_booking_date,
        customer:customers!inner(
          id,
          first_name,
          mobile_number,
          mobile_e164,
          sms_opt_in
        )
      `
      )
      .or(`last_booking_date.is.null,last_booking_date.lt.${cutoffIso}`)

    if (fetchError) {
      console.error('[WinBackCampaign] Error fetching inactive customers:', fetchError)
      return { error: 'Failed to fetch inactive customers' }
    }

    // Filter to only opted-in customers with a usable phone number
    type ScoreRow = NonNullable<typeof scoreRows>[number]
    type CustomerRelation = { id: string; first_name: string; mobile_number: string | null; mobile_e164: string | null; sms_opt_in: boolean | null }

    const eligible = (scoreRows ?? []).filter((row: ScoreRow) => {
      const customer = Array.isArray(row.customer)
        ? (row.customer[0] as CustomerRelation | undefined)
        : (row.customer as CustomerRelation | undefined)
      if (!customer) return false
      if (customer.sms_opt_in !== true) return false
      const phone = customer.mobile_e164?.trim() || customer.mobile_number?.trim()
      return Boolean(phone)
    })

    const eligibleCount = eligible.length

    if (dryRun) {
      return { success: true, count: eligibleCount }
    }

    if (eligibleCount === 0) {
      return { success: true, count: 0, sent: 0, skipped: 0 }
    }

    const customerIds = eligible.map((row: ScoreRow) => {
      const customer = Array.isArray(row.customer)
        ? (row.customer[0] as CustomerRelation)
        : (row.customer as CustomerRelation)
      return customer.id
    })

    const bulkResult = await sendBulkSms({
      customerIds,
      message: trimmedMessage,
      bulkJobId: `win_back_${cutoffIso}_${Date.now()}`,
    })

    if (!bulkResult.success) {
      console.error('[WinBackCampaign] Bulk SMS failed:', bulkResult.error)
      return { error: bulkResult.error }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'win_back_campaign_sent',
      resource_type: 'customers',
      operation_status: 'success',
      additional_info: {
        inactive_since_months: inactiveSinceMonths,
        cutoff_date: cutoffIso,
        eligible_count: eligibleCount,
        sent: bulkResult.sent,
        failed: bulkResult.failed,
        message_preview: trimmedMessage.slice(0, 80),
      },
    })

    return {
      success: true,
      count: eligibleCount,
      sent: bulkResult.sent,
      skipped: bulkResult.failed,
    }
  } catch (error) {
    console.error('[WinBackCampaign] Unexpected error:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteTestCustomers() {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    const result = await CustomerService.deleteTestCustomers()

    if (result.success && result.deletedCount > 0) {
      // Log the bulk operation
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: 'bulk_delete',
        resource_type: 'customers',
        operation_status: result.failedCount ? 'failure' : 'success',
        additional_info: {
          total_deleted: result.deletedCount,
          failed_count: result.failedCount || 0,
          message: result.message
        }
      })

      // We don't log individual audits here to avoid spamming the log if thousands are deleted,
      // relying on the single bulk audit event.
      // If individual audits were needed, the service could return the list of deleted items to loop over.
    }

    revalidatePath('/customers')
    revalidateTag('dashboard')

    return result
  } catch (error) {
    console.error('Unexpected error deleting test customers:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}
