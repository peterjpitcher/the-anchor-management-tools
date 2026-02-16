#!/usr/bin/env tsx
/**
 * Sunday lunch payment URL diagnostics.
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

const HARD_CAP = 1

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
    scriptName: 'test-sunday-lunch-payment-fix',
    envVar: 'RUN_TEST_TABLE_BOOKING_API_SEND',
  })
  assertScriptMutationAllowed({
    scriptName: 'test-sunday-lunch-payment-fix',
    envVar: 'ALLOW_TEST_TABLE_BOOKING_API_SEND',
  })

  const hostname = new URL(params.baseUrl).hostname.toLowerCase()
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  if (!isLocal) {
    assertScriptMutationAllowed({
      scriptName: 'test-sunday-lunch-payment-fix',
      envVar: 'ALLOW_TEST_TABLE_BOOKING_API_REMOTE',
    })

    const isProd = hostname.endsWith('orangejelly.co.uk')
    if (isProd) {
      if (!isFlagPresent('--prod')) {
        throw new Error('Send blocked: refusing to run against production without --prod')
      }
      assertScriptMutationAllowed({
        scriptName: 'test-sunday-lunch-payment-fix',
        envVar: 'ALLOW_TEST_TABLE_BOOKING_API_PROD',
      })
    }
  }
}

function getNextSundayIsoDate(): string {
  const now = new Date()
  const day = now.getUTCDay()
  const daysUntilSunday = (7 - day) % 7
  const next = new Date(now.getTime() + (daysUntilSunday === 0 ? 7 : daysUntilSunday) * 24 * 60 * 60 * 1000)
  return next.toISOString().split('T')[0]
}

function buildIdempotencyKey(params: { date: string; time: string; phone: string; partySize: number }): string {
  const raw = ['test-sunday-lunch-payment-fix', params.date, params.time, params.phone, String(params.partySize)].join(':')
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return await response.text().catch(() => null)
  }
}

async function run() {
  console.log('Sunday lunch payment URL diagnostics\n')

  const baseUrl = resolveBaseUrl()
  const apiUrl = resolveTargetUrl(baseUrl)
  const apiKey = process.env.TEST_API_KEY
  const limit = parsePositiveInt(getArgValue('--limit'))

  const date = getArgValue('--date') ?? process.env.TEST_SUNDAY_LUNCH_DATE ?? getNextSundayIsoDate()
  const time = getArgValue('--time') ?? process.env.TEST_SUNDAY_LUNCH_TIME ?? '13:00'
  const partySizeRaw = getArgValue('--party-size')
  const partySize = partySizeRaw ? Number(partySizeRaw) : 2
  const phone = getArgValue('--phone') ?? process.env.TEST_PHONE_NUMBER ?? null

  if (!Number.isFinite(partySize) || partySize <= 0) {
    throw new Error(`Invalid --party-size: ${partySizeRaw ?? '(missing)'}`)
  }

  console.log(`Target: ${apiUrl}`)
  console.log(`API key: ${apiKey ? '✅ Set' : '❌ Missing'} (${maskSecret(apiKey)})`)
  console.log(`Cap (--limit): ${limit ?? '(missing)'} (hard cap ${HARD_CAP})`)
  console.log(`Date: ${date} at ${time}`)
  console.log(`Party size: ${partySize}`)
  console.log(`Phone: ${maskPhone(phone)}`)
  console.log(`Mode: ${isFlagPresent('--confirm') ? 'CONFIRM (dangerous)' : 'DRY RUN (safe)'}`)
  console.log('')

  const bookingPayload = {
    booking_type: 'sunday_lunch',
    date,
    time,
    party_size: partySize,
    customer: {
      first_name: 'Test',
      last_name: 'Customer',
      mobile_number: phone ?? '(missing)',
      sms_opt_in: false,
    },
    menu_selections: [
      {
        custom_item_name: 'Roasted Chicken',
        item_type: 'main',
        quantity: 1,
        guest_name: 'Guest 1',
        price_at_booking: 14.99,
      },
      {
        custom_item_name: 'Slow-Cooked Lamb Shank',
        item_type: 'main',
        quantity: 1,
        guest_name: 'Guest 2',
        price_at_booking: 15.49,
      },
    ],
    special_requirements: 'API Test - Please ignore',
    source: 'api_test',
  }

  const expectedTotal = bookingPayload.menu_selections.reduce((sum, item) => sum + item.price_at_booking, 0)
  console.log('Planned request summary:')
  console.log(`- Menu items: ${bookingPayload.menu_selections.length}`)
  console.log(`- Total order value: £${expectedTotal.toFixed(2)}`)
  console.log(`- Expected deposit (heuristic): £${(partySize * 5).toFixed(2)}`)
  console.log('')

  if (!isFlagPresent('--confirm')) {
    console.log('Dry run mode: no request was sent.')
    console.log('')
    console.log('To execute a real request (dangerous), you must:')
    console.log('1. Pass --confirm')
    console.log('2. Provide --limit 1 (hard cap 1)')
    console.log('3. Provide --phone (or set TEST_PHONE_NUMBER)')
    console.log('4. Set env gates:')
    console.log('   RUN_TEST_TABLE_BOOKING_API_SEND=true')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_SEND=true')
    console.log('5. If targeting a remote URL, also set:')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_REMOTE=true')
    console.log('6. If targeting production, also pass --prod and set:')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_PROD=true')
    return
  }

  assertSendAllowed({ baseUrl })

  if (!limit) {
    throw new Error(`Send blocked: missing --limit 1 (explicit cap required; hard cap ${HARD_CAP})`)
  }
  if (limit > HARD_CAP) {
    throw new Error(`Send blocked: --limit exceeds hard cap ${HARD_CAP}`)
  }

  const resolvedApiKey = requireEnv('TEST_API_KEY', apiKey)
  const resolvedPhone = requireEnv('TEST_PHONE_NUMBER (or --phone)', phone ?? undefined)

  const payload = {
    ...bookingPayload,
    customer: {
      ...bookingPayload.customer,
      mobile_number: resolvedPhone,
    },
  }

  const idempotencyKey = buildIdempotencyKey({ date, time, phone: resolvedPhone, partySize })

  console.log('Sending booking request...\n')

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': resolvedApiKey,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  })

  const data = await parseJsonSafe(response)
  console.log(`Response: ${response.status} ${response.statusText}`)
  console.log('Payload:', JSON.stringify(data, null, 2))

  if (!response.ok) {
    throw new Error(`Booking creation failed (${response.status})`)
  }

  type PaymentDetails = { payment_url?: unknown }
  const paymentDetails: PaymentDetails | null = (() => {
    if (typeof data !== 'object' || data === null) return null
    const root = data as { payment_details?: unknown; data?: { payment_details?: unknown } }
    const candidate = root.payment_details ?? root.data?.payment_details
    if (typeof candidate !== 'object' || candidate === null) return null
    return candidate as PaymentDetails
  })()

  const paymentUrlRaw = paymentDetails?.payment_url
  const paymentUrl =
    typeof paymentUrlRaw === 'string' && paymentUrlRaw.trim().length > 0
      ? paymentUrlRaw
      : null

  if (!paymentUrl) {
    console.log('\n⚠️ No payment_url present in response payload.')
    return
  }

  console.log('\nPayment URL analysis:')
  try {
    const url = new URL(String(paymentUrl))
    console.log(`- Host: ${url.hostname}`)
    console.log(`- Path: ${url.pathname}`)
    if (url.hostname.includes('paypal.com')) {
      console.log('- Type: direct PayPal URL')
    } else if (url.hostname.includes('orangejelly')) {
      console.log('- Type: internal URL (may redirect)')
    } else {
      console.log('- Type: unknown')
    }
  } catch {
    console.log(`- Invalid URL format: ${String(paymentUrl)}`)
  }

  console.log('\n✅ Sunday lunch payment diagnostics completed.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
