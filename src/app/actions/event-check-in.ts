'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { z } from 'zod'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { ensureCustomerForPhone } from '@/lib/sms/customers'
import { getGoogleReviewLink } from '@/lib/events/review-link'
import { jobQueue } from '@/lib/unified-job-queue'
import { logger } from '@/lib/logger'

const LONDON_TZ = 'Europe/London'
const ACTIVE_BOOKING_STATUSES = ['pending_payment', 'confirmed']

const lookupSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().trim().min(3, 'Enter a phone number'),
})

const registerKnownSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().trim().min(3),
  customerId: z.string().uuid(),
})

const registerNewSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().trim().min(3),
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
})

type EventForCheckIn = {
  id: string
  name: string
  date: string
  time: string
  category_id: string | null
  event_type: string | null
  category?: {
    id: string
    name: string
    slug: string | null
    color: string | null
  } | null
}

type CustomerForCheckIn = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
  mobile_e164: string | null
  email: string | null
}

type EventCategoryForCheckIn = {
  id: string
  name: string
  slug: string | null
  color: string | null
}

export type KnownEventGuest = {
  customer: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    email: string | null
  }
  booking?: {
    id: string
    seats: number | null
    status: string | null
  }
  alreadyCheckedIn: boolean
  attendance?: EventCategoryAttendanceSummary
}

export type EventCategoryAttendanceSummary = {
  categoryId: string | null
  categoryName: string
  categorySlug: string | null
  previousAttendanceCount: number
  isCashBingo: boolean
  snowball: {
    eligible: boolean
    tracked: boolean
    checkedLastThreeCount: number
    requiredCount: 3
  } | null
}

export type EventGuestLookupResult =
  | { success: true; status: 'known'; data: KnownEventGuest; normalizedPhone: string }
  | { success: true; status: 'unknown'; normalizedPhone: string }
  | { success: false; error: string }

export type EventGuestRegisterResult =
  | {
      success: true
      data: {
        customerId: string
        bookingId: string
        checkInId: string
        customerName: string
        attendance: EventCategoryAttendanceSummary
      }
    }
  | { success: false; error: string }

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function displayCustomerName(customer: Pick<CustomerForCheckIn, 'first_name' | 'last_name'>): string {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || 'there'
}

function normalizeCategoryText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function titleFromCategoryKey(value: string | null | undefined): string {
  const normalized = normalizeCategoryText(value)
  if (!normalized) return 'this category'
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isCashBingoEvent(event: EventForCheckIn): boolean {
  const candidates = [
    event.category?.slug,
    event.event_type,
    event.category?.name,
    event.name,
  ].map(normalizeCategoryText)

  return candidates.some((candidate) => candidate === 'cash bingo' || candidate.includes('cash bingo'))
}

function getCategoryName(event: EventForCheckIn): string {
  return event.category?.name || titleFromCategoryKey(event.event_type) || 'this category'
}

function normalizePhone(rawPhone: string): string | null {
  try {
    return formatPhoneForStorage(rawPhone, { defaultCountryCode: '44' })
  } catch {
    return null
  }
}

async function requireEventManager(eventId: string): Promise<
  | { ok: true; userId: string; userEmail: string | null; event: EventForCheckIn }
  | { ok: false; error: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, error: 'You must be signed in to check in guests.' }
  }

  const canManage = await checkUserPermission('events', 'manage', user.id)
  if (!canManage) {
    return { ok: false, error: 'You do not have permission to manage event check-ins.' }
  }

  const admin = createAdminClient()
  const { data: event, error } = await admin
    .from('events')
    .select('id, name, date, time, category_id, event_type, category:event_categories(id, name, slug, color)')
    .eq('id', eventId)
    .maybeSingle()

  if (error) {
    logger.error('Failed to load event for check-in', {
      error: new Error(error.message),
      metadata: { eventId },
    })
    return { ok: false, error: 'Failed to load event.' }
  }

  if (!event) {
    return { ok: false, error: 'Event not found.' }
  }

  return {
    ok: true,
    userId: user.id,
    userEmail: user.email ?? null,
    event: {
      ...event,
      category: Array.isArray(event.category) ? event.category[0] : event.category,
    },
  }
}

