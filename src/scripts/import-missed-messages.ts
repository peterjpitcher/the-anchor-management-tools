#!/usr/bin/env tsx

/**
 * Legacy Twilio message backfill script.
 *
 * This script is intentionally READ-ONLY after the SMS spam incident hardening pass.
 * For actual imports, use the authenticated Settings -> Import Messages tool
 * (`src/app/(authenticated)/settings/import-messages`) which includes RBAC + audit logging.
 */

import twilio from 'twilio'
import { config } from 'dotenv'
import { createAdminClient } from '@/lib/supabase/admin'

config({ path: '.env.local' })

function readArgValue(name: string, argv: string[] = process.argv): string | null {
  const direct = argv.find((entry) => entry.startsWith(`${name}=`))
  if (direct) {
    return direct.slice(`${name}=`.length) || null
  }

  const idx = argv.indexOf(name)
  if (idx >= 0 && idx + 1 < argv.length) {
    return argv[idx + 1] || null
  }

  return null
}

function parseRequiredDate(name: string, value: string | null): Date {
  if (!value) {
    throw new Error(`Missing required ${name}. Usage: --start YYYY-MM-DD --end YYYY-MM-DD`)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${name}: ${value}`)
  }

  return parsed
}

function parseLimit(raw: string | null): number {
  if (!raw) {
    return 200
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${raw}`)
  }

  return Math.min(parsed, 1000)
}

async function run(): Promise<void> {
  if (process.argv.includes('--confirm')) {
    throw new Error(
      'This legacy script is read-only. Use the Settings -> Import Messages tool for any backfill/import.'
    )
  }

  const start = parseRequiredDate('--start', readArgValue('--start'))
  const end = parseRequiredDate('--end', readArgValue('--end'))
  if (end.getTime() < start.getTime()) {
    throw new Error('End date must be on or after start date')
  }

  const limit = parseLimit(readArgValue('--limit'))
  const twilioTo =
    readArgValue('--to') || process.env.TWILIO_PHONE_NUMBER || '+447700106752'

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    throw new Error('Missing Twilio environment variables (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)')
  }

  const supabase = createAdminClient()
  const twilioClient = twilio(accountSid, authToken)

  console.log('Legacy import-missed-messages (read-only)')
  console.log(`Range: ${start.toISOString()} -> ${end.toISOString()}`)
  console.log(`Twilio filter to: ${twilioTo}`)
  console.log(`Twilio list limit: ${limit}`)

  const messages = await twilioClient.messages.list({
    to: twilioTo,
    dateSentAfter: start,
    dateSentBefore: end,
    limit,
  })

  const inboundMessages = messages.filter(
    (msg: any) =>
      msg.direction === 'inbound' || (msg.to === twilioTo && msg.from !== twilioTo),
  )

  const messageSids = inboundMessages
    .map((msg: any) => msg.sid)
    .filter((sid: any): sid is string => typeof sid === 'string' && sid.length > 0)

  console.log(`Twilio messages: ${messages.length}`)
  console.log(`Inbound candidate messages: ${inboundMessages.length}`)

  if (messageSids.length === 0) {
    console.log('No message SIDs found in the selected window.')
    return
  }

  const { data: existingMessages, error: existingMessagesError } = await supabase
    .from('messages')
    .select('twilio_message_sid')
    .in('twilio_message_sid', messageSids)

  if (existingMessagesError) {
    throw new Error(`Existing message SID lookup failed: ${existingMessagesError.message}`)
  }

  const existingSids = new Set(
    (existingMessages ?? [])
      .map((row: any) => row.twilio_message_sid)
      .filter((sid: any): sid is string => typeof sid === 'string' && sid.length > 0),
  )

  const missingMessages = inboundMessages.filter((msg: any) => !existingSids.has(msg.sid))
  console.log(`Already in database: ${existingSids.size}`)
  console.log(`Missing in database: ${missingMessages.length}`)

  const phones = new Set<string>()
  for (const msg of missingMessages) {
    if (typeof msg.from === 'string' && msg.from.length > 0) {
      phones.add(msg.from)
    }
  }

  if (phones.size === 0) {
    return
  }

  const phoneList = Array.from(phones)
  const customerSelect = 'id, mobile_number, mobile_e164, mobile_number_raw'

  const { data: customersE164, error: customersE164Error } = await supabase
    .from('customers')
    .select(customerSelect)
    .in('mobile_e164', phoneList)

  if (customersE164Error) {
    throw new Error(`Customer lookup by mobile_e164 failed: ${customersE164Error.message}`)
  }

  const { data: customersMobile, error: customersMobileError } = await supabase
    .from('customers')
    .select(customerSelect)
    .in('mobile_number', phoneList)

  if (customersMobileError) {
    throw new Error(`Customer lookup by mobile_number failed: ${customersMobileError.message}`)
  }

  const { data: customersRaw, error: customersRawError } = await supabase
    .from('customers')
    .select(customerSelect)
    .in('mobile_number_raw', phoneList)

  if (customersRawError) {
    throw new Error(`Customer lookup by mobile_number_raw failed: ${customersRawError.message}`)
  }

  const customerKeys = new Set<string>()
  for (const customer of [
    ...(customersE164 ?? []),
    ...(customersMobile ?? []),
    ...(customersRaw ?? []),
  ]) {
    const keys = [
      customer.mobile_e164,
      customer.mobile_number,
      customer.mobile_number_raw,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0)
    for (const key of keys) {
      customerKeys.add(key)
    }
  }

  const missingCustomers = phoneList.filter((phone) => !customerKeys.has(phone))
  console.log(`Customers referenced by missing messages: ${phoneList.length}`)
  console.log(`Missing customer rows: ${missingCustomers.length}`)
  if (missingCustomers.length > 0) {
    console.log('Sample missing phones:', missingCustomers.slice(0, 5).join(', '))
  }
}

run().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})

