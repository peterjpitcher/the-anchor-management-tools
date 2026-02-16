#!/usr/bin/env tsx

import { config } from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') })

type SmsJobRow = {
  id: string
  status: string | null
  created_at: string | null
  scheduled_for: string | null
  payload: Record<string, unknown> | null
  error: string | null
}

type OutboundMessageRow = {
  id: string
  to_number: string | null
  twilio_status: string | null
  status: string | null
  created_at: string | null
  body: string | null
  error_message: string | null
}

type ConfirmedBookingRow = {
  id: string
  booking_reference: string | null
  booking_type: string | null
  party_size: number | null
  booking_date: string | null
  booking_time: string | null
  created_at: string | null
  customer: {
    first_name: string | null
    last_name: string | null
    mobile_number: string | null
    sms_opt_in: boolean | null
  } | null
}

function assertReadOnlyScript(argv: string[] = process.argv.slice(2)): void {
  if (argv.includes('--confirm')) {
    throw new Error('test-sms-flow is read-only and does not support --confirm.')
  }
}

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function testSMSFlow() {
  console.log('🔍 Testing SMS Flow for Table Bookings...\n')

  try {
    assertReadOnlyScript()
    const supabase = createAdminClient()

    // 1. Check if SMS jobs are being created
    console.log('1️⃣ Checking recent SMS jobs:')
    const { data: recentJobsData, error: jobsError } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .order('created_at', { ascending: false })
      .limit(5);

    const recentJobs =
      (assertScriptQuerySucceeded({
        operation: 'Load recent send_sms jobs',
        error: jobsError,
        data: recentJobsData as SmsJobRow[] | null,
        allowMissing: true,
      }) ?? []) as SmsJobRow[]

    if (recentJobs.length === 0) {
      console.log('⚠️  No SMS jobs found in queue');
    } else {
      console.log(`✅ Found ${recentJobs.length} recent SMS jobs:\n`);
      recentJobs.forEach((job, index) => {
        console.log(`Job ${index + 1}:`);
        console.log(`  ID: ${job.id}`);
        console.log(`  Status: ${job.status}`);
        console.log(`  Created: ${new Date(job.created_at ?? '').toLocaleString()}`);
        console.log(`  Scheduled for: ${new Date(job.scheduled_for ?? '').toLocaleString()}`);
        if (job.payload?.template) {
          console.log(`  Template: ${job.payload.template}`);
        }
        if (job.payload?.to) {
          console.log(`  To: ${job.payload.to}`);
        }
        if (job.error) {
          console.log(`  Error: ${job.error}`);
        }
        console.log('');
      });
    }

    // 2. Check actual SMS messages sent
    console.log('\n2️⃣ Checking recent SMS messages:')
    const { data: recentMessages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(5);

    const safeRecentMessages =
      (assertScriptQuerySucceeded({
        operation: 'Load recent outbound messages',
        error: messagesError,
        data: recentMessages as OutboundMessageRow[] | null,
        allowMissing: true,
      }) ?? []) as OutboundMessageRow[]

    if (safeRecentMessages.length === 0) {
      console.log('⚠️  No outbound messages found');
    } else {
      console.log(`✅ Found ${safeRecentMessages.length} recent outbound messages:\n`);
      safeRecentMessages.forEach((msg, index) => {
        console.log(`Message ${index + 1}:`);
        console.log(`  ID: ${msg.id}`);
        console.log(`  To: ${msg.to_number}`);
        console.log(`  Status: ${msg.twilio_status || msg.status}`);
        console.log(`  Created: ${new Date(msg.created_at ?? '').toLocaleString()}`);
        console.log(`  Body preview: ${String(msg.body ?? '').substring(0, 50)}...`);
        if (msg.error_message) {
          console.log(`  Error: ${msg.error_message}`);
        }
        console.log('');
      });
    }

    // 3. Check Twilio configuration
    console.log('\n3️⃣ Checking Twilio Configuration:')
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER
    const twilioSid = process.env.TWILIO_ACCOUNT_SID
    
    console.log(`  Twilio Phone: ${twilioPhone ? '✅ Set' : '❌ Not set'}`);
    console.log(`  Twilio SID: ${twilioSid ? '✅ Set' : '❌ Not set'}`);
    console.log(`  Twilio Token: ${process.env.TWILIO_AUTH_TOKEN ? '✅ Set' : '❌ Not set'}`);

    if (!twilioSid || !process.env.TWILIO_AUTH_TOKEN || !twilioPhone) {
      markFailure('Twilio environment variables are incomplete (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER).')
    }

    // 4. Check recent table bookings
    console.log('\n4️⃣ Checking recent confirmed table bookings:')
    const { data: recentBookings, error: bookingError } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        status,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        )
      `)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false })
      .limit(3);

    const safeRecentBookings =
      (assertScriptQuerySucceeded({
        operation: 'Load recent confirmed table bookings',
        error: bookingError,
        data: recentBookings as ConfirmedBookingRow[] | null,
        allowMissing: true,
      }) ?? []) as ConfirmedBookingRow[]

    if (safeRecentBookings.length > 0) {
      console.log(`✅ Found ${safeRecentBookings.length} recent confirmed bookings:`);
      safeRecentBookings.forEach((booking, index) => {
        console.log(`\nBooking ${index + 1}: ${booking.booking_reference}`);
        console.log(`  Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
        console.log(`  Phone: ${booking.customer?.mobile_number}`);
        console.log(`  SMS Opt-in: ${booking.customer?.sms_opt_in ? 'Yes' : 'No'}`);
        console.log(`  Created: ${new Date(booking.created_at ?? '').toLocaleString()}`);
      });
    }

    // 5. Summary
    console.log('\n📊 SMS Flow Summary:')
    console.log('===================');
    
    const pendingJobs = recentJobs?.filter(j => j.status === 'pending').length || 0;
    const completedJobs = recentJobs?.filter(j => j.status === 'completed').length || 0;
    const failedJobs = recentJobs?.filter(j => j.status === 'failed').length || 0;
    
    console.log(`  Pending SMS jobs: ${pendingJobs}`);
    console.log(`  Completed SMS jobs: ${completedJobs}`);
    console.log(`  Failed SMS jobs: ${failedJobs}`);
    
    if (pendingJobs > 0) {
      console.log('\n⚠️  There are pending SMS jobs waiting to be processed');
      console.log('  These should be processed by the GitHub Action every 5 minutes');
    }
    
    if (failedJobs > 0) {
      console.log('\n❌ There are failed SMS jobs - check error messages above');
    }

  } catch (error) {
    markFailure('Unexpected error.', error)
  }
}

// Run the test
void testSMSFlow().catch((error) => {
  markFailure('test-sms-flow failed.', error)
})
