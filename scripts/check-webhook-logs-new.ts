#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

async function checkWebhookLogs() {
  // Check for recent webhook logs
  const { data: logs, error } = await supabase
    .from('webhook_logs')
    .select('*')
    .eq('webhook_type', 'twilio')
    .order('processed_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Recent Twilio Webhook Logs:')
  console.log('=' .repeat(60))
  
  if (!logs || logs.length === 0) {
    console.log('No webhook logs found')
    return
  }
  
  logs.forEach(log => {
    console.log(`\nDate: ${new Date(log.processed_at).toLocaleString('en-GB')}`)
    console.log(`Status: ${log.status}`)
    console.log(`Message SID: ${log.message_sid}`)
    console.log(`From: ${log.from_number}`)
    console.log(`To: ${log.to_number}`)
    if (log.error_message) {
      console.log(`Error: ${log.error_message}`)
    }
    if (log.params?.MessageStatus) {
      console.log(`Twilio Status: ${log.params.MessageStatus}`)
    }
    if (log.params?.Body) {
      console.log(`Message Body: ${log.params.Body.substring(0, 50)}...`)
    }
  })

  // Check for specific messages
  console.log('\n' + '=' .repeat(60))
  console.log('Checking for status updates on stuck messages:')
  
  const stuckMessageNumbers = ['+447990587315', '+447956315214']
  
  for (const number of stuckMessageNumbers) {
    const { data: numberLogs } = await supabase
      .from('webhook_logs')
      .select('*')
      .or(`to_number.eq.${number},from_number.eq.${number}`)
      .order('processed_at', { ascending: false })
      .limit(5)
    
    console.log(`\nLogs for ${number}:`)
    if (!numberLogs || numberLogs.length === 0) {
      console.log('  No logs found')
    } else {
      numberLogs.forEach(log => {
        console.log(`  ${new Date(log.processed_at).toLocaleString('en-GB')} - ${log.status} - ${log.params?.MessageStatus || 'N/A'}`)
      })
    }
  }
}

checkWebhookLogs().catch(console.error)