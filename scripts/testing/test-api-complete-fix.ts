#!/usr/bin/env tsx
/**
 * Comprehensive table booking API diagnostics.
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

type TestName = 'basic' | 'full' | 'existing' | 'invalid'
const HARD_CAP_MAX_REQUESTS = 4

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
  const withEqualsPrefix = `${flag}=`
  for (let i = 0; i < process.argv.length; i += 1) {
    const entry = process.argv[i]
    if (entry === flag) {
      const value = process.argv[i + 1]
      return typeof value === 'string' && value.length > 0 ? value : null
    }

    if (typeof entry === 'string' && entry.startsWith(withEqualsPrefix)) {
      const value = entry.slice(withEqualsPrefix.length)
      return value.length > 0 ? value : null
    }
  }

  return null
}

function isFlagPresent(flag: string): boolean {
  return process.argv.includes(flag)
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
    scriptName: 'test-api-complete-fix',
    envVar: 'RUN_TEST_API_COMPLETE_FIX_SEND',
  })
  assertScriptMutationAllowed({
    scriptName: 'test-api-complete-fix',
    envVar: 'ALLOW_TEST_API_COMPLETE_FIX_SEND',
  })

  const hostname = new URL(params.baseUrl).hostname.toLowerCase()
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  if (!isLocal) {
    assertScriptMutationAllowed({
      scriptName: 'test-api-complete-fix',
      envVar: 'ALLOW_TEST_API_COMPLETE_FIX_REMOTE',
    })

    const isProd = hostname.endsWith('orangejelly.co.uk')
    if (isProd) {
      if (!isFlagPresent('--prod')) {
        throw new Error('Send blocked: refusing to run against production without --prod')
      }
      assertScriptMutationAllowed({
        scriptName: 'test-api-complete-fix',
        envVar: 'ALLOW_TEST_API_COMPLETE_FIX_PROD',
      })
    }
  }
}

function parseTestList(value: string | null): Array<TestName> {
  if (!value) {
    return []
  }
  const tokens = value
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const allowed = new Set<TestName>(['basic', 'full', 'existing', 'invalid'])
  const result: Array<TestName> = []
  for (const token of tokens) {
    if (!allowed.has(token as TestName)) {
      throw new Error(`Invalid --run token: ${token}`)
    }
    result.push(token as TestName)
  }
  return Array.from(new Set(result))
}

function parseMaxBookings(value: string | null, maxAllowed: number): number {
  if (!value) {
    throw new Error('Missing required --max-bookings (explicit cap required)')
  }
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid --max-bookings: ${value}`)
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --max-bookings: ${value}`)
  }
  if (parsed > maxAllowed) {
    throw new Error(`--max-bookings exceeds hard cap (max ${maxAllowed})`)
  }
  return parsed
}

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function buildIdempotencyKey(params: {
  testName: TestName
  date: string
  time: string
  phone: string
  partySize: number
}): string {
  const raw = [
    'test-api-complete-fix',
    params.testName,
    params.date,
    params.time,
    String(params.partySize),
    params.phone,
  ].join(':')
  return createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return await response.text().catch(() => null)
  }
}

async function postBooking(params: {
  apiUrl: string
  apiKey: string
  idempotencyKey: string
  payload: unknown
}) {
  const response = await fetch(params.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': params.apiKey,
      'Idempotency-Key': params.idempotencyKey,
    },
    body: JSON.stringify(params.payload),
  })

  const data = await parseJsonSafe(response)
  return { response, data }
}

async function run() {
  console.log('Table booking API comprehensive diagnostics\n')

  const baseUrl = resolveBaseUrl()
  const apiUrl = resolveTargetUrl(baseUrl)

  const apiKey = process.env.TEST_API_KEY
  const phone = getArgValue('--phone') ?? process.env.TEST_PHONE_NUMBER ?? null

  const runList = parseTestList(getArgValue('--run'))
  const maxBookingsRaw = getArgValue('--max-bookings')

  console.log(`Target: ${apiUrl}`)
  console.log(`API key: ${apiKey ? '✅ Set' : '❌ Missing'} (${maskSecret(apiKey)})`)
  console.log(`Phone: ${maskPhone(phone)}`)
  console.log(`Run list: ${runList.length > 0 ? runList.join(', ') : '(none)'} (set --run)`)
  console.log(`Mode: ${isFlagPresent('--confirm') ? 'CONFIRM (dangerous)' : 'DRY RUN (safe)'}`)
  console.log('')

  if (!isFlagPresent('--confirm')) {
    console.log('Dry run mode: no requests were sent.')
    console.log('')
    console.log('To execute real requests (dangerous), you must:')
    console.log('1. Pass --confirm')
    console.log('2. Provide --run basic,full,existing,invalid (comma-separated)')
    console.log(`3. Provide --max-bookings N (explicit cap; max ${HARD_CAP_MAX_REQUESTS})`)
    console.log('4. Provide --phone (or set TEST_PHONE_NUMBER)')
    console.log('5. Set env gates:')
    console.log('   RUN_TEST_API_COMPLETE_FIX_SEND=true')
    console.log('   ALLOW_TEST_API_COMPLETE_FIX_SEND=true')
    console.log('6. If targeting a remote URL, also set:')
    console.log('   ALLOW_TEST_API_COMPLETE_FIX_REMOTE=true')
    console.log('7. If targeting production, also pass --prod and set:')
    console.log('   ALLOW_TEST_API_COMPLETE_FIX_PROD=true')
    return
  }

  assertSendAllowed({ baseUrl })

  if (runList.length === 0) {
    throw new Error('No tests selected. Provide --run basic,full,existing,invalid')
  }

  const resolvedApiKey = requireEnv('TEST_API_KEY', apiKey)
  const resolvedPhone = requireEnv('TEST_PHONE_NUMBER (or --phone)', phone ?? undefined)

  const plannedRequests = runList.length
  const cap = parseMaxBookings(maxBookingsRaw, HARD_CAP_MAX_REQUESTS)
  if (plannedRequests > cap) {
    throw new Error(
      `Selected tests would send ${plannedRequests} request(s), exceeding cap ${cap}. Reduce --run list or raise --max-bookings (max ${HARD_CAP_MAX_REQUESTS}).`
    )
  }

  const results: Array<{ name: TestName; ok: boolean; status: number }> = []

  for (const testName of runList) {
    if (testName === 'basic') {
      console.log('TEST: basic booking')
      const payload = {
        booking_type: 'regular',
        date: toIsoDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
        time: '19:00',
        party_size: 2,
        customer: {
          first_name: 'API',
          last_name: 'Test',
          mobile_number: resolvedPhone,
          sms_opt_in: false,
        },
        source: 'api_test',
      }
      const idempotencyKey = buildIdempotencyKey({
        testName,
        date: payload.date,
        time: payload.time,
        phone: resolvedPhone,
        partySize: payload.party_size,
      })
      const { response, data } = await postBooking({
        apiUrl,
        apiKey: resolvedApiKey,
        idempotencyKey,
        payload,
      })
      console.log(`Response: ${response.status} ${response.statusText}`)
      console.log('Payload:', JSON.stringify(data, null, 2))
      console.log('')
      if (!response.ok) {
        throw new Error(`Basic booking test failed (${response.status})`)
      }
      results.push({ name: testName, ok: true, status: response.status })
      continue
    }

    if (testName === 'full') {
      console.log('TEST: full booking (optional fields)')
      const payload = {
        booking_type: 'regular',
        date: toIsoDate(new Date(Date.now() + 48 * 60 * 60 * 1000)),
        time: '20:00',
        party_size: 4,
        duration_minutes: 150,
        customer: {
          first_name: 'Full',
          last_name: 'Test',
          mobile_number: resolvedPhone,
          sms_opt_in: false,
        },
        special_requirements: 'API Test - please ignore',
        dietary_requirements: ['Vegetarian', 'Gluten free'],
        allergies: ['Nuts'],
        celebration_type: 'anniversary',
        source: 'api_test',
      }
      const idempotencyKey = buildIdempotencyKey({
        testName,
        date: payload.date,
        time: payload.time,
        phone: resolvedPhone,
        partySize: payload.party_size,
      })
      const { response, data } = await postBooking({
        apiUrl,
        apiKey: resolvedApiKey,
        idempotencyKey,
        payload,
      })
      console.log(`Response: ${response.status} ${response.statusText}`)
      console.log('Payload:', JSON.stringify(data, null, 2))
      console.log('')
      if (!response.ok) {
        throw new Error(`Full booking test failed (${response.status})`)
      }
      results.push({ name: testName, ok: true, status: response.status })
      continue
    }

    if (testName === 'existing') {
      console.log('TEST: existing customer booking (reuses phone)')
      const payload = {
        booking_type: 'regular',
        date: toIsoDate(new Date(Date.now() + 72 * 60 * 60 * 1000)),
        time: '18:30',
        party_size: 3,
        customer: {
          first_name: 'API',
          last_name: 'Test',
          mobile_number: resolvedPhone,
          sms_opt_in: false,
        },
        source: 'api_test',
      }
      const idempotencyKey = buildIdempotencyKey({
        testName,
        date: payload.date,
        time: payload.time,
        phone: resolvedPhone,
        partySize: payload.party_size,
      })
      const { response, data } = await postBooking({
        apiUrl,
        apiKey: resolvedApiKey,
        idempotencyKey,
        payload,
      })
      console.log(`Response: ${response.status} ${response.statusText}`)
      console.log('Payload:', JSON.stringify(data, null, 2))
      console.log('')
      if (!response.ok) {
        throw new Error(`Existing customer test failed (${response.status})`)
      }
      results.push({ name: testName, ok: true, status: response.status })
      continue
    }

    if (testName === 'invalid') {
      console.log('TEST: invalid payload rejected')
      const payload = {
        booking_type: 'regular',
        date: '2025-07-32',
        time: '25:00',
        party_size: 0,
        customer: {
          first_name: '',
          last_name: '',
          mobile_number: '123',
          sms_opt_in: false,
        },
        source: 'api_test',
      }
      const idempotencyKey = createHash('sha256')
        .update(['test-api-complete-fix', testName, String(Date.now())].join(':'))
        .digest('hex')
        .slice(0, 32)

      const { response, data } = await postBooking({
        apiUrl,
        apiKey: resolvedApiKey,
        idempotencyKey,
        payload,
      })
      console.log(`Response: ${response.status} ${response.statusText}`)
      console.log('Payload:', JSON.stringify(data, null, 2))
      console.log('')
      if (response.status !== 400) {
        throw new Error(`Invalid payload test expected 400, got ${response.status}`)
      }
      results.push({ name: testName, ok: true, status: response.status })
      continue
    }

    const exhaustive: never = testName
    throw new Error(`Unhandled test name: ${exhaustive}`)
  }

  console.log('========== TEST SUMMARY ==========')
  console.log(`Tests executed: ${results.length}`)
  for (const result of results) {
    console.log(`- ${result.name}: ${result.ok ? 'PASS' : 'FAIL'} (${result.status})`)
  }
  console.log('==================================')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
