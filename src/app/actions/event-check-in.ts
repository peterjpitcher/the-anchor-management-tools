'use server'

import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { formatPhoneForStorage, sanitizeName } from '@/lib/validation'
import { getConstraintErrorMessage, isPostgrestError } from '@/lib/dbErrorHandler'
import { JobQueue } from '@/lib/background-jobs'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

type SupabaseServerClient = Awaited<ReturnType<typeof createAdminClient>>

const GOOGLE_REVIEW_LINK = 'https://vip-club.uk/support-us'
const LONDON_TZ = 'Europe/London'

const lookupSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().min(3, 'Enter a phone number'),
})

const registerExistingSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().min(3),
  customerId: z.string().uuid(),
})

const registerNewSchema = z.object({
  eventId: z.string().uuid(),
  phone: z.string().min(3),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email().optional(),
})

type LookupInput = z.infer<typeof lookupSchema>
type RegisterExistingInput = z.infer<typeof registerExistingSchema>
type RegisterNewInput = z.infer<typeof registerNewSchema>

type KnownGuest = {
  customer: {
    id: string
    first_name: string
    last_name: string | null
    mobile_number: string
    email?: string | null
  }
  booking?: {
    id: string
    seats: number | null
  }
  alreadyCheckedIn: boolean
}

type LookupResult =
  | { success: true; status: 'known'; data: KnownGuest; normalizedPhone: string }
  | { success: true; status: 'unknown'; normalizedPhone: string }
  | { success: false; error: string }

function normalizePhoneOrError(rawPhone: string): string | null {
  try {
    return formatPhoneForStorage(rawPhone)
  } catch (error) {
    console.error('Failed to normalize phone for check-in:', error)
    return null
  }
}

function buildThankYouScheduleUtc(eventDate: string, eventTime: string): Date {
  const eventDateTime = fromZonedTime(`${eventDate}T${eventTime}`, LONDON_TZ)
  const nextDayLocal = toZonedTime(eventDateTime, LONDON_TZ)
  nextDayLocal.setDate(nextDayLocal.getDate() + 1)
  nextDayLocal.setHours(10, 0, 0, 0)
  return fromZonedTime(nextDayLocal, LONDON_TZ)
}

async function scheduleThankYouSms(params: {
  phone: string
  customerId: string
  eventName: string
  eventDate: string
  eventTime: string
}) {
  const queue = JobQueue.getInstance()
  const scheduledUtc = buildThankYouScheduleUtc(params.eventDate, params.eventTime)
  const delay = Math.max(scheduledUtc.getTime() - Date.now(), 60 * 1000)
  const message = `Thanks for coming to ${params.eventName} at The Anchor! We'd love your review: ${GOOGLE_REVIEW_LINK}`

  try {
    await queue.enqueue('send_sms', {
      to: params.phone,
      message,
      customerId: params.customerId,
      type: 'custom',
    }, { delay })
  } catch (error) {
    console.error('Failed to schedule thank-you SMS:', error)
  }
}

async function ensureEventAccess(eventId: string): Promise<{ event: { id: string; name: string; date: string; time: string } } | { error: string }> {
  const hasPermission = await checkUserPermission('events', 'manage')
  if (!hasPermission) {
    return { error: 'You do not have permission to manage event check-ins' }
  }

  const supabase = await createClient()
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, date, time')
    .eq('id', eventId)
    .maybeSingle()

  if (error) {
    console.error('Error verifying event access:', error)
    return { error: 'Failed to load event details' }
  }

  if (!event) {
    return { error: 'Event not found' }
  }

  return { event }
}

