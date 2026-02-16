#!/usr/bin/env tsx
/**
 * Check SMS sending issues for new customers
 */

import { config } from 'dotenv'
import path from 'path'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'check-sms-issue'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ${message}`)
}

async function checkSmsIssue() {
  if (process.argv.includes('--confirm')) {
    throw new Error('check-sms-issue is read-only and does not support --confirm.')
  }

  console.log('=== Checking SMS Issues for New Customers ===\n')

  // 1. Check Environment
  console.log('1. TWILIO CONFIGURATION:')
  console.log('------------------------')

  const hasAccountSid = !!process.env.TWILIO_ACCOUNT_SID
  const hasAuthToken = !!process.env.TWILIO_AUTH_TOKEN
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID

  console.log(`TWILIO_ACCOUNT_SID: ${hasAccountSid ? 'SET' : 'MISSING'}`)
  console.log(`TWILIO_AUTH_TOKEN: ${hasAuthToken ? 'SET' : 'MISSING'}`)
  console.log(`TWILIO_PHONE_NUMBER: ${phoneNumber || 'NOT SET'}`)
  console.log(`TWILIO_MESSAGING_SERVICE_SID: ${messagingServiceSid || 'NOT SET'}`)

  const canSendSms = hasAccountSid && hasAuthToken && (phoneNumber || messagingServiceSid)

  if (!canSendSms) {
    console.log('\nPROBLEM FOUND: Twilio is not properly configured!')
    if (!hasAccountSid || !hasAuthToken) {
      console.log('   Missing credentials - SMS cannot be sent')
    }
    if (!phoneNumber && !messagingServiceSid) {
      console.log('   No sender configured - need TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID')
    }
    markFailure('Twilio is not properly configured.')
  } else {
    console.log('\nTwilio configuration looks complete')
  }

  // 2. Check Database
  const supabase = createAdminClient()

  console.log('\n2. RECENT BOOKING ATTEMPTS:')
  console.log('---------------------------')

  const { data: bookingsRaw, error: bookingsError } = await supabase
    .from('pending_bookings')
    .select('customer_id, mobile_number, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  const bookings = (assertScriptQuerySucceeded({
    operation: 'Load recent pending bookings for SMS issue diagnostics',
    error: bookingsError,
    data: bookingsRaw ?? [],
    allowMissing: true,
  }) ?? []) as Array<{
    customer_id: string | null
    mobile_number: string | null
    metadata: { initial_sms?: { message_sid?: string | null } } | null
    created_at: string
  }>

  if (bookings.length === 0) {
    console.log('No pending bookings found')
    return
  }

  // Analyze the data
  let totalNew = 0
  let totalExisting = 0
  let smsSuccessNew = 0
  let smsFailedNew = 0
  let smsSuccessExisting = 0
  let smsFailedExisting = 0

  console.log(`\nFound ${bookings.length} recent booking attempts:\n`)

  bookings.forEach((booking) => {
    const isNew = !booking.customer_id
    const hasSms = !!booking.metadata?.initial_sms?.message_sid

    if (isNew) {
      totalNew++
      if (hasSms) smsSuccessNew++
      else smsFailedNew++
    } else {
      totalExisting++
      if (hasSms) smsSuccessExisting++
      else smsFailedExisting++
    }

    if (isNew && !hasSms) {
      console.log('NEW CUSTOMER - NO SMS:')
      console.log(`   Phone: ${booking.mobile_number || 'unknown'}`)
      console.log(`   Created: ${new Date(booking.created_at).toLocaleString('en-GB')}`)
      if (booking.metadata) {
        console.log(`   Metadata: ${JSON.stringify(booking.metadata)}`)
      }
      console.log('')
    }
  })

  // Summary
  console.log('SUMMARY:')
  console.log('--------')
  console.log(`New Customers: ${totalNew}`)
  if (totalNew > 0) {
    console.log(`  SMS Sent: ${smsSuccessNew} (${Math.round((smsSuccessNew / totalNew) * 100)}%)`)
    console.log(`  SMS Failed: ${smsFailedNew} (${Math.round((smsFailedNew / totalNew) * 100)}%)`)
  }
  console.log(`\nExisting Customers: ${totalExisting}`)
  if (totalExisting > 0) {
    console.log(`  SMS Sent: ${smsSuccessExisting} (${Math.round((smsSuccessExisting / totalExisting) * 100)}%)`)
    console.log(`  SMS Failed: ${smsFailedExisting} (${Math.round((smsFailedExisting / totalExisting) * 100)}%)`)
  }

  // Diagnosis
  console.log('\n3. DIAGNOSIS:')
  console.log('-------------')

  if (totalNew > 0 && smsFailedNew === totalNew) {
    console.log('CONFIRMED: New customers are NOT receiving SMS')
    console.log('\nMost likely cause: Twilio configuration issue (see above)')
    markFailure('Confirmed: new customers are not receiving SMS invites.')
  } else if (totalNew > 0 && smsFailedNew > 0) {
    console.log('PARTIAL FAILURE: Some new customers not receiving SMS')
    console.log('\nPossible causes:')
    console.log('- Intermittent Twilio issues')
    console.log('- Phone number formatting problems')
    console.log('- Rate limiting')
    markFailure('Detected missing SMS invites for some new customers.')
  } else if (totalNew > 0 && smsSuccessNew === totalNew) {
    console.log('New customers ARE receiving SMS successfully')
  } else {
    console.log('No new customer bookings found to analyze')
  }

  console.log('\n4. RECOMMENDED ACTIONS:')
  console.log('----------------------')
  console.log('1. Check Twilio environment variables in .env.local')
  console.log('2. Verify Twilio account status at https://console.twilio.com')
  console.log('3. Check Twilio balance and phone number status')
  console.log('4. Review error logs in Twilio console')
  console.log('5. Test with: curl -X POST http://localhost:3000/api/bookings/initiate ...')
}

void checkSmsIssue().catch((error) => {
  markFailure('check-sms-issue failed.', error)
})
