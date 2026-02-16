#!/usr/bin/env tsx
/**
 * Booking initiation API diagnostics.
 *
 * Safety note:
 * - This script can trigger booking creation and outbound SMS via the API.
 * - It MUST fail closed by default and require explicit send gating.
 */

import dotenv from 'dotenv'
import path from 'path'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

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

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return await response.text().catch(() => null)
  }
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
  // Preserve the historical endpoint path; keep it relative so scripts never default to prod.
  return `${baseUrl}/api/bookings/initiate`
}

function assertSendAllowed(params: { baseUrl: string }) {
  if (!isFlagPresent('--confirm')) {
    throw new Error('Send blocked: missing --confirm')
  }

  assertScriptMutationAllowed({
    scriptName: 'test-booking-api',
    envVar: 'RUN_TEST_BOOKING_API_SEND',
  })
  assertScriptMutationAllowed({
    scriptName: 'test-booking-api',
    envVar: 'ALLOW_TEST_BOOKING_API_SEND',
  })

  const hostname = new URL(params.baseUrl).hostname.toLowerCase()
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  if (!isLocal) {
    assertScriptMutationAllowed({
      scriptName: 'test-booking-api',
      envVar: 'ALLOW_TEST_BOOKING_API_REMOTE',
    })

    const isProd = hostname.endsWith('orangejelly.co.uk')
    if (isProd) {
      if (!isFlagPresent('--prod')) {
        throw new Error('Send blocked: refusing to run against production without --prod')
      }
      assertScriptMutationAllowed({
        scriptName: 'test-booking-api',
        envVar: 'ALLOW_TEST_BOOKING_API_PROD',
      })
    }
  }
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function parseSendLimit(value: string | null): number | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid --limit value: ${value}`)
  }

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${value}`)
  }

  return parsed
}

function assertSendLimit(limit: number | null): number {
  const hardCap = 1

  if (limit === null) {
    throw new Error(`Send blocked: missing --limit ${hardCap} (explicit cap required)`)
  }

  if (limit > hardCap) {
    throw new Error(`Send blocked: --limit exceeds hard cap ${hardCap}`)
  }

  if (limit < hardCap) {
    throw new Error(`Send blocked: --limit must be ${hardCap}`)
  }

  return limit
}

async function run() {
  console.log('Booking initiation API diagnostics\n')

  const baseUrl = resolveBaseUrl()
  const apiUrl = resolveTargetUrl(baseUrl)
  const eventId = getArgValue('--event-id') ?? process.env.TEST_EVENT_ID ?? null
  const phone = getArgValue('--phone') ?? process.env.TEST_PHONE_NUMBER ?? null
  const limitOverride = parseSendLimit(getArgValue('--limit'))
  const apiKey = process.env.TEST_API_KEY

  console.log(`Target: ${apiUrl}`)
  console.log(`API key: ${apiKey ? '✅ Set' : '❌ Missing'} (${maskSecret(apiKey)})`)
  console.log(`Event ID: ${eventId ?? '(missing)'}`)
  console.log(`Phone: ${maskPhone(phone)}`)
  console.log('')

  if (!isFlagPresent('--confirm')) {
    console.log('Dry run mode: no request was sent.')
    console.log('')
    console.log('To execute a real request (dangerous), you must:')
    console.log('1. Pass --confirm')
    console.log('2. Provide --limit=1 (explicit cap)')
    console.log('3. Provide --event-id and --phone (or set TEST_EVENT_ID/TEST_PHONE_NUMBER)')
    console.log('4. Set env gates:')
    console.log('   RUN_TEST_BOOKING_API_SEND=true')
    console.log('   ALLOW_TEST_BOOKING_API_SEND=true')
    console.log('5. If targeting a remote URL, also set:')
    console.log('   ALLOW_TEST_BOOKING_API_REMOTE=true')
    console.log('6. If targeting production, also pass --prod and set:')
    console.log('   ALLOW_TEST_BOOKING_API_PROD=true')
    return
  }

  assertSendAllowed({ baseUrl })
  assertSendLimit(limitOverride)

  const resolvedApiKey = requireEnv('TEST_API_KEY', apiKey)
  const resolvedEventId = requireEnv('TEST_EVENT_ID (or --event-id)', eventId ?? undefined)
  const resolvedPhone = requireEnv('TEST_PHONE_NUMBER (or --phone)', phone ?? undefined)

  console.log('Sending booking initiation request...\n')

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolvedApiKey}`,
      'X-API-Key': resolvedApiKey,
    },
    body: JSON.stringify({
      event_id: resolvedEventId,
      mobile_number: resolvedPhone,
    }),
  })

  const responseData = await parseJsonSafe(response)

  console.log(`Response: ${response.status} ${response.statusText}`)
  console.log('Payload:', JSON.stringify(responseData, null, 2))

  if (!response.ok) {
    throw new Error(`Booking initiation failed (${response.status})`)
  }

  console.log('\n✅ Booking initiation request completed.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