export async function lookupEventGuest(input: LookupInput): Promise<LookupResult> {
  const parsed = lookupSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' }
  }

  const { eventId, phone } = parsed.data

  const access = await ensureEventAccess(eventId)
  if ('error' in access) {
    return { success: false, error: access.error }
  }

  const normalizedPhone = normalizePhoneOrError(phone)
  if (!normalizedPhone) {
    return { success: false, error: 'Please enter a valid UK mobile number (e.g. 07700 900123 or +447700900123)' }
  }

  try {
    const supabase = await createClient()

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, email')
      .eq('mobile_number', normalizedPhone)
      .maybeSingle()

    if (customerError) {
      console.error('Lookup customer error:', customerError)
      return { success: false, error: 'Failed to look up guest' }
    }

    if (!customer) {
      return { success: true, status: 'unknown', normalizedPhone }
    }

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, seats')
      .eq('event_id', eventId)
      .eq('customer_id', customer.id)
      .maybeSingle()

    if (bookingError && bookingError.code !== 'PGRST116') {
      console.error('Lookup booking error:', bookingError)
      return { success: false, error: 'Failed to look up guest booking' }
    }

    const { data: checkIn, error: checkInError } = await supabase
      .from('event_check_ins')
      .select('id')
      .eq('event_id', eventId)
      .eq('customer_id', customer.id)
      .maybeSingle()

    if (checkInError && checkInError.code !== 'PGRST116') {
      console.error('Lookup check-in error:', checkInError)
      return { success: false, error: 'Failed to load check-in status' }
    }

    return {
      success: true,
      status: 'known',
      normalizedPhone,
      data: {
        customer,
        booking: booking ?? undefined,
        alreadyCheckedIn: Boolean(checkIn),
      },
    }
  } catch (error) {
    console.error('Unexpected lookup error:', error)
    return { success: false, error: 'Failed to look up guest' }
  }
}

type RegisterResult =
  | {
      success: true
      data: {
        customerId: string
        bookingId: string
        checkInId: string
        customerName: string
      }
    }
  | { success: false; error: string }

async function upsertCustomerForCheckIn(
  admin: SupabaseServerClient,
  customerId: string | undefined,
  normalizedPhone: string,
  firstName?: string,
  lastName?: string,
  email?: string
): Promise<{ customerId: string; firstName: string; lastName: string | null } | { error: string }> {
  if (customerId) {
    const { data: existing, error } = await admin
      .from('customers')
      .select('id, email, first_name, last_name')
      .eq('id', customerId)
      .single()

    if (error || !existing) {
      return { error: 'Customer not found' }
    }

    if (email && (!existing.email || existing.email.toLowerCase() !== email.toLowerCase())) {
      const { error: updateError } = await admin
        .from('customers')
        .update({ email: email.toLowerCase() })
        .eq('id', customerId)

      if (updateError) {
        console.error('Failed to update customer email:', updateError)
        return { error: 'Failed to update customer details' }
      }
    }

    return { customerId, firstName: existing.first_name, lastName: existing.last_name }
  }

  if (!firstName) {
    return { error: 'First name is required for new guests' }
  }

  const cleanFirst = sanitizeName(firstName)
  const cleanLast = lastName ? sanitizeName(lastName) : null

  const payload = {
    first_name: cleanFirst,
    last_name: cleanLast,
    mobile_number: normalizedPhone,
    email: email ? email.toLowerCase() : null,
    sms_opt_in: true,
  }

  const { data, error } = await admin
    .from('customers')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    if (isPostgrestError(error)) {
      return { error: getConstraintErrorMessage(error) }
    }
    console.error('Failed to create customer for check-in:', error)
    return { error: 'Failed to create customer' }
  }

  return { customerId: data.id, firstName: cleanFirst, lastName: cleanLast }
}

async function ensureBooking(
  admin: SupabaseServerClient,
  eventId: string,
  customerId: string
): Promise<{ success: true; bookingId: string } | { success: false; error: string }> {
  const { data: existingBooking, error: bookingError } = await admin
    .from('bookings')
    .select('id')
    .eq('event_id', eventId)
    .eq('customer_id', customerId)
    .maybeSingle()

  if (bookingError && bookingError.code !== 'PGRST116') {
    console.error('Failed to load existing booking:', bookingError)
    return { success: false, error: 'Failed to load existing booking' }
  }

  if (existingBooking) {
    return { success: true, bookingId: existingBooking.id }
  }

  const { data: booking, error: insertError } = await admin
    .from('bookings')
    .insert({
      event_id: eventId,
      customer_id: customerId,
      seats: 1,
      booking_source: 'bulk_add',
      notes: 'Created via event check-in',
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('Failed to create booking:', insertError)
    return { success: false, error: 'Failed to create booking for guest' }
  }

  return { success: true, bookingId: booking.id }
}

async function recordCheckIn(
  admin: SupabaseServerClient,
  eventId: string,
  customerId: string,
  bookingId: string,
  staffId: string
) {
  const { data: checkIn, error } = await admin
    .from('event_check_ins')
    .insert({
      event_id: eventId,
      customer_id: customerId,
      booking_id: bookingId,
      check_in_method: 'manual',
      staff_id: staffId,
    })
    .select('id')
    .single()

  if (error) {
    if (isPostgrestError(error) && error.code === '23505') {
      return { error: 'Guest is already checked in for this event' }
    }
    console.error('Failed to record check-in:', error)
    return { error: 'Failed to record check-in' }
  }

  return { checkInId: checkIn.id }
}

async function assignEventLabels(
  admin: SupabaseServerClient,
  customerId: string,
  assignedBy: string | null
) {
  const REQUIRED_LABELS = [
    {
      name: 'Event Booker',
      description: 'Guests who have an event booking at The Anchor.',
      color: '#0EA5E9',
      icon: 'calendar-star',
    },
    {
      name: 'Event Attendee',
      description: 'Guests who have attended an event at The Anchor.',
      color: '#16A34A',
      icon: 'user-group',
    },
    {
      name: 'Event Checked-In',
      description: 'Guests who have checked in for an event at The Anchor.',
      color: '#0F766E',
      icon: 'badge-check',
    },
  ] as const

  const labelNames = REQUIRED_LABELS.map((label) => label.name)

  const { data: existingLabels, error: labelsError } = await admin
    .from('customer_labels')
    .select('id, name')
    .in('name', labelNames)

  if (labelsError) {
    console.error('Failed to load event labels:', labelsError)
    return
  }

  const labelMap = new Map(existingLabels?.map((label) => [label.name, label.id]))

  const missingLabels = REQUIRED_LABELS.filter((label) => !labelMap.has(label.name))

  if (missingLabels.length > 0) {
    const { data: insertedLabels, error: insertError } = await admin
      .from('customer_labels')
      .insert(
        missingLabels.map((label) => ({
          name: label.name,
          description: label.description,
          color: label.color,
          icon: label.icon,
          auto_apply_rules: null,
        }))
      )
      .select('id, name')

    if (insertError) {
      console.error('Failed to create required event labels:', insertError)
    } else {
      for (const label of insertedLabels || []) {
        labelMap.set(label.name, label.id)
      }
    }
  }

  const assignments: Array<{
    customer_id: string
    label_id: string
    auto_assigned: boolean
    assigned_by: string | null
    notes: string
  }> = []

  for (const label of REQUIRED_LABELS) {
    const labelId = labelMap.get(label.name)
    if (!labelId) continue

    assignments.push({
      customer_id: customerId,
      label_id: labelId,
      auto_assigned: true,
      assigned_by: assignedBy,
      notes: label.name === 'Event Checked-In' ? 'Checked in via event check-in flow' : 'Auto-applied via event check-in',
    })
  }

  if (assignments.length === 0) {
    return
  }

  const { error: upsertError } = await admin
    .from('customer_label_assignments')
    .upsert(assignments, { onConflict: 'customer_id,label_id' })

  if (upsertError) {
    console.error('Failed to assign event labels:', upsertError)
  }
}

export async function registerKnownGuest(input: RegisterExistingInput): Promise<RegisterResult> {
  const parsed = registerExistingSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' }
  }

  const { eventId, phone, customerId } = parsed.data

  const access = await ensureEventAccess(eventId)
  if ('error' in access) {
    return { success: false, error: access.error }
  }

  const eventRecord = access.event

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'You must be signed in to check in guests' }
  }

  const normalizedPhone = normalizePhoneOrError(phone)
  if (!normalizedPhone) {
    return { success: false, error: 'Please enter a valid UK mobile number' }
  }

  try {
    const admin = await createAdminClient()

    const ensureCustomer = await upsertCustomerForCheckIn(admin, customerId, normalizedPhone)
    if ('error' in ensureCustomer) {
      return { success: false, error: ensureCustomer.error }
    }

    const ensuredBooking = await ensureBooking(admin, eventId, ensureCustomer.customerId)
    if (!ensuredBooking.success) {
      return { success: false, error: ensuredBooking.error }
    }

    const checkIn = await recordCheckIn(admin, eventId, ensureCustomer.customerId, ensuredBooking.bookingId, user.id)
    if ('error' in checkIn) {
      return { success: false, error: checkIn.error || 'Failed to record check-in' }
    }

    await assignEventLabels(admin, ensureCustomer.customerId, user.id)

    await scheduleThankYouSms({
      phone: normalizedPhone,
      customerId: ensureCustomer.customerId,
      eventName: eventRecord.name,
      eventDate: eventRecord.date,
      eventTime: eventRecord.time,
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'create',
      resource_type: 'event_check_in',
      resource_id: checkIn.checkInId,
      operation_status: 'success',
      new_values: {
        event_id: eventId,
        customer_id: ensureCustomer.customerId,
        booking_id: ensuredBooking.bookingId,
      },
    })

    return {
      success: true,
      data: {
        customerId: ensureCustomer.customerId,
        bookingId: ensuredBooking.bookingId,
        checkInId: checkIn.checkInId,
        customerName: `${ensureCustomer.firstName} ${ensureCustomer.lastName ?? ''}`.trim(),
      },
    }
  } catch (error) {
    console.error('Failed to register known guest:', error)
    return { success: false, error: 'Failed to complete check-in' }
  }
}

