'use server'

import { revalidatePath } from 'next/cache'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage } from '@/lib/utils'
import { ensureCustomerForPhone } from '@/lib/sms/customers'

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
  sms_status: string | null
  marketing_sms_opt_in: boolean | null
}

type AudienceCustomer = {
  customer_id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  mobile_number: string | null
  mobile_e164: string | null
  display_phone: string | null
  sms_status: string | null
  marketing_sms_opt_in: boolean
  sms_eligible_for_marketing: boolean
  is_currently_booked: boolean
}

export type EventInterestBehaviorCandidate = AudienceCustomer & {
  last_engaged_at: string | null
  manually_added: boolean
}

export type EventInterestManualRecipient = AudienceCustomer & {
  added_at: string
}

export type EventInterestReminderPickerCandidate = AudienceCustomer & {
  last_engaged_at: string | null
  source: 'same_segment' | 'other_events'
  manually_added: boolean
}

export interface EventInterestAudienceData {
  event_id: string
  event_type: string | null
  category_id: string | null
  category_name: string | null
  matching_basis: 'category' | 'event_type' | null
  behavior_candidates: EventInterestBehaviorCandidate[]
  reminder_picker_candidates: EventInterestReminderPickerCandidate[]
  manual_recipients: EventInterestManualRecipient[]
  stats: {
    behavior_total: number
    manual_total: number
    combined_total: number
    currently_booked_total: number
    eligible_now_total: number
    ineligible_now_total: number
  }
}

export interface EventInterestAudienceResult {
  success: boolean
  data?: EventInterestAudienceData
  error?: string
}

export interface EventInterestMutationResult {
  success: boolean
  error?: string
}

function isUndefinedTableError(error: any): boolean {
  return error?.code === '42P01'
}

function chunkArray<T>(input: T[], size = 200): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size))
  }
  return chunks
}

function buildFullName(customer: Pick<CustomerRow, 'first_name' | 'last_name'>): string {
  const parts = [customer.first_name || '', customer.last_name || '']
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown customer'
}

function resolveRelatedEvent(value: any): {
  start_datetime: string | null
  date: string | null
  time: string | null
  event_type: string | null
  category_id: string | null
} {
  const eventRecord = Array.isArray(value) ? value[0] : value
  return {
    start_datetime: typeof eventRecord?.start_datetime === 'string' ? eventRecord.start_datetime : null,
    date: typeof eventRecord?.date === 'string' ? eventRecord.date : null,
    time: typeof eventRecord?.time === 'string' ? eventRecord.time : null,
    event_type: typeof eventRecord?.event_type === 'string' ? eventRecord.event_type : null,
    category_id: typeof eventRecord?.category_id === 'string' ? eventRecord.category_id : null
  }
}

function resolveRelatedEventStartMs(
  value: any
): {
  startMs: number | null
  eventType: string | null
  categoryId: string | null
} {
  const relatedEvent = resolveRelatedEvent(value)

  const startFromDatetime = relatedEvent.start_datetime ? Date.parse(relatedEvent.start_datetime) : Number.NaN
  if (Number.isFinite(startFromDatetime)) {
    return {
      startMs: startFromDatetime,
      eventType: relatedEvent.event_type,
      categoryId: relatedEvent.category_id
    }
  }

  if (relatedEvent.date) {
    const fallbackTime = (relatedEvent.time || '00:00').slice(0, 5)
    const fallbackParsed = Date.parse(`${relatedEvent.date}T${fallbackTime}:00`)
    if (Number.isFinite(fallbackParsed)) {
      return {
        startMs: fallbackParsed,
        eventType: relatedEvent.event_type,
        categoryId: relatedEvent.category_id
      }
    }
  }

  return {
    startMs: null,
    eventType: relatedEvent.event_type,
    categoryId: relatedEvent.category_id
  }
}

function toAudienceCustomer(
  customerId: string,
  customer: CustomerRow,
  isCurrentlyBooked: boolean
): AudienceCustomer {
  const marketingOptIn = customer.marketing_sms_opt_in === true
  const smsEligible = customer.sms_status === 'active' && marketingOptIn

  return {
    customer_id: customerId,
    first_name: customer.first_name,
    last_name: customer.last_name,
    full_name: buildFullName(customer),
    mobile_number: customer.mobile_number,
    mobile_e164: customer.mobile_e164,
    display_phone: customer.mobile_e164 || customer.mobile_number || null,
    sms_status: customer.sms_status,
    marketing_sms_opt_in: marketingOptIn,
    sms_eligible_for_marketing: smsEligible,
    is_currently_booked: isCurrentlyBooked
  }
}

async function loadCustomersById(
  customerIds: string[]
): Promise<Map<string, CustomerRow>> {
  const admin = createAdminClient()
  const map = new Map<string, CustomerRow>()

  for (const idChunk of chunkArray(customerIds)) {
    const { data, error } = await admin
      .from('customers')
      .select('id, first_name, last_name, mobile_number, mobile_e164, sms_status, marketing_sms_opt_in')
      .in('id', idChunk)

    if (error) {
      throw new Error(error.message)
    }

    for (const row of (data || []) as CustomerRow[]) {
      map.set(row.id, row)
    }
  }

  return map
}

export async function getEventInterestAudience(eventId: string): Promise<EventInterestAudienceResult> {
  try {
    const canViewEvents = await checkUserPermission('events', 'view')
    if (!canViewEvents) {
      return { success: false, error: 'Insufficient permissions to view event audience' }
    }

    const admin = createAdminClient()

    const { data: event, error: eventError } = await admin
      .from('events')
      .select('id, event_type, category_id, category:event_categories(name)')
      .eq('id', eventId)
      .maybeSingle()

    if (eventError) {
      return { success: false, error: eventError.message }
    }

    if (!event?.id) {
      return { success: false, error: 'Event not found' }
    }

    const [existingBookings, pastBookings, pastWaitlist] = await Promise.all([
      admin
        .from('bookings')
        .select('customer_id')
        .eq('event_id', eventId)
        .in('status', ['confirmed', 'pending_payment'])
        .not('customer_id', 'is', null),
      admin
        .from('bookings')
        .select('customer_id, event:events!inner(start_datetime, date, time, event_type, category_id)')
        .in('status', ['confirmed'])
        .not('customer_id', 'is', null),
      admin
        .from('waitlist_entries')
        .select('customer_id, event:events!inner(start_datetime, date, time, event_type, category_id)')
        .not('customer_id', 'is', null)
    ])

    if (existingBookings.error) {
      return { success: false, error: existingBookings.error.message }
    }
    if (pastBookings.error) {
      return { success: false, error: pastBookings.error.message }
    }
    if (pastWaitlist.error) {
      return { success: false, error: pastWaitlist.error.message }
    }

    let manualRowsData: Array<{ customer_id: string | null; created_at: string }> = []
    const manualRows = await (admin.from('event_interest_manual_recipients') as any)
      .select('customer_id, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })

    if (manualRows.error) {
      if (!isUndefinedTableError(manualRows.error)) {
        return { success: false, error: manualRows.error.message }
      }

      const fallbackManualRows = await admin
        .from('bookings')
        .select('customer_id, created_at')
        .eq('event_id', eventId)
        .eq('is_reminder_only', true)
        .in('status', ['confirmed', 'pending_payment'])
        .not('customer_id', 'is', null)
        .order('created_at', { ascending: false })

      if (fallbackManualRows.error) {
        return { success: false, error: fallbackManualRows.error.message }
      }

      manualRowsData = (fallbackManualRows.data || []) as Array<{ customer_id: string | null; created_at: string }>
    } else {
      manualRowsData = (manualRows.data || []) as Array<{ customer_id: string | null; created_at: string }>
    }

    const eventCategory = Array.isArray((event as any).category) ? (event as any).category[0] : (event as any).category
    const eventCategoryId =
      typeof (event as any).category_id === 'string' && (event as any).category_id.trim().length > 0
        ? (event as any).category_id
        : null
    const eventCategoryName = typeof eventCategory?.name === 'string' ? eventCategory.name : null
    const eventType = typeof event.event_type === 'string' && event.event_type.trim().length > 0 ? event.event_type : null
    const matchingBasis: 'category' | 'event_type' | null = eventCategoryId ? 'category' : eventType ? 'event_type' : null

    const nowMs = Date.now()
    const lastEngagedAtSameSegmentByCustomer = new Map<string, number>()
    const lastEngagedAtAnyPastEventByCustomer = new Map<string, number>()

    for (const row of [...((pastBookings.data || []) as any[]), ...((pastWaitlist.data || []) as any[])]) {
      const customerId = row?.customer_id
      const relatedEvent = resolveRelatedEventStartMs(row?.event)
      if (typeof customerId !== 'string' || typeof relatedEvent.startMs !== 'number') continue
      if (relatedEvent.startMs >= nowMs) continue

      const currentAny = lastEngagedAtAnyPastEventByCustomer.get(customerId)
      if (!currentAny || relatedEvent.startMs > currentAny) {
        lastEngagedAtAnyPastEventByCustomer.set(customerId, relatedEvent.startMs)
      }

      const isSameSegment =
        matchingBasis === 'category'
          ? Boolean(eventCategoryId) && relatedEvent.categoryId === eventCategoryId
          : matchingBasis === 'event_type'
            ? Boolean(eventType) && relatedEvent.eventType === eventType
            : false
      if (!isSameSegment) continue

      const currentSameSegment = lastEngagedAtSameSegmentByCustomer.get(customerId)
      if (!currentSameSegment || relatedEvent.startMs > currentSameSegment) {
        lastEngagedAtSameSegmentByCustomer.set(customerId, relatedEvent.startMs)
      }
    }

    const behaviorCustomerIds = new Set(lastEngagedAtSameSegmentByCustomer.keys())
    const reminderPickerCustomerIds = new Set(lastEngagedAtAnyPastEventByCustomer.keys())
    const manualCustomerIds = new Set(
      manualRowsData.map((row) => row.customer_id).filter((id): id is string => typeof id === 'string')
    )

    const currentlyBookedIds = new Set(
      ((existingBookings.data || []) as Array<{ customer_id: string | null }>)
        .map((row) => row.customer_id)
        .filter((id): id is string => typeof id === 'string')
    )

    const combinedIds = new Set<string>([
      ...Array.from(behaviorCustomerIds),
      ...Array.from(manualCustomerIds)
    ])

    const allAudienceCustomerIds = new Set<string>([
      ...Array.from(combinedIds),
      ...Array.from(reminderPickerCustomerIds)
    ])

    const customersById = await loadCustomersById(Array.from(allAudienceCustomerIds))

    const manualRecipients: EventInterestManualRecipient[] = []
    for (const row of manualRowsData) {
      const customerId = row.customer_id
      if (typeof customerId !== 'string') continue

      const customer = customersById.get(customerId)
      if (!customer) continue

      manualRecipients.push({
        ...toAudienceCustomer(customerId, customer, currentlyBookedIds.has(customerId)),
        added_at: row.created_at
      })
    }

    const behaviorCandidates: EventInterestBehaviorCandidate[] = []
    for (const customerId of behaviorCustomerIds) {
      const customer = customersById.get(customerId)
      if (!customer) continue

      const lastEngagedAtMs = lastEngagedAtSameSegmentByCustomer.get(customerId)
      behaviorCandidates.push({
        ...toAudienceCustomer(customerId, customer, currentlyBookedIds.has(customerId)),
        last_engaged_at: typeof lastEngagedAtMs === 'number' ? new Date(lastEngagedAtMs).toISOString() : null,
        manually_added: manualCustomerIds.has(customerId)
      })
    }

    behaviorCandidates.sort((left, right) => {
      if (left.manually_added !== right.manually_added) {
        return left.manually_added ? -1 : 1
      }

      const leftMs = left.last_engaged_at ? Date.parse(left.last_engaged_at) : 0
      const rightMs = right.last_engaged_at ? Date.parse(right.last_engaged_at) : 0
      if (leftMs !== rightMs) {
        return rightMs - leftMs
      }

      return left.full_name.localeCompare(right.full_name)
    })

    const reminderPickerCandidates: EventInterestReminderPickerCandidate[] = []
    for (const customerId of reminderPickerCustomerIds) {
      const customer = customersById.get(customerId)
      if (!customer) continue

      const lastEngagedAtMs = lastEngagedAtAnyPastEventByCustomer.get(customerId)
      reminderPickerCandidates.push({
        ...toAudienceCustomer(customerId, customer, currentlyBookedIds.has(customerId)),
        last_engaged_at: typeof lastEngagedAtMs === 'number' ? new Date(lastEngagedAtMs).toISOString() : null,
        source: behaviorCustomerIds.has(customerId) ? 'same_segment' : 'other_events',
        manually_added: manualCustomerIds.has(customerId)
      })
    }

    reminderPickerCandidates.sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === 'same_segment' ? -1 : 1
      }
      if (left.is_currently_booked !== right.is_currently_booked) {
        return left.is_currently_booked ? 1 : -1
      }
      if (left.manually_added !== right.manually_added) {
        return left.manually_added ? 1 : -1
      }

      const leftMs = left.last_engaged_at ? Date.parse(left.last_engaged_at) : 0
      const rightMs = right.last_engaged_at ? Date.parse(right.last_engaged_at) : 0
      if (leftMs !== rightMs) {
        return rightMs - leftMs
      }

      return left.full_name.localeCompare(right.full_name)
    })

    const combinedCustomers = Array.from(combinedIds)
      .map((customerId) => customersById.get(customerId))
      .filter((customer): customer is CustomerRow => Boolean(customer))

    const currentlyBookedTotal = Array.from(combinedIds).filter((customerId) => currentlyBookedIds.has(customerId)).length
    const eligibleNowTotal = Array.from(combinedIds).filter((customerId) => {
      const customer = customersById.get(customerId)
      if (!customer) return false
      if (currentlyBookedIds.has(customerId)) return false
      return customer.sms_status === 'active' && customer.marketing_sms_opt_in === true
    }).length

    return {
      success: true,
      data: {
        event_id: event.id,
        event_type: eventType,
        category_id: eventCategoryId,
        category_name: eventCategoryName,
        matching_basis: matchingBasis,
        behavior_candidates: behaviorCandidates,
        reminder_picker_candidates: reminderPickerCandidates,
        manual_recipients: manualRecipients,
        stats: {
          behavior_total: behaviorCandidates.length,
          manual_total: manualRecipients.length,
          combined_total: combinedCustomers.length,
          currently_booked_total: currentlyBookedTotal,
          eligible_now_total: eligibleNowTotal,
          ineligible_now_total: Math.max(combinedCustomers.length - eligibleNowTotal - currentlyBookedTotal, 0)
        }
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to load event interest audience'
    }
  }
}

export async function addEventInterestManualRecipient(
  eventId: string,
  customerId: string
): Promise<EventInterestMutationResult> {
  return addEventInterestManualRecipients(eventId, [customerId])
}

export async function addEventInterestManualRecipients(
  eventId: string,
  customerIds: string[]
): Promise<EventInterestMutationResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { success: false, error: 'Insufficient permissions to manage event audience' }
    }

    const uniqueCustomerIds = Array.from(
      new Set(
        customerIds
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0)
      )
    ).slice(0, 300)

    if (uniqueCustomerIds.length === 0) {
      return { success: false, error: 'No guests selected.' }
    }

    const admin = createAdminClient()
    const manualInsert = await (admin.from('event_interest_manual_recipients') as any)
      .upsert(
        uniqueCustomerIds.map((customerId) => ({
          event_id: eventId,
          customer_id: customerId
        })),
        {
          onConflict: 'event_id,customer_id',
          ignoreDuplicates: true
        }
      )

    if (manualInsert.error) {
      if (!isUndefinedTableError(manualInsert.error)) {
        return { success: false, error: manualInsert.error.message }
      }

      const { data: existingReminderRows, error: existingReminderError } = await admin
        .from('bookings')
        .select('customer_id')
        .eq('event_id', eventId)
        .eq('is_reminder_only', true)
        .in('status', ['confirmed', 'pending_payment'])
        .in('customer_id', uniqueCustomerIds)

      if (existingReminderError) {
        return { success: false, error: existingReminderError.message }
      }

      const existingReminderIds = new Set(
        ((existingReminderRows || []) as Array<{ customer_id: string | null }>)
          .map((row) => row.customer_id)
          .filter((id): id is string => typeof id === 'string')
      )

      const missingCustomerIds = uniqueCustomerIds.filter((customerId) => !existingReminderIds.has(customerId))

      if (missingCustomerIds.length > 0) {
        const { error: fallbackInsertError } = await (admin.from('bookings') as any)
          .insert(
            missingCustomerIds.map((customerId) => ({
              event_id: eventId,
              customer_id: customerId,
              seats: 0,
              is_reminder_only: true,
              status: 'confirmed',
              source: 'manual_interest'
            }))
          )

        if (fallbackInsertError) {
          return { success: false, error: fallbackInsertError.message }
        }
      }
    }

    revalidatePath(`/events/${eventId}`)
    return { success: true }
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to add manual recipient'
    }
  }
}

