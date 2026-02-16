#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function checkWebhookLogs() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-webhook-logs-new is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  // Check for recent webhook logs
  const { data: logsRows, error } = await supabase
    .from('webhook_logs')
    .select('*')
    .eq('webhook_type', 'twilio')
    .order('processed_at', { ascending: false })
    .limit(20)

  const logs = (assertScriptQuerySucceeded({
    operation: 'Load recent Twilio webhook logs',
    error,
    data: logsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    processed_at: string
    status: string | null
    message_sid: string | null
    from_number: string | null
    to_number: string | null
    error_message: string | null
    params: Record<string, unknown> | null
  }>

  console.log('Recent Twilio Webhook Logs:')
  console.log('='.repeat(60))
  
  if (!logs || logs.length === 0) {
    console.log('No webhook logs found')
  } else {
    logs.forEach((log) => {
      console.log(`\nDate: ${new Date(log.processed_at).toLocaleString('en-GB')}`)
      console.log(`Status: ${log.status}`)
      console.log(`Message SID: ${log.message_sid}`)
      console.log(`From: ${log.from_number}`)
      console.log(`To: ${log.to_number}`)
      if (log.error_message) {
        console.log(`Error: ${log.error_message}`)
      }

      const params = log.params || {}
      if (typeof params === 'object' && params) {
        const messageStatus = (params as { MessageStatus?: unknown }).MessageStatus
        if (typeof messageStatus === 'string') {
          console.log(`Twilio Status: ${messageStatus}`)
        }

        const body = (params as { Body?: unknown }).Body
        if (typeof body === 'string' && body.length > 0) {
          console.log(`Message Body: ${body.substring(0, 50)}...`)
        }
      }
    })
  }
  
  // Check for specific messages
  console.log('\n' + '='.repeat(60))
  console.log('Checking for status updates on stuck messages:')
  
  const stuckMessageNumbers = ['+447990587315', '+447956315214']
  
  for (const number of stuckMessageNumbers) {
    const { data: numberLogsRows, error: numberError } = await supabase
      .from('webhook_logs')
      .select('*')
      .or(`to_number.eq.${number},from_number.eq.${number}`)
      .order('processed_at', { ascending: false })
      .limit(5)

    if (numberError) {
      markFailure(`Load webhook logs for ${number} failed.`, numberError)
      continue
    }

    const numberLogs = (numberLogsRows ?? []) as Array<{
      processed_at: string
      status: string | null
      params: Record<string, unknown> | null
    }>
    
    console.log(`\nLogs for ${number}:`)
    if (!numberLogs || numberLogs.length === 0) {
      console.log('  No logs found')
    } else {
      numberLogs.forEach((log) => {
        console.log(`  ${new Date(log.processed_at).toLocaleString('en-GB')} - ${log.status} - ${log.params?.MessageStatus || 'N/A'}`)
      })
    }
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Webhook log check completed with failures.')
  } else {
    console.log('\n✅ Webhook log check complete!')
  }
}

void checkWebhookLogs().catch((error) => {
  markFailure('check-webhook-logs-new failed.', error)
})