async function findCustomerByPhone(rawPhone: string, normalizedPhone: string): Promise<{
  customer: CustomerForCheckIn | null
  error?: string
}> {
  const admin = createAdminClient()
  const variants = Array.from(new Set([
    ...generatePhoneVariants(rawPhone, { defaultCountryCode: '44' }),
    ...generatePhoneVariants(normalizedPhone, { defaultCountryCode: '44' }),
  ]))

  const { data: canonicalMatches, error: canonicalError } = await admin
    .from('customers')
    .select('id, first_name, last_name, mobile_number, mobile_e164, email')
    .eq('mobile_e164', normalizedPhone)
    .order('created_at', { ascending: true })
    .limit(1)

  if (canonicalError) {
    logger.error('Failed to look up check-in customer by mobile_e164', {
      error: new Error(canonicalError.message),
    })
    return { customer: null, error: 'Failed to look up guest.' }
  }

  if (canonicalMatches?.[0]) {
    return { customer: canonicalMatches[0] as CustomerForCheckIn }
  }

  const { data: legacyMatches, error: legacyError } = await admin
    .from('customers')
    .select('id, first_name, last_name, mobile_number, mobile_e164, email')
    .in('mobile_number', variants.length > 0 ? variants : [normalizedPhone])
    .order('created_at', { ascending: true })
    .limit(1)

  if (legacyError) {
    logger.error('Failed to look up check-in customer by mobile_number', {
      error: new Error(legacyError.message),
    })
    return { customer: null, error: 'Failed to look up guest.' }
  }

  return { customer: (legacyMatches?.[0] as CustomerForCheckIn | undefined) ?? null }
}

async function getActiveBooking(eventId: string, customerId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('bookings')
    .select('id, seats, status')
    .eq('event_id', eventId)
    .eq('customer_id', customerId)
    .in('status', ACTIVE_BOOKING_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    logger.error('Failed to load active booking for event check-in', {
      error: new Error(error.message),
      metadata: { eventId, customerId },
    })
    return { booking: null, error: 'Failed to load guest booking.' }
  }

  return { booking: data ?? null }
}

async function hasCheckIn(eventId: string, customerId: string): Promise<{ checkedIn: boolean; error?: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('event_check_ins')
    .select('id')
    .eq('event_id', eventId)
    .eq('customer_id', customerId)
    .maybeSingle()

  if (error) {
    logger.error('Failed to load check-in status', {
      error: new Error(error.message),
      metadata: { eventId, customerId },
    })
    return { checkedIn: false, error: 'Failed to load check-in status.' }
  }

  return { checkedIn: Boolean(data) }
}

async function ensureBooking(eventId: string, customerId: string): Promise<
  | { ok: true; bookingId: string }
  | { ok: false; error: string }
