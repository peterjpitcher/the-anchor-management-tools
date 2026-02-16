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
    throw new Error('check-webhook-logs is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('📋 Checking Webhook Logs for PayPal Returns\n')

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data: webhookLogsRows, error: webhookError } = await supabase
    .from('webhook_logs')
    .select('id, created_at, url, response_status, error_message, body')
    .or('url.like.%/payment/return%,body.like.%PayerID%')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10)

  const webhookLogs = (assertScriptQuerySucceeded({
    operation: 'Load recent PayPal return webhook logs',
    error: webhookError,
    data: webhookLogsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    id: string
    created_at: string
    url: string | null
    response_status: number | null
    error_message: string | null
    body: unknown
  }>

  if (webhookLogs.length > 0) {
    console.log(`Found ${webhookLogs.length} PayPal return webhook log(s):\n`)

    webhookLogs.forEach((log) => {
      console.log(`📝 Log ${log.id.substring(0, 8)}...`)
      console.log(`   Time: ${new Date(log.created_at).toLocaleString()}`)
      console.log(`   URL: ${log.url || 'unknown'}`)
      console.log(`   Status: ${log.response_status ?? 'unknown'}`)
      if (log.error_message) {
        console.log(`   Error: ${log.error_message}`)
      }
      if (log.body) {
        try {
          const body = typeof log.body === 'string' ? JSON.parse(log.body) : log.body
          const bookingId = (body as { booking_id?: unknown } | null)?.booking_id
          if (typeof bookingId === 'string' && bookingId.length > 0) {
            console.log(`   Booking ID: ${bookingId}`)
          }
        } catch {
          // Not JSON.
        }
      }
      console.log('')
    })
  } else {
    console.log('No PayPal return webhook logs found')
  }

  console.log('\n📱 Checking for SMS-related errors in logs:\n')

  const { data: errorLogsRows, error: errorLogsError } = await supabase
    .from('webhook_logs')
    .select('id, created_at, error_message')
    .or('error_message.like.%SMS%,error_message.like.%sms%,body.like.%queueBooking%')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10)

  const errorLogs = (assertScriptQuerySucceeded({
    operation: 'Load SMS-related webhook logs',
    error: errorLogsError,
    data: errorLogsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{ created_at: string; error_message: string | null }>

  if (errorLogs.length > 0) {
    console.log(`Found ${errorLogs.length} SMS-related error log(s):`)
    errorLogs.forEach((log) => {
      console.log(`   - ${new Date(log.created_at).toLocaleString()}: ${log.error_message || 'unknown error'}`)
    })
  } else {
    console.log('No SMS-related errors in webhook logs')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Webhook log check completed with failures.')
  } else {
    console.log('\n✅ Webhook log check complete!')
  }
}

void checkWebhookLogs().catch((error) => {
  markFailure('check-webhook-logs failed.', error)
})
