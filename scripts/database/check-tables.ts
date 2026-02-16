#!/usr/bin/env tsx

import { createAdminClient } from '../../src/lib/supabase/admin'
import dotenv from 'dotenv'
import { resolve } from 'path'

const SCRIPT_NAME = 'check-tables'

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`[${SCRIPT_NAME}] ❌ ${message}`, error)
    return
  }
  console.error(`[${SCRIPT_NAME}] ❌ ${message}`)
}

async function checkMessages() {
  dotenv.config({ path: resolve(process.cwd(), '.env.local') })

  console.log('🔍 Checking loyalty welcome messages...\n')

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch (error) {
    markFailure('Missing Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).', error)
    return
  }

  // Check messages table for welcome SMS
  const { data: messages, error } = await supabase
    .from('messages')
    .select(`
      id,
      created_at,
      status,
      twilio_status,
      to_number,
      body,
      message_sid,
      twilio_message_sid,
      customer:customers(first_name, last_name)
    `)
    .like('body', 'Welcome to The Anchor VIP Club%')
    .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    
  if (error) {
    markFailure('Error fetching messages.', error)
    return
  }
  
  console.log('🎉 Loyalty Welcome SMS Messages:')
  console.log('================================\n')
  
  if (!messages || messages.length === 0) {
    console.log('No welcome messages found in the last 2 hours')
  } else {
    messages.forEach((msg: any) => {
      console.log(`📱 Message ID: ${msg.id}`)
      console.log(`   Customer: ${msg.customer?.first_name} ${msg.customer?.last_name}`)
      console.log(`   To: ${msg.to_number}`)
      console.log(`   Status: ${msg.status} / ${msg.twilio_status}`)
      console.log(`   Message SID: ${msg.message_sid}`)
      console.log(`   Twilio SID: ${msg.twilio_message_sid}`)
      console.log(`   Sent: ${new Date(msg.created_at).toLocaleString()}`)
      console.log(`   Message: ${msg.body.substring(0, 80)}...`)
      console.log('')
    })
  }
  
  // Also check for any failed SMS jobs for loyalty
  console.log('\n\n❌ Failed Loyalty SMS Jobs:')
  console.log('============================\n')
  
  const { data: failedJobs, error: failedJobsError } = await supabase
    .from('background_jobs')
    .select('*')
    .eq('status', 'failed')
    .eq('type', 'send_sms')
    .like('payload->message', 'Welcome to The Anchor VIP Club%')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  if (failedJobsError) {
    markFailure('Error fetching failed loyalty send_sms jobs.', failedJobsError)
  }
    
  if (!failedJobs || failedJobs.length === 0) {
    console.log('No failed loyalty SMS jobs')
  } else {
    failedJobs.forEach((job) => {
      console.log(`Job ID: ${job.id}`)
      console.log(`Error: ${job.error}`)
      console.log(`Payload: ${JSON.stringify(job.payload, null, 2)}`)
      console.log('')
    })
  }
}

void checkMessages()
  .then(() => {
    if (process.exitCode === 1) {
      console.log('\n❌ Check complete (with failures)')
      return
    }
    console.log('\n✅ Check complete')
  })
  .catch((error) => {
    markFailure('check-tables failed.', error)
  })