export async function addEventInterestManualRecipientByPhone(
  eventId: string,
  input: {
    phone: string
    defaultCountryCode?: string
    firstName?: string
    lastName?: string
  }
): Promise<EventInterestMutationResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { success: false, error: 'Insufficient permissions to manage event audience' }
    }

    const normalizedPhone = formatPhoneForStorage(input.phone || '', {
      defaultCountryCode: input.defaultCountryCode
    })

    const admin = createAdminClient()
    const customerResolution = await ensureCustomerForPhone(admin, normalizedPhone, {
      firstName: input.firstName,
      lastName: input.lastName
    })

    if (!customerResolution.customerId) {
      return { success: false, error: 'Could not resolve customer from phone number.' }
    }

    return addEventInterestManualRecipients(eventId, [customerResolution.customerId])
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Please enter a valid phone number.'
    }
  }
}

export async function removeEventInterestManualRecipient(
  eventId: string,
  customerId: string
): Promise<EventInterestMutationResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { success: false, error: 'Insufficient permissions to manage event audience' }
    }

    const admin = createAdminClient()
    const manualDelete = await (admin.from('event_interest_manual_recipients') as any)
      .delete()
      .eq('event_id', eventId)
      .eq('customer_id', customerId)

    if (manualDelete.error) {
      if (!isUndefinedTableError(manualDelete.error)) {
        return { success: false, error: manualDelete.error.message }
      }

      const { error: fallbackDeleteError } = await (admin.from('bookings') as any)
        .delete()
        .eq('event_id', eventId)
        .eq('customer_id', customerId)
        .eq('is_reminder_only', true)

      if (fallbackDeleteError) {
        return { success: false, error: fallbackDeleteError.message }
      }
    }

    revalidatePath(`/events/${eventId}`)
    return { success: true }
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Failed to remove manual recipient'
    }
  }
}
