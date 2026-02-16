#!/usr/bin/env tsx

import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'
import { config } from 'dotenv'
import { ensureReplyInstruction } from '../../src/lib/sms/support'
import { sendSMS } from '../../src/lib/twilio'
import {
  assertTestTableBookingSmsSendLimit,
  assertTestTableBookingSmsSendAllowed,
  assertTestTableBookingSmsTargets,
  isTestTableBookingSmsRunEnabled,
  isTestTableBookingSmsSendEnabled,
  readTestTableBookingSmsBookingId,
  readTestTableBookingSmsLimit,
  readTestTableBookingSmsToNumber
} from '../../src/lib/test-table-booking-sms-safety'

// Load environment variables
config({ path: '.env.local' })

type BookingRow = {
  id: string
  booking_reference: string | null
  booking_type: string | null
  party_size: number | null
  booking_date: string | null
  booking_time: string | null
  created_at: string | null
  customer: {
    id: string | null
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    sms_opt_in: boolean | null
  } | null
}

type TemplateRow = {
  template_key: string
  template_text: string
}

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

// Helper function to format time
function formatTime12Hour(time24: string): string {
  const timeWithoutSeconds = time24.split(':').slice(0, 2).join(':')
  const [hours, minutes] = timeWithoutSeconds.split(':').map(Number)

  const period = hours >= 12 ? 'pm' : 'am'
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours

  if (minutes === 0) {
    return `${hours12}${period}`
  } else {
    return `${hours12}:${minutes.toString().padStart(2, '0')}${period}`
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderTemplateText(templateText: string, variables: Record<string, string>): string {
  let rendered = templateText
  for (const [key, value] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`{{\\s*${escapeRegExp(key)}\\s*}}`, 'g'), value)
  }
  return rendered
}

async function testTableBookingSMS() {
  // Create admin client with service role key
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    markFailure('Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).')
    return
  }

  const supabase = createAdminClient()

  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const sendEnabled = !dryRunOverride && isTestTableBookingSmsSendEnabled(process.argv)
  const bookingIdOverride = readTestTableBookingSmsBookingId(process.argv)
  const toOverride = readTestTableBookingSmsToNumber(process.argv)
  const limitOverride = readTestTableBookingSmsLimit(process.argv)

  if (hasConfirmFlag && !sendEnabled && !isTestTableBookingSmsRunEnabled() && !dryRunOverride) {
    throw new Error('test-table-booking-sms blocked: --confirm requires RUN_TEST_TABLE_BOOKING_SMS_SEND=true.')
  }

  if (!sendEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `Read-only mode${extra}. Re-run with --confirm --limit=1 RUN_TEST_TABLE_BOOKING_SMS_SEND=true ALLOW_TEST_TABLE_BOOKING_SMS_SEND=true --booking-id=<uuid> --to=<number> to send one SMS.`
    )
  } else {
    assertTestTableBookingSmsSendAllowed()
    assertTestTableBookingSmsSendLimit(limitOverride)
  }

  console.log('=== Testing Table Booking SMS ===\n')

  try {
    // Get booking context (send mode requires explicit booking id; read-only may default to most recent)
    let bookingQuery = supabase
      .from('table_bookings')
      .select(
        `
        id,
        booking_reference,
        booking_type,
        party_size,
        booking_date,
        booking_time,
        created_at,
        customer:customers(
          id,
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        )
      `
      )

    if (sendEnabled) {
      const targets = assertTestTableBookingSmsTargets({ bookingId: bookingIdOverride, to: toOverride })
      bookingQuery = bookingQuery.eq('id', targets.bookingId)
    } else if (bookingIdOverride) {
      bookingQuery = bookingQuery.eq('id', bookingIdOverride)
    } else {
      bookingQuery = bookingQuery.eq('status', 'confirmed').order('created_at', { ascending: false }).limit(1)
    }

    const { data: bookingData, error: bookingError } = await bookingQuery.single()

    const booking = assertScriptQuerySucceeded({
      operation: 'Load booking context for test-table-booking-sms',
      error: bookingError,
      data: bookingData as BookingRow | null,
      allowMissing: true,
    }) as BookingRow | null

    if (!booking) {
      markFailure('No bookings found.')
      return
    }
    
    console.log(`Testing SMS for booking: ${booking.booking_reference}`)
    console.log(`Booking ID: ${booking.id}`)
    console.log(`Created: ${booking.created_at}`)
    console.log(`Type: ${booking.booking_type || 'regular'}`)
    console.log(`Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`)
    console.log(`Phone: ${booking.customer?.mobile_number}`)
    console.log(`SMS Opt-in: ${booking.customer?.sms_opt_in}`)
    
    if (!booking.customer?.sms_opt_in) {
      markFailure('Customer has opted out of SMS.')
      return
    }

    // Get appropriate template
    const templateKey = booking.booking_type === 'sunday_lunch'
      ? 'booking_confirmation_sunday_lunch'
      : 'booking_confirmation_regular'

    console.log(`\nLooking for template: ${templateKey}`)
    
    const { data: templateData, error: templateError } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single()

    const template = assertScriptQuerySucceeded({
      operation: `Load table booking SMS template ${templateKey}`,
      error: templateError,
      data: templateData as TemplateRow | null,
      allowMissing: true,
    }) as TemplateRow | null

    if (!template) {
      markFailure('SMS template not found.')
      return
    }
    
    console.log('✅ Template found:', template.template_key)
    console.log('Template text:', template.template_text)

    // Prepare variables
    const variables: Record<string, string> = {
      customer_name: booking.customer?.first_name || 'Guest',
      party_size: String(booking.party_size ?? ''),
      date: new Date(booking.booking_date ?? '').toLocaleDateString('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      time: formatTime12Hour(booking.booking_time || '00:00'),
      reference: booking.booking_reference || '',
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
    }

    console.log('\nVariables:', variables)

    const renderedBody = renderTemplateText(template.template_text, variables)
    const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
    const messageBody = ensureReplyInstruction(renderedBody, supportPhone)

    if (!sendEnabled) {
      console.log('\n--- Rendered SMS Preview (dry-run) ---')
      console.log(messageBody)
      return
    }

    const targets = assertTestTableBookingSmsTargets({ bookingId: bookingIdOverride, to: toOverride })

    const bookingCustomerId = booking.customer?.id
    const bookingCustomerMobile =
      typeof booking.customer?.mobile_number === 'string'
        ? booking.customer.mobile_number.replace(/\s+/g, '')
        : ''
    const targetTo = targets.to.replace(/\s+/g, '')

    if (!bookingCustomerId || !bookingCustomerMobile) {
      throw new Error('test-table-booking-sms blocked: booking customer must have an id and mobile number to send.')
    }

    if (bookingCustomerMobile !== targetTo) {
      throw new Error(
        `test-table-booking-sms blocked: --to must match the booking customer mobile number (${bookingCustomerMobile}) to avoid accidental sends.`
      )
    }

    const stage = createHash('sha256').update(messageBody).digest('hex').slice(0, 16)
    const smsResult = await sendSMS(targets.to, messageBody, {
      customerId: bookingCustomerId,
      createCustomerIfMissing: false,
      metadata: {
        table_booking_id: booking.id,
        booking_reference: booking.booking_reference || null,
        template_key: 'test_table_booking_sms',
        trigger_type: 'test_table_booking_sms',
        stage
      }
    })

    if (!smsResult.success) {
      markFailure('Failed to send SMS.', smsResult.error || 'Unknown error')
      return
    }

    console.log('✅ SMS sent successfully!')
    console.log('SID:', smsResult.sid || 'N/A')
    console.log('Status:', smsResult.status || 'N/A')
    if (smsResult.suppressed) {
      console.log('Suppressed:', smsResult.suppressionReason)
    }
    if (smsResult.deferred) {
      console.log('Deferred:', smsResult.deferredBy, smsResult.scheduledFor || '')
    }

    if ((smsResult as any).logFailure === true || (smsResult as any).code === 'logging_failed') {
      // Safety: transport succeeded but outbound message persistence failed, so safety limits may be unreliable.
      markFailure('SMS sent but outbound message logging failed (logging_failed).')
      return
    }

  } catch (error) {
    markFailure('Error during test.', error)
  }
}

// Run the test
void testTableBookingSMS().catch((error) => {
  markFailure('test-table-booking-sms failed.', error)
})
