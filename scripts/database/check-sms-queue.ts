#!/usr/bin/env tsx

/**
 * Script to check the SMS queue and message status
 * Run with: tsx scripts/check-sms-queue.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL environment variable')
  process.exit(1)
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

async function checkSmsQueue() {
  console.log('📱 SMS Queue Status Check\n')
  console.log('=' * 60)

  try {
    // 1. Check pending messages in the queue
    const { data: pendingMessages, error: pendingError } = await supabase
      .from('messages')
      .select(`
        id,
        customer_id,
        body,
        status,
        direction,
        created_at,
        sent_at,
        twilio_status,
        customers!inner(first_name, last_name, mobile_number)
      `)
      .in('status', ['pending', 'scheduled', 'queued', 'sending'])
      .order('created_at', { ascending: true })

    if (pendingError) {
      console.error('❌ Error fetching pending messages:', pendingError)
      return
    }

    console.log(`\n📋 PENDING/QUEUED MESSAGES: ${pendingMessages?.length || 0}`)
    console.log('-' * 60)
    
    if (pendingMessages && pendingMessages.length > 0) {
      pendingMessages.forEach((msg, index) => {
        const customer = msg.customers
        console.log(`\n${index + 1}. Message ID: ${msg.id}`)
        console.log(`   To: ${customer.first_name} ${customer.last_name} (${customer.mobile_number})`)
        console.log(`   Direction: ${msg.direction}`)
        console.log(`   Status: ${msg.status}`)
        console.log(`   Twilio Status: ${msg.twilio_status || 'N/A'}`)
        console.log(`   Message: ${msg.body.substring(0, 100)}${msg.body.length > 100 ? '...' : ''}`)
        console.log(`   Created: ${new Date(msg.created_at).toLocaleString('en-GB')}`)
        if (msg.sent_at) {
          console.log(`   Sent at: ${new Date(msg.sent_at).toLocaleString('en-GB')}`)
        }
      })
    } else {
      console.log('   ✅ No pending messages in queue')
    }

    // 2. Check recent sent messages
    const { data: sentMessages, error: sentError } = await supabase
      .from('messages')
      .select(`
        id,
        status,
        created_at,
        sent_at,
        customers!inner(first_name, last_name)
      `)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(5)

    console.log(`\n\n📤 RECENTLY SENT MESSAGES (Last 5):`)
    console.log('-' * 60)

    if (sentMessages && sentMessages.length > 0) {
      sentMessages.forEach((msg, index) => {
        const customer = msg.customers
        console.log(`${index + 1}. ${customer.first_name} ${customer.last_name}`)
        console.log(`   Sent: ${msg.sent_at ? new Date(msg.sent_at).toLocaleString('en-GB') : 'N/A'}`)
      })
    } else {
      console.log('   No recently sent messages')
    }

    // 3. Check failed messages
    const { data: failedMessages, error: failedError } = await supabase
      .from('messages')
      .select(`
        id,
        status,
        error_message,
        created_at,
        customers!inner(first_name, last_name, mobile_number)
      `)
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(10)

    console.log(`\n\n❌ FAILED MESSAGES (Last 10):`)
    console.log('-' * 60)

    if (failedMessages && failedMessages.length > 0) {
      failedMessages.forEach((msg, index) => {
        const customer = msg.customers
        console.log(`${index + 1}. ${customer.first_name} ${customer.last_name} (${customer.mobile_number})`)
        console.log(`   Error: ${msg.error_message || 'Unknown error'}`)
        console.log(`   Failed at: ${new Date(msg.created_at).toLocaleString('en-GB')}`)
      })
    } else {
      console.log('   ✅ No failed messages')
    }

    // 4. Check jobs queue for SMS tasks
    const { data: smsJobs, error: jobsError } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'send_sms')
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: true })

    console.log(`\n\n⚙️  SMS JOBS IN QUEUE: ${smsJobs?.length || 0}`)
    console.log('-' * 60)

    if (smsJobs && smsJobs.length > 0) {
      smsJobs.forEach((job, index) => {
        console.log(`${index + 1}. Job ID: ${job.id}`)
        console.log(`   Status: ${job.status}`)
        console.log(`   Created: ${new Date(job.created_at).toLocaleString('en-GB')}`)
        if (job.scheduled_for) {
          console.log(`   Scheduled for: ${new Date(job.scheduled_for).toLocaleString('en-GB')}`)
        }
      })
    } else {
      console.log('   ✅ No pending SMS jobs')
    }

    // 5. Summary statistics
    const { data: stats } = await supabase
      .from('messages')
      .select('status')

    const statusCounts = stats?.reduce((acc, msg) => {
      acc[msg.status] = (acc[msg.status] || 0) + 1
      return acc
    }, {} as Record<string, number>) || {}

    console.log(`\n\n📊 MESSAGE STATISTICS:`)
    console.log('-' * 60)
    console.log(`   Total Messages: ${stats?.length || 0}`)
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`)
    })

    // 6. Check for customers with SMS issues
    const { data: problemCustomers } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, messaging_status, sms_delivery_failures')
      .or('messaging_status.neq.active,sms_delivery_failures.gt.0')
      .limit(10)

    if (problemCustomers && problemCustomers.length > 0) {
      console.log(`\n\n⚠️  CUSTOMERS WITH SMS ISSUES:`)
      console.log('-' * 60)
      problemCustomers.forEach((customer, index) => {
        console.log(`${index + 1}. ${customer.first_name} ${customer.last_name}`)
        console.log(`   Phone: ${customer.mobile_number}`)
        console.log(`   Status: ${customer.messaging_status}`)
        console.log(`   Failures: ${customer.sms_delivery_failures}`)
      })
    }

    console.log('\n' + '=' * 60)
    console.log('✅ SMS Queue check complete')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

// Run the script
checkSmsQueue().catch(console.error)