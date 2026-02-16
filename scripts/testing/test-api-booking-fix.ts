#!/usr/bin/env tsx
/**
 * Table booking API diagnostics.
 *
 * Safety note:
 * - This script can create bookings and trigger outbound side effects (SMS/email).
 * - It MUST be dry-run by default and require explicit multi-gating to POST.
 */

import { createHash } from 'node:crypto'
import dotenv from 'dotenv'
import path from 'path'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 2

function maskSecret(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '(missing)'
  return '***'
}

function maskPhone(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '(missing)'
  const trimmed = value.trim()
  if (trimmed.length <= 6) return '***'
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-4)}`
}

function getArgValue(flag: string): string | null {
  const eq = process.argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    return eq.split('=').slice(1).join('=') || null
  }
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  const value = process.argv[idx + 1]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isFlagPresent(flag: string): boolean {
  return process.argv.includes(flag)
}

function parsePositiveInt(raw: string | null): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid positive integer: ${raw}`)
  }
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function resolveBaseUrl(): string {
  const argUrl = getArgValue('--url')
  const baseUrl = argUrl ?? 'http://localhost:3000'
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error(`Invalid --url value: ${baseUrl}`)
  }
  return url.toString().replace(/\/$/, '')
}

function resolveTargetUrl(baseUrl: string): string {
  return `${baseUrl}/api/table-bookings`
}

function assertSendAllowed(params: { baseUrl: string }) {
  if (!isFlagPresent('--confirm')) {
    throw new Error('Send blocked: missing --confirm')
  }

  assertScriptMutationAllowed({
    scriptName: 'test-api-booking-fix',
    envVar: 'RUN_TEST_TABLE_BOOKING_API_SEND',
  })
  assertScriptMutationAllowed({
    scriptName: 'test-api-booking-fix',
    envVar: 'ALLOW_TEST_TABLE_BOOKING_API_SEND',
  })

  const hostname = new URL(params.baseUrl).hostname.toLowerCase()
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  if (!isLocal) {
    assertScriptMutationAllowed({
      scriptName: 'test-api-booking-fix',
      envVar: 'ALLOW_TEST_TABLE_BOOKING_API_REMOTE',
    })

    const isProd = hostname.endsWith('orangejelly.co.uk')
    if (isProd) {
      if (!isFlagPresent('--prod')) {
        throw new Error('Send blocked: refusing to run against production without --prod')
      }
      assertScriptMutationAllowed({
        scriptName: 'test-api-booking-fix',
        envVar: 'ALLOW_TEST_TABLE_BOOKING_API_PROD',
      })
    }
  }
}

function buildIdempotencyKey(params: {
  bookingType: string
  date: string
  time: string
  phone: string
  partySize: number
}): string {
  const raw = [
    'test-api-booking-fix',
    params.bookingType,
    params.date,
    params.time,
    String(params.partySize),
    params.phone,
  ].join(':')
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

function toIsoDate(date: Date): string {
  // Use UTC date-only to keep idempotency stable across timezones.
  return date.toISOString().split('T')[0]
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return await response.text().catch(() => null)
  }
}