> {
  const active = await getActiveBooking(eventId, customerId)
  if (active.error) {
    return { ok: false, error: active.error }
  }

  if (active.booking?.id) {
    return { ok: true, bookingId: active.booking.id }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('bookings')
    .insert({
      event_id: eventId,
      customer_id: customerId,
      seats: 1,
      status: 'confirmed',
      source: 'admin',
      booking_source: 'bulk_add',
      notes: 'Created via event check-in',
    })
    .select('id')
    .single()

  if (error) {
    logger.error('Failed to create event check-in booking', {
      error: new Error(error.message),
      metadata: { eventId, customerId },
    })
    return { ok: false, error: 'Failed to create booking for guest.' }
  }

  return { ok: true, bookingId: data.id }
}

async function ensureEventLabels() {
  const admin = createAdminClient()
  const requiredLabels = [
    {
      name: 'Event Booker',
      description: 'Customers who have booked at least one event.',
      color: '#2563EB',
      icon: 'calendar-days',
      notes: 'Auto-applied via event check-in',
    },
    {
      name: 'Event Attendee',
      description: 'Customers who have attended an event at The Anchor.',
      color: '#16A34A',
      icon: 'user-group',
      notes: 'Auto-applied via event check-in',
    },
    {
      name: 'Event Checked-In',
      description: 'Guests who have checked in for an event at The Anchor.',
      color: '#0F766E',
      icon: 'badge-check',
      notes: 'Checked in via event check-in flow',
    },
  ]

  const labelNames = requiredLabels.map((label) => label.name)
  const { data: existingLabels, error: loadError } = await admin
    .from('customer_labels')
    .select('id, name')
    .in('name', labelNames)

  if (loadError) {
    logger.warn('Failed to load event check-in labels', {
      metadata: { error: loadError.message },
    })
    return []
  }

  const labelMap = new Map((existingLabels ?? []).map((label) => [label.name, label.id]))
  const missing = requiredLabels.filter((label) => !labelMap.has(label.name))

  if (missing.length > 0) {
    const { data: insertedLabels, error: insertError } = await admin
      .from('customer_labels')
      .insert(missing.map(({ notes: _notes, ...label }) => ({
        ...label,
        auto_apply_rules: {},
      })))
      .select('id, name')

    if (insertError) {
      logger.warn('Failed to create event check-in labels', {
        metadata: { error: insertError.message },
      })
    } else {
      for (const label of insertedLabels ?? []) {
        labelMap.set(label.name, label.id)
      }
    }
  }

  return requiredLabels
    .map((label) => {
      const id = labelMap.get(label.name)
      return id ? { id, notes: label.notes } : null
    })
    .filter((label): label is { id: string; notes: string } => Boolean(label))
}

async function assignLabels(customerId: string, assignedBy: string) {
  const labels = await ensureEventLabels()
  if (labels.length === 0) return

  const admin = createAdminClient()
  const { error } = await admin
    .from('customer_label_assignments')
    .upsert(
      labels.map((label) => ({
        customer_id: customerId,
        label_id: label.id,
        auto_assigned: true,
        assigned_by: assignedBy,
        notes: label.notes,
      })),
      { onConflict: 'customer_id,label_id' }
    )

  if (error) {
    logger.warn('Failed to assign event check-in labels', {
      metadata: { error: error.message, customerId },
    })
  }
}

async function trackSnowballEligibility(input: {
  customerId: string
  assignedBy: string
  event: EventForCheckIn
}): Promise<boolean> {
  const admin = createAdminClient()
  const labelName = 'Cash Bingo Snowball Eligible'
  const { data: existingLabel, error: loadError } = await admin
    .from('customer_labels')
    .select('id')
    .eq('name', labelName)
    .maybeSingle()

  if (loadError) {
    logger.warn('Failed to load snowball eligibility label', {
      metadata: { error: loadError.message },
    })
    return false
  }

  let labelId = existingLabel?.id

  if (!labelId) {
    const { data: insertedLabel, error: insertError } = await admin
      .from('customer_labels')
      .insert({
        name: labelName,
        description: 'Customers eligible for the cash bingo snowball after attending the previous three cash bingo events.',
        color: '#F59E0B',
        icon: 'trophy',
        auto_apply_rules: {},
      })
      .select('id')
      .single()

    if (insertError) {
      logger.warn('Failed to create snowball eligibility label', {
        metadata: { error: insertError.message },
      })
      return false
    }

    labelId = insertedLabel.id
  }

  const { error } = await admin
    .from('customer_label_assignments')
    .upsert({
      customer_id: input.customerId,
      label_id: labelId,
      auto_assigned: true,
      assigned_by: input.assignedBy,
      notes: `Snowball eligible at ${input.event.name} on ${input.event.date}; attended the previous three cash bingo events.`,
    }, { onConflict: 'customer_id,label_id' })

  if (error) {
    logger.warn('Failed to assign snowball eligibility label', {
      metadata: { error: error.message, customerId: input.customerId, eventId: input.event.id },
    })
    return false
  }

  return true
}

async function clearSnowballEligibility(customerId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: existingLabel, error: loadError } = await admin
    .from('customer_labels')
    .select('id')
    .eq('name', 'Cash Bingo Snowball Eligible')
    .maybeSingle()

  if (loadError || !existingLabel?.id) {
    if (loadError) {
      logger.warn('Failed to load snowball eligibility label for cleanup', {
        metadata: { error: loadError.message, customerId },
      })
    }
    return
  }

  const { error } = await admin
    .from('customer_label_assignments')
    .delete()
    .eq('customer_id', customerId)
    .eq('label_id', existingLabel.id)

  if (error) {
    logger.warn('Failed to clear stale snowball eligibility label', {
      metadata: { error: error.message, customerId },
    })
  }
}

type PreviousCategoryEvent = {
  id: string
  name: string
  date: string
  time: string
  event_status: string | null
  category_id: string | null
  event_type: string | null
  category?: EventCategoryForCheckIn | EventCategoryForCheckIn[] | null
}

type NormalizedPreviousCategoryEvent = Omit<PreviousCategoryEvent, 'category'> & {
  category?: EventCategoryForCheckIn | null
}

function eventHappenedBeforeCurrent(event: Pick<PreviousCategoryEvent, 'date' | 'time'>, current: EventForCheckIn): boolean {
  if (event.date < current.date) return true
  if (event.date > current.date) return false
  return event.time < current.time
}

function eventCategoryMatchesCurrent(event: NormalizedPreviousCategoryEvent, current: EventForCheckIn): boolean {
  if (current.category_id) {
    return event.category_id === current.category_id
  }

  const currentKey = normalizeCategoryText(current.event_type || current.category?.slug || current.category?.name || current.name)
  if (!currentKey) return false

  return [
    event.event_type,
    event.category?.slug,
    event.category?.name,
    event.name,
  ].some((candidate) => normalizeCategoryText(candidate) === currentKey)
}

async function getEventCategoryAttendanceSummary(input: {
  event: EventForCheckIn
  customerId: string
  assignedBy?: string
}): Promise<EventCategoryAttendanceSummary> {
  const admin = createAdminClient()
  const categoryName = getCategoryName(input.event)
  const isCashBingo = isCashBingoEvent(input.event)
  const nonAttendanceStatuses = new Set(['cancelled', 'postponed', 'rescheduled'])

  let eventsQuery = admin
    .from('events')
    .select('id, name, date, time, event_status, category_id, event_type, category:event_categories(id, name, slug, color)')
    .neq('id', input.event.id)
    .lte('date', input.event.date)
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .limit(input.event.category_id ? 100 : 300)

  if (input.event.category_id) {
    eventsQuery = eventsQuery.eq('category_id', input.event.category_id)
  }

  const { data: previousRows, error: previousError } = await eventsQuery

  if (previousError) {
    logger.warn('Failed to load previous category events for check-in attendance', {
      metadata: { error: previousError.message, eventId: input.event.id, customerId: input.customerId },
    })
    return {
      categoryId: input.event.category_id,
      categoryName,
      categorySlug: input.event.category?.slug ?? input.event.event_type,
      previousAttendanceCount: 0,
      isCashBingo,
      snowball: isCashBingo
        ? { eligible: false, tracked: false, checkedLastThreeCount: 0, requiredCount: 3 }
        : null,
    }
  }

  const previousEvents: NormalizedPreviousCategoryEvent[] = ((previousRows ?? []) as PreviousCategoryEvent[])
    .map((event) => ({
      ...event,
      category: Array.isArray(event.category) ? event.category[0] : event.category,
    }))
    .filter((event) => eventHappenedBeforeCurrent(event, input.event))
    .filter((event) => eventCategoryMatchesCurrent(event, input.event))
    .filter((event) => !nonAttendanceStatuses.has((event.event_status ?? '').toLowerCase()))

  const previousEventIds = previousEvents.map((event) => event.id)
  let checkedEventIds = new Set<string>()

  if (previousEventIds.length > 0) {
    const { data: checkIns, error: checkInsError } = await admin
      .from('event_check_ins')
      .select('event_id')
      .eq('customer_id', input.customerId)
      .in('event_id', previousEventIds)

    if (checkInsError) {
      logger.warn('Failed to load previous category check-ins for customer', {
        metadata: { error: checkInsError.message, eventId: input.event.id, customerId: input.customerId },
      })
    } else {
      checkedEventIds = new Set(
        (checkIns ?? [])
          .map((checkIn) => checkIn.event_id)
          .filter((eventId): eventId is string => typeof eventId === 'string')
      )
    }
  }

  const previousAttendanceCount = previousEvents.filter((event) => checkedEventIds.has(event.id)).length
  const lastThree = previousEvents.slice(0, 3)
  const checkedLastThreeCount = lastThree.filter((event) => checkedEventIds.has(event.id)).length
  const snowballEligible = isCashBingo && lastThree.length === 3 && checkedLastThreeCount === 3
  const tracked = snowballEligible && input.assignedBy
    ? await trackSnowballEligibility({
        customerId: input.customerId,
        assignedBy: input.assignedBy,
        event: input.event,
      })
    : false

  if (isCashBingo && !snowballEligible && input.assignedBy) {
    await clearSnowballEligibility(input.customerId)
  }

  return {
    categoryId: input.event.category_id,
    categoryName,
    categorySlug: input.event.category?.slug ?? input.event.event_type,
    previousAttendanceCount,
    isCashBingo,
    snowball: isCashBingo
      ? {
          eligible: snowballEligible,
          tracked,
          checkedLastThreeCount,
          requiredCount: 3,
        }
      : null,
  }
}

