#!/usr/bin/env tsx
/**
 * One-off correction: Sylvia Marlow was booked onto the wrong event.
 *
 * On 13 Aug 2026 at 08:02 we texted her that Cowboys & Queens Country Music
 * Bingo was on the following night. She replied at 08:46 asking for 4 seats. The
 * reply-to-book lookup ordered open promo windows by reply_window_expires_at,
 * which holds the event's start time, so it picked The Last Quiz of Summer on
 * 19 Aug instead: the event starting furthest in the future rather than the one
 * we had just texted her about. She was confirmed for the quiz and has nothing
 * booked for the music bingo she actually asked for.
 *
 * The ordering bug is fixed in src/lib/sms/reply-to-book.ts. This script repairs
 * the one booking it already produced.
 *
 * What it does:
 *   1. Books her 4 seats on the music bingo through EventBookingService, so the
 *      table reservation, manage-booking token and confirmation SMS all happen
 *      exactly as they would have this morning.
 *   2. Marks the wrong quiz booking cancelled, with a note saying why.
 *
 * The quiz cancellation is deliberately silent. She never asked for that booking,
 * so a "your quiz booking is cancelled" text would only confuse her. The music
 * bingo confirmation is the one message she gets.
 *
 * Dry run by default. Pass --send to make the changes.
 *
 *   npx tsx --require ./scripts/server-only-stub.cjs scripts/fix-sylvia-marlow-wrong-event.ts
 *   npx tsx --require ./scripts/server-only-stub.cjs scripts/fix-sylvia-marlow-wrong-event.ts --send
 *
 * The stub is needed because EventBookingService pulls in a module marked
 * `server-only`, whose guard throws outside a Next.js server build. A tsx script
 * is already server-side, so neutralising it is safe here.
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const CUSTOMER_ID = 'db4d85cc-5823-419c-96e4-0fcf49235d37' // Sylvia Marlow
const PHONE = '+447895504024'
const WRONG_BOOKING_ID = '57051a0c-e0ba-48f8-8018-f3fc57c9ce57' // The Last Quiz of Summer, 19 Aug
const RIGHT_EVENT_ID = 'ba5ebad1-9062-46c3-85cf-bfe897dde4e4' // Cowboys & Queens Country Music Bingo, 14 Aug
const SEATS = 4

const CANCEL_NOTE =
  'Cancelled by staff: created in error by the SMS reply-to-book event lookup on 13 Aug 2026. ' +
  'The customer replied to a Cowboys & Queens Country Music Bingo promo and has been booked onto that event instead.'

async function main(): Promise<void> {
  const send = process.argv.includes('--send')

  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { EventBookingService } = await import('@/services/event-bookings')
  const supabase = createAdminClient()

  // Verify the world still looks the way this fix assumes before touching it.
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number, sms_opt_in, sms_status')
    .eq('id', CUSTOMER_ID)
    .maybeSingle()
  if (customerError) throw customerError
  if (!customer) throw new Error('Customer not found')

  const { data: wrongBooking, error: wrongBookingError } = await supabase
    .from('bookings')
    .select('id, event_id, seats, status')
    .eq('id', WRONG_BOOKING_ID)
    .maybeSingle()
  if (wrongBookingError) throw wrongBookingError
  if (!wrongBooking) throw new Error('Wrong booking not found')
  if (wrongBooking.status !== 'confirmed') {
    throw new Error(`Wrong booking is already ${wrongBooking.status}, nothing to do. Re-check before forcing this.`)
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, name, date, time, booking_mode, booking_open, bookings_enabled')
    .eq('id', RIGHT_EVENT_ID)
    .maybeSingle()
  if (eventError) throw eventError
  if (!event) throw new Error('Target event not found')

  // Guard against double-running: if she is already on the music bingo, stop.
  const { data: existing, error: existingError } = await supabase
    .from('bookings')
    .select('id, seats, status')
    .eq('customer_id', CUSTOMER_ID)
    .eq('event_id', RIGHT_EVENT_ID)
    .in('status', ['confirmed', 'pending_payment'])
  if (existingError) throw existingError
  if (existing && existing.length > 0) {
    throw new Error(
      `Customer already has a ${existing[0].status} booking on ${event.name} (${existing[0].id}). Already fixed?`
    )
  }

  console.warn(`${send ? 'APPLYING' : 'DRY RUN'}`)
  console.warn(`  Customer:  ${customer.first_name} ${customer.last_name} (${customer.mobile_number})`)
  console.warn(`  SMS:       opt_in=${customer.sms_opt_in} status=${customer.sms_status}`)
  console.warn(`  Cancel:    booking ${WRONG_BOOKING_ID} (quiz, 19 Aug), currently ${wrongBooking.status}`)
  console.warn(`  Create:    ${SEATS} seats on "${event.name}" ${event.date} ${event.time} (mode ${event.booking_mode})`)
  console.warn(`  SMS out:   booking confirmation for "${event.name}"`)

  if (!send) {
    console.warn('\nDry run only. Re-run with --send to apply.')
    return
  }

  // Book the right event first. If this fails she keeps the quiz seats rather
  // than ending up with nothing at all.
  const result = await EventBookingService.createBooking({
    eventId: RIGHT_EVENT_ID,
    customerId: CUSTOMER_ID,
    normalizedPhone: PHONE,
    seats: SEATS,
    source: 'admin',
    bookingMode: (event.booking_mode ?? 'communal') as 'table' | 'general' | 'mixed' | 'communal',
    appBaseUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://management.orangejelly.co.uk',
    shouldSendSms: true,
    supabaseClient: supabase,
    logTag: 'sms reply correction',
    firstName: customer.first_name ?? undefined
  })

  // The event is cash_only with no capacity set, so this should land on
  // 'confirmed'. Anything else means the world moved and the quiz booking must
  // stay where it is until a human looks.
  if (result.resolvedState !== 'confirmed' || !result.bookingId) {
    throw new Error(
      `Music bingo booking did not confirm (state=${result.resolvedState}, reason=${result.resolvedReason ?? 'none'}). ` +
        'The quiz booking has been left alone on purpose.'
    )
  }
  console.warn(`  Created booking ${result.bookingId}`)
  console.warn(`  Confirmation SMS: ${result.smsMeta?.success ? 'sent' : `NOT sent (${result.smsMeta?.code ?? 'unknown'})`}`)

  const { error: cancelError } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: 'system:sms-reply-event-correction',
      notes: CANCEL_NOTE
    })
    .eq('id', WRONG_BOOKING_ID)
    .eq('status', 'confirmed')
  if (cancelError) throw cancelError
  console.warn(`  Cancelled booking ${WRONG_BOOKING_ID}`)

  console.warn('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