async function run() {
  console.log('Table booking API diagnostics\n')

  const baseUrl = resolveBaseUrl()
  const apiUrl = resolveTargetUrl(baseUrl)
  const apiKey = process.env.TEST_API_KEY
  const phone = getArgValue('--phone') ?? process.env.TEST_PHONE_NUMBER ?? null
  const includeOptional = isFlagPresent('--include-optional')
  const plannedRequests = includeOptional ? 2 : 1
  const limit = parsePositiveInt(getArgValue('--limit'))

  console.log(`Target: ${apiUrl}`)
  console.log(`API key: ${apiKey ? '✅ Set' : '❌ Missing'} (${maskSecret(apiKey)})`)
  console.log(`Phone: ${maskPhone(phone)}`)
  console.log(`Planned booking request(s): ${plannedRequests} (--include-optional=${includeOptional ? 'yes' : 'no'})`)
  console.log(`Cap (--limit): ${limit ?? '(missing)'} (hard cap ${HARD_CAP})`)
  console.log(`Mode: ${isFlagPresent('--confirm') ? 'CONFIRM (dangerous)' : 'DRY RUN (safe)'}`)
  if (includeOptional) {
    console.log('Optional fields test: enabled (--include-optional)')
  }
  console.log('')

  if (!isFlagPresent('--confirm')) {
    console.log('Dry run mode: no request was sent.')
    console.log('')
    console.log('To execute a real request (dangerous), you must:')
    console.log('1. Pass --confirm')
    console.log(`2. Provide --limit ${plannedRequests} (hard cap ${HARD_CAP})`)
    console.log('3. Provide --phone (or set TEST_PHONE_NUMBER)')
    console.log('4. Set env gates:')
    console.log('   RUN_TEST_TABLE_BOOKING_API_SEND=true')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_SEND=true')
    console.log('5. If targeting a remote URL, also set:')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_REMOTE=true')
    console.log('6. If targeting production, also pass --prod and set:')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_PROD=true')
    console.log('')
    console.log('Optional second request:')
    console.log('- Pass --include-optional (still requires the same gates)')
    return
  }

  assertSendAllowed({ baseUrl })

  if (!limit) {
    throw new Error(`Send blocked: missing --limit ${plannedRequests} (explicit cap required; hard cap ${HARD_CAP})`)
  }
  if (limit > HARD_CAP) {
    throw new Error(`Send blocked: --limit exceeds hard cap ${HARD_CAP}`)
  }
  if (plannedRequests > limit) {
    throw new Error(`Send blocked: planned requests (${plannedRequests}) exceeds --limit (${limit})`)
  }

  const resolvedApiKey = requireEnv('TEST_API_KEY', apiKey)
  const resolvedPhone = requireEnv('TEST_PHONE_NUMBER (or --phone)', phone ?? undefined)

  const bookingDate = toIsoDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
  const bookingTime = '19:00'

  const bookingPayload = {
    booking_type: 'regular',
    date: bookingDate,
    time: bookingTime,
    party_size: 2,
    duration_minutes: 120,
    customer: {
      first_name: 'Test',
      last_name: 'User',
      mobile_number: resolvedPhone,
      sms_opt_in: false,
    },
    source: 'website',
  }

  const idempotencyKey = buildIdempotencyKey({
    bookingType: bookingPayload.booking_type,
    date: bookingPayload.date,
    time: bookingPayload.time,
    phone: resolvedPhone,
    partySize: bookingPayload.party_size,
  })

  console.log('Sending booking request...\n')

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': resolvedApiKey,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(bookingPayload),
  })

  const responseData = await parseJsonSafe(response)
  console.log(`Response: ${response.status} ${response.statusText}`)
  console.log('Payload:', JSON.stringify(responseData, null, 2))

  if (!response.ok) {
    throw new Error(`Booking creation failed (${response.status})`)
  }

  if (!includeOptional) {
    console.log('\n✅ Booking request completed.')
    return
  }

  const bookingPayloadOptional = {
    booking_type: 'regular',
    date: toIsoDate(new Date(Date.now() + 48 * 60 * 60 * 1000)),
    time: '20:00',
    party_size: 4,
    customer: {
      first_name: 'John',
      last_name: 'Smith',
      mobile_number: resolvedPhone,
      sms_opt_in: false,
    },
    special_requirements: 'Window table please',
    dietary_requirements: ['Vegetarian', 'Gluten free'],
    allergies: ['Nuts'],
    celebration_type: 'birthday',
    source: 'website',
  }

  const idempotencyKeyOptional = buildIdempotencyKey({
    bookingType: bookingPayloadOptional.booking_type,
    date: bookingPayloadOptional.date,
    time: bookingPayloadOptional.time,
    phone: resolvedPhone,
    partySize: bookingPayloadOptional.party_size,
  })

  console.log('\nSending optional-fields booking request...\n')

  const responseOptional = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': resolvedApiKey,
      'Idempotency-Key': idempotencyKeyOptional,
    },
    body: JSON.stringify(bookingPayloadOptional),
  })

  const responseOptionalData = await parseJsonSafe(responseOptional)
  console.log(`Response: ${responseOptional.status} ${responseOptional.statusText}`)
  console.log('Payload:', JSON.stringify(responseOptionalData, null, 2))

  if (!responseOptional.ok) {
    throw new Error(`Optional-fields booking creation failed (${responseOptional.status})`)
  }

  console.log('\n✅ Booking requests completed.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
