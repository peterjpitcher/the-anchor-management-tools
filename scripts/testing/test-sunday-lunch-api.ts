#!/usr/bin/env tsx
/**
 * Sunday lunch API v2 diagnostics (simplified menu selections).
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

function resolveBookingUrl(baseUrl: string): string {
  return `${baseUrl}/api/table-bookings`
}

function resolveMenuUrl(baseUrl: string, date: string): string {
  return `${baseUrl}/api/table-bookings/menu/sunday-lunch?date=${encodeURIComponent(date)}`
}

function assertSendAllowed(params: { baseUrl: string }) {
  if (!isFlagPresent('--confirm')) {
    throw new Error('Send blocked: missing --confirm')
  }

  assertScriptMutationAllowed({
    scriptName: 'test-sunday-lunch-api',
    envVar: 'RUN_TEST_TABLE_BOOKING_API_SEND',
  })
  assertScriptMutationAllowed({
    scriptName: 'test-sunday-lunch-api',
    envVar: 'ALLOW_TEST_TABLE_BOOKING_API_SEND',
  })

  const hostname = new URL(params.baseUrl).hostname.toLowerCase()
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  if (!isLocal) {
    assertScriptMutationAllowed({
      scriptName: 'test-sunday-lunch-api',
      envVar: 'ALLOW_TEST_TABLE_BOOKING_API_REMOTE',
    })

    const isProd = hostname.endsWith('orangejelly.co.uk')
    if (isProd) {
      if (!isFlagPresent('--prod')) {
        throw new Error('Send blocked: refusing to run against production without --prod')
      }
      assertScriptMutationAllowed({
        scriptName: 'test-sunday-lunch-api',
        envVar: 'ALLOW_TEST_TABLE_BOOKING_API_PROD',
      })
    }
  }
}

function getNextSundayIsoDate(): string {
  const now = new Date()
  const day = now.getUTCDay() // 0=Sun
  const daysUntilSunday = (7 - day) % 7
  const next = new Date(now.getTime() + (daysUntilSunday === 0 ? 7 : daysUntilSunday) * 24 * 60 * 60 * 1000)
  return next.toISOString().split('T')[0]
}

function buildIdempotencyKey(params: {
  date: string
  time: string
  phone: string
  menuItemId: string
}): string {
  const raw = ['test-sunday-lunch-api', params.date, params.time, params.phone, params.menuItemId].join(':')
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return await response.text().catch(() => null)
  }
}

async function fetchMenu(params: { baseUrl: string; date: string; apiKey: string }) {
  const url = resolveMenuUrl(params.baseUrl, params.date)
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-API-Key': params.apiKey,
    },
  })

  const data = await parseJsonSafe(response)
  console.log(`Menu response: ${response.status} ${response.statusText}`)
  console.log('Menu payload:', JSON.stringify(data, null, 2))

  if (!response.ok) {
    throw new Error(`Menu fetch failed (${response.status})`)
  }
}

async function run() {
  console.log('Sunday lunch API v2 diagnostics\n')

  const baseUrl = resolveBaseUrl()
  const bookingUrl = resolveBookingUrl(baseUrl)
  const apiKey = process.env.TEST_API_KEY
  const limit = parsePositiveInt(getArgValue('--limit'))

  const date = getArgValue('--date') ?? process.env.TEST_SUNDAY_LUNCH_DATE ?? getNextSundayIsoDate()
  const time = getArgValue('--time') ?? process.env.TEST_SUNDAY_LUNCH_TIME ?? '13:00'
  const partySizeRaw = getArgValue('--party-size')
  const partySize = partySizeRaw ? Number(partySizeRaw) : 1
  const phone = getArgValue('--phone') ?? process.env.TEST_PHONE_NUMBER ?? null
  const menuItemId =
    getArgValue('--menu-item-id') ?? process.env.TEST_SUNDAY_LUNCH_MENU_ITEM_ID ?? null
  const shouldFetchMenu = isFlagPresent('--fetch-menu')

  if (!Number.isFinite(partySize) || partySize <= 0) {
    throw new Error(`Invalid --party-size: ${partySizeRaw ?? '(missing)'}`)
  }

  console.log(`Target booking URL: ${bookingUrl}`)
  console.log(`API key: ${apiKey ? '✅ Set' : '❌ Missing'} (${maskSecret(apiKey)})`)
  console.log(`Cap (--limit): ${limit ?? '(missing)'} (hard cap ${HARD_CAP})`)
  console.log(`Date: ${date}`)
  console.log(`Time: ${time}`)
  console.log(`Party size: ${partySize}`)
  console.log(`Phone: ${maskPhone(phone)}`)
  console.log(`Menu item: ${menuItemId ?? '(missing)'} (set --menu-item-id or TEST_SUNDAY_LUNCH_MENU_ITEM_ID)`)
  console.log(`Fetch menu: ${shouldFetchMenu ? 'yes' : 'no'} (--fetch-menu)`)
  console.log(`Mode: ${isFlagPresent('--confirm') ? 'CONFIRM (dangerous)' : 'DRY RUN (safe)'}`)
  console.log('')

  if (!isFlagPresent('--confirm')) {
    console.log('Dry run mode: no POST request was sent.')
    console.log('')
    console.log('To execute a real booking request (dangerous), you must:')
    console.log('1. Pass --confirm')
    console.log('2. Provide --limit 1 (hard cap 1)')
    console.log('3. Provide --phone (or set TEST_PHONE_NUMBER)')
    console.log('4. Provide --menu-item-id (or set TEST_SUNDAY_LUNCH_MENU_ITEM_ID)')
    console.log('5. Set env gates:')
    console.log('   RUN_TEST_TABLE_BOOKING_API_SEND=true')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_SEND=true')
    console.log('6. If targeting a remote URL, also set:')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_REMOTE=true')
    console.log('7. If targeting production, also pass --prod and set:')
    console.log('   ALLOW_TEST_TABLE_BOOKING_API_PROD=true')
    console.log('')
    console.log('Optional read-only menu fetch:')
    console.log('- Pass --fetch-menu (requires TEST_API_KEY)')
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

  if (shouldFetchMenu) {
    console.log('Fetching Sunday lunch menu (read-only)...\n')
    await fetchMenu({ baseUrl, date, apiKey: resolvedApiKey })
    console.log('')
  }

  const resolvedPhone = requireEnv('TEST_PHONE_NUMBER (or --phone)', phone ?? undefined)
  const resolvedMenuItemId = requireEnv(
    'TEST_SUNDAY_LUNCH_MENU_ITEM_ID (or --menu-item-id)',
    menuItemId ?? undefined
  )

  const bookingPayload = {
    booking_type: 'sunday_lunch',
    date,
    time,
    party_size: partySize,
    customer: {
      first_name: 'Test',
      last_name: 'User',
      mobile_number: resolvedPhone,
      sms_opt_in: false,
    },
    menu_selections: [
      {
        menu_item_id: resolvedMenuItemId,
        quantity: 1,
        guest_name: 'Guest 1',
      },
    ],
    source: 'api_test',
  }

  const idempotencyKey = buildIdempotencyKey({
    date,
    time,
    phone: resolvedPhone,
    menuItemId: resolvedMenuItemId,
  })

  console.log('Sending Sunday lunch booking request...\n')

  const response = await fetch(bookingUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': resolvedApiKey,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(bookingPayload),
  })

  const result = await parseJsonSafe(response)

  if (response.ok) {
    console.log('✅ Booking created successfully.')
  } else {
    console.log('❌ Booking creation failed.')
  }

  console.log(`Response: ${response.status} ${response.statusText}`)
  console.log('Payload:', JSON.stringify(result, null, 2))

  if (!response.ok) {
    // Preserve the historical troubleshooting hint (but fail closed).
    const errorCode = (() => {
      if (typeof result !== 'object' || result === null) return undefined
      const error = (result as { error?: { code?: unknown } }).error
      const code = error?.code
      return typeof code === 'string' ? code : undefined
    })()
    if (errorCode === 'VALIDATION_ERROR') {
      console.log('\nValidation error returned. If it complains about `item_type` or `price_at_booking`,')
      console.log('the simplified v2 payload may not be deployed yet.')
    }
    throw new Error(`Sunday lunch booking request failed (${response.status})`)
  }
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