function buildThankYouDelayMs(event: EventForCheckIn): number {
  const eventDateTime = fromZonedTime(`${event.date}T${event.time}`, LONDON_TZ)
  const nextDayLondon = toZonedTime(eventDateTime, LONDON_TZ)
  nextDayLondon.setDate(nextDayLondon.getDate() + 1)
  nextDayLondon.setHours(10, 0, 0, 0)
  const scheduledUtc = fromZonedTime(nextDayLondon, LONDON_TZ)
  return Math.max(scheduledUtc.getTime() - Date.now(), 60_000)
}

async function scheduleThankYouSms(input: {
  event: EventForCheckIn
  customerId: string
  phone: string
  checkInId: string
}) {
  try {
    const admin = createAdminClient()
    const reviewLink = await getGoogleReviewLink(admin)
    const message = `Thanks for coming to ${input.event.name} at The Anchor. We'd love your review: ${reviewLink}`

    const result = await jobQueue.enqueue('send_sms', {
      to: input.phone,
      message,
      customerId: input.customerId,
      metadata: {
        event_id: input.event.id,
        event_check_in_id: input.checkInId,
        template_key: 'event_check_in_thank_you',
      },
    }, {
      delay: buildThankYouDelayMs(input.event),
      unique: `event_check_in_thank_you:${input.checkInId}`,
    })

    if (!result.success) {
      logger.warn('Failed to enqueue event check-in thank-you SMS', {
        metadata: { error: result.error, checkInId: input.checkInId },
      })
    }
  } catch (error) {
    logger.warn('Failed to schedule event check-in thank-you SMS', {
      metadata: {
        checkInId: input.checkInId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

async function completeCheckIn(input: {
  event: EventForCheckIn
  userId: string
  userEmail: string | null
  customerId: string
  normalizedPhone: string
  customerName: string
}): Promise<EventGuestRegisterResult> {
  const existingCheckIn = await hasCheckIn(input.event.id, input.customerId)
  if (existingCheckIn.error) {
    return { success: false, error: existingCheckIn.error }
  }

  if (existingCheckIn.checkedIn) {
    return { success: false, error: 'Guest is already checked in for this event.' }
  }

  const ensuredBooking = await ensureBooking(input.event.id, input.customerId)
  if (!ensuredBooking.ok) {
    return { success: false, error: ensuredBooking.error }
  }

  const admin = createAdminClient()
  const { data: checkIn, error: checkInError } = await admin
    .from('event_check_ins')
    .insert({
      event_id: input.event.id,
      customer_id: input.customerId,
      booking_id: ensuredBooking.bookingId,
      check_in_method: 'manual',
      staff_id: input.userId,
    })
    .select('id')
    .single()

  if (checkInError) {
    const alreadyCheckedIn = checkInError.code === '23505'
    logger.error('Failed to record event check-in', {
      error: new Error(checkInError.message),
      metadata: {
        eventId: input.event.id,
        customerId: input.customerId,
        bookingId: ensuredBooking.bookingId,
      },
    })
    return {
      success: false,
      error: alreadyCheckedIn
        ? 'Guest is already checked in for this event.'
        : 'Failed to record check-in.',
    }
  }

  await assignLabels(input.customerId, input.userId)
  const attendance = await getEventCategoryAttendanceSummary({
    event: input.event,
    customerId: input.customerId,
    assignedBy: input.userId,
  })
  await scheduleThankYouSms({
    event: input.event,
    customerId: input.customerId,
    phone: input.normalizedPhone,
    checkInId: checkIn.id,
  })

  await logAuditEvent({
    user_id: input.userId,
    user_email: input.userEmail ?? undefined,
    operation_type: 'create',
    resource_type: 'event_check_in',
    resource_id: checkIn.id,
    operation_status: 'success',
    new_values: {
      event_id: input.event.id,
      customer_id: input.customerId,
      booking_id: ensuredBooking.bookingId,
      previous_category_attendance_count: attendance.previousAttendanceCount,
      category_name: attendance.categoryName,
      cash_bingo_snowball_eligible: attendance.snowball?.eligible ?? false,
      cash_bingo_snowball_tracked: attendance.snowball?.tracked ?? false,
    },
  })

  revalidatePath(`/events/${input.event.id}`)
  revalidatePath(`/events/${input.event.id}/check-in`)
  revalidateTag('dashboard')

  return {
    success: true,
    data: {
      customerId: input.customerId,
      bookingId: ensuredBooking.bookingId,
      checkInId: checkIn.id,
      customerName: input.customerName,
      attendance,
    },
  }
}

export async function lookupEventGuest(input: z.infer<typeof lookupSchema>): Promise<EventGuestLookupResult> {
  const parsed = lookupSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid request.' }
  }

  const access = await requireEventManager(parsed.data.eventId)
  if (!access.ok) {
    return { success: false, error: access.error }
  }

  const normalizedPhone = normalizePhone(parsed.data.phone)
  if (!normalizedPhone) {
    return { success: false, error: 'Please enter a valid mobile number.' }
  }

  const lookup = await findCustomerByPhone(parsed.data.phone, normalizedPhone)
  if (lookup.error) {
    return { success: false, error: lookup.error }
  }

  if (!lookup.customer) {
    return { success: true, status: 'unknown', normalizedPhone }
  }

  const activeBooking = await getActiveBooking(parsed.data.eventId, lookup.customer.id)
  if (activeBooking.error) {
    return { success: false, error: activeBooking.error }
  }

  const checkIn = await hasCheckIn(parsed.data.eventId, lookup.customer.id)
  if (checkIn.error) {
    return { success: false, error: checkIn.error }
  }

  const attendance = checkIn.checkedIn
    ? await getEventCategoryAttendanceSummary({
        event: access.event,
        customerId: lookup.customer.id,
        assignedBy: access.userId,
      })
    : undefined

  return {
    success: true,
    status: 'known',
    normalizedPhone,
    data: {
      customer: {
        id: lookup.customer.id,
        first_name: lookup.customer.first_name,
        last_name: lookup.customer.last_name,
        mobile_number: lookup.customer.mobile_e164 || lookup.customer.mobile_number,
        email: lookup.customer.email,
      },
      booking: activeBooking.booking
        ? {
            id: activeBooking.booking.id,
            seats: activeBooking.booking.seats,
            status: activeBooking.booking.status,
          }
        : undefined,
      alreadyCheckedIn: checkIn.checkedIn,
      attendance,
    },
  }
}

export async function registerKnownGuest(input: z.infer<typeof registerKnownSchema>): Promise<EventGuestRegisterResult> {
  const parsed = registerKnownSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid request.' }
  }

  const access = await requireEventManager(parsed.data.eventId)
  if (!access.ok) {
    return { success: false, error: access.error }
  }

  const normalizedPhone = normalizePhone(parsed.data.phone)
  if (!normalizedPhone) {
    return { success: false, error: 'Please enter a valid mobile number.' }
  }

  const admin = createAdminClient()
  const { data: customer, error } = await admin
    .from('customers')
    .select('id, first_name, last_name, mobile_number, mobile_e164, email')
    .eq('id', parsed.data.customerId)
    .maybeSingle()

  if (error || !customer) {
    return { success: false, error: 'Guest not found.' }
  }

  const phoneVariants = new Set([
    ...generatePhoneVariants(parsed.data.phone, { defaultCountryCode: '44' }),
    ...generatePhoneVariants(normalizedPhone, { defaultCountryCode: '44' }),
  ])
  const customerPhones = [customer.mobile_e164, customer.mobile_number]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  const phoneMatches = customerPhones.some((phone) => {
    if (phoneVariants.has(phone)) return true
    try {
      return formatPhoneForStorage(phone, { defaultCountryCode: '44' }) === normalizedPhone
    } catch {
      return false
    }
  })

  if (customerPhones.length > 0 && !phoneMatches) {
    return { success: false, error: 'That phone number no longer matches this guest.' }
  }

  return completeCheckIn({
    event: access.event,
    userId: access.userId,
    userEmail: access.userEmail,
    customerId: customer.id,
    normalizedPhone,
    customerName: displayCustomerName(customer),
  })
}

export async function registerNewGuest(input: z.infer<typeof registerNewSchema>): Promise<EventGuestRegisterResult> {
  const parsed = registerNewSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid guest details.' }
  }

  const access = await requireEventManager(parsed.data.eventId)
  if (!access.ok) {
    return { success: false, error: access.error }
  }

  const normalizedPhone = normalizePhone(parsed.data.phone)
  if (!normalizedPhone) {
    return { success: false, error: 'Please enter a valid mobile number.' }
  }

  const firstName = cleanName(parsed.data.firstName)
  const lastName = cleanName(parsed.data.lastName)
  const email = parsed.data.email ? parsed.data.email.trim().toLowerCase() : null
  const admin = createAdminClient()
  const customerResolution = await ensureCustomerForPhone(admin, normalizedPhone, {
    firstName,
    lastName,
    email,
  })

  if (!customerResolution.customerId) {
    logger.error('Failed to create or resolve check-in customer', {
      metadata: {
        eventId: parsed.data.eventId,
        resolutionError: customerResolution.resolutionError ?? null,
      },
    })
    return { success: false, error: 'Could not create or find customer for this phone number.' }
  }

  return completeCheckIn({
    event: access.event,
    userId: access.userId,
    userEmail: access.userEmail,
    customerId: customerResolution.customerId,
    normalizedPhone,
    customerName: `${firstName} ${lastName}`.trim(),
  })
}
