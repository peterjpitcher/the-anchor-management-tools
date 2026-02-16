#!/usr/bin/env tsx
/**
 * Deployment verification diagnostics for table booking API.
 *
 * Safety note:
 * - This script can create a booking and trigger outbound side effects (SMS/email).
 * - It MUST be dry-run by default and require explicit multi-gating to POST.
 */

import { createHash } from 'node:crypto'
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
  const idx = process.argv.indexOf(flag)
  if (idx !== -1) {
    const value = process.argv[idx + 1]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const eq = process.argv.find((entry) => entry.startsWith(`${flag}=`))
  if (!eq) return null
  const value = eq.slice(`${flag}=`.length)
  return value.length > 0 ? value : null
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
    scriptName: 'check-deployment-status',
    envVar: 'RUN_CHECK_DEPLOYMENT_STATUS_SEND',
  })
  assertScriptMutationAllowed({
    scriptName: 'check-deployment-status',
    envVar: 'ALLOW_CHECK_DEPLOYMENT_STATUS_SEND',
  })

  const hostname = new URL(params.baseUrl).hostname.toLowerCase()
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1'
  if (!isLocal) {
    assertScriptMutationAllowed({
      scriptName: 'check-deployment-status',
      envVar: 'ALLOW_CHECK_DEPLOYMENT_STATUS_REMOTE',
    })

    const isProd = hostname.endsWith('orangejelly.co.uk')
    if (isProd) {
      if (!isFlagPresent('--prod')) {
        throw new Error('Send blocked: refusing to run against production without --prod')
      }
      assertScriptMutationAllowed({
        scriptName: 'check-deployment-status',
        envVar: 'ALLOW_CHECK_DEPLOYMENT_STATUS_PROD',
      })
    }
  }
}

function readSendLimit(): string | null {
  const arg = getArgValue('--limit')
  if (arg) {
    return arg
  }
  return process.env.CHECK_DEPLOYMENT_STATUS_LIMIT ?? null
}

function assertSendLimit(limitRaw: string | null): number {
  const HARD_CAP = 1
  if (!limitRaw) {
    throw new Error('Send blocked: --limit=1 is required in confirm mode')
  }

  if (!/^[1-9]\d*$/.test(limitRaw)) {
    throw new Error('Send blocked: --limit must be 1 in confirm mode')
  }

  const parsed = Number(limitRaw)
  if (!Number.isInteger(parsed) || parsed !== HARD_CAP) {
    throw new Error('Send blocked: --limit must be 1 in confirm mode')
  }

  return parsed
}

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function parsePartySize(value: string | null): number {
  if (!value) return 2
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --party-size: ${value}`)
  }
  return Math.min(Math.floor(parsed), 20)
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return await response.text().catch(() => null)
  }
}

async function run() {
  console.log('Deployment status diagnostics (table booking API)\n')

  const baseUrl = resolveBaseUrl()
  const apiUrl = resolveTargetUrl(baseUrl)

  const apiKey = process.env.TEST_API_KEY
  const phone = getArgValue('--phone') ?? process.env.TEST_PHONE_NUMBER ?? null
  const partySize = parsePartySize(getArgValue('--party-size'))
  const date = getArgValue('--date') ?? toIsoDate(new Date(Date.now() + 24 * 60 * 60 * 1000))
  const time = getArgValue('--time') ?? '19:00'

  console.log(`Target: ${apiUrl}`)
  console.log(`API key: ${apiKey ? '✅ Set' : '❌ Missing'} (${maskSecret(apiKey)})`)
  console.log(`Date/time: ${date} ${time}`)
  console.log(`Party size: ${partySize}`)
  console.log(`Phone: ${maskPhone(phone)}`)
  console.log(`Mode: ${isFlagPresent('--confirm') ? 'CONFIRM (dangerous)' : 'DRY RUN (safe)'}`)
  console.log('')

  if (!isFlagPresent('--confirm')) {
    console.log('Dry run mode: no request was sent.')
    console.log('')
    console.log('To execute a real request (dangerous), you must:')
    console.log('1. Pass --confirm')
    console.log('2. Pass --limit 1')
    console.log('3. Provide --phone (or set TEST_PHONE_NUMBER)')
    console.log('4. Set env gates:')
    console.log('   RUN_CHECK_DEPLOYMENT_STATUS_SEND=true')
    console.log('   ALLOW_CHECK_DEPLOYMENT_STATUS_SEND=true')
    console.log('5. If targeting a remote URL, also set:')
    console.log('   ALLOW_CHECK_DEPLOYMENT_STATUS_REMOTE=true')
    console.log('6. If targeting production, also pass --prod and set:')
    console.log('   ALLOW_CHECK_DEPLOYMENT_STATUS_PROD=true')
    console.log('')
    console.log('Note: this script creates a booking when confirmed; prefer a staging environment.')
    return
  }

  const sendLimit = assertSendLimit(readSendLimit())
  const plannedRequests = 1
  if (plannedRequests > sendLimit) {
    throw new Error(
      `Send blocked: planned ${plannedRequests} request(s), exceeding --limit ${sendLimit}`
    )
  }

  assertSendAllowed({ baseUrl })

  const resolvedApiKey = requireEnv('TEST_API_KEY', apiKey)
  const resolvedPhone = requireEnv('TEST_PHONE_NUMBER (or --phone)', phone ?? undefined)

  const payload = {
    booking_type: 'regular',
    date,
    time,
    party_size: partySize,
    customer: {
      first_name: 'Deployment',
      last_name: 'Test',
      mobile_number: resolvedPhone,
      sms_opt_in: false,
    },
    source: 'api_test',
  }

  const idempotencyKey = createHash('sha256')
    .update(['check-deployment-status', date, time, String(partySize), resolvedPhone].join(':'))
    .digest('hex')
    .slice(0, 32)

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
    throw new Error(`Deployment status booking request failed (${response.status})`)
  }

  console.log('\n✅ Booking request completed (deployment status check).')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