export async function registerNewGuest(input: RegisterNewInput): Promise<RegisterResult> {
  const parsed = registerNewSchema.safeParse({
    ...input,
    firstName: sanitizeName(input.firstName || ''),
    lastName: sanitizeName(input.lastName || ''),
    email: input.email?.trim() || undefined,
  })

  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message || 'Invalid guest details' }
  }

  const { eventId, phone, firstName, lastName, email } = parsed.data

  const access = await ensureEventAccess(eventId)
  if ('error' in access) {
    return { success: false, error: access.error }
  }

  const eventRecord = access.event

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: 'You must be signed in to check in guests' }
  }

  const normalizedPhone = normalizePhoneOrError(phone)
  if (!normalizedPhone) {
    return { success: false, error: 'Please enter a valid UK mobile number' }
  }

  try {
    const admin = await createAdminClient()

    // Double-check if customer already exists after normalization
    const { data: existingCustomer } = await admin
      .from('customers')
      .select('id, first_name, last_name')
      .eq('mobile_number', normalizedPhone)
      .maybeSingle()

    const ensureCustomer = await upsertCustomerForCheckIn(
      admin,
      existingCustomer?.id,
      normalizedPhone,
      firstName,
      lastName,
      email
    )

    if ('error' in ensureCustomer) {
      return { success: false, error: ensureCustomer.error }
    }

    const ensuredBooking = await ensureBooking(admin, eventId, ensureCustomer.customerId)
    if (!ensuredBooking.success) {
      return { success: false, error: ensuredBooking.error }
    }

    const checkIn = await recordCheckIn(admin, eventId, ensureCustomer.customerId, ensuredBooking.bookingId, user.id)
    if ('error' in checkIn) {
      return { success: false, error: checkIn.error || 'Failed to record check-in' }
    }

    await assignEventLabels(admin, ensureCustomer.customerId, user.id)

    await scheduleThankYouSms({
      phone: normalizedPhone,
      customerId: ensureCustomer.customerId,
      eventName: eventRecord.name,
      eventDate: eventRecord.date,
      eventTime: eventRecord.time,
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'create',
      resource_type: 'event_check_in',
      resource_id: checkIn.checkInId,
      operation_status: 'success',
      new_values: {
        event_id: eventId,
        customer_id: ensureCustomer.customerId,
        booking_id: ensuredBooking.bookingId,
      },
    })

    return {
      success: true,
      data: {
        customerId: ensureCustomer.customerId,
        bookingId: ensuredBooking.bookingId,
        checkInId: checkIn.checkInId,
        customerName: `${firstName} ${lastName}`.trim(),
      },
    }
  } catch (error) {
    console.error('Failed to register new guest:', error)
    return { success: false, error: 'Failed to complete check-in' }
  }
}
