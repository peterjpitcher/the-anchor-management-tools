#!/usr/bin/env tsx
/**
 * Menu item display diagnostics (read-only).
 *
 * Checks that the public table-booking endpoint includes key menu item fields.
 *
 * Safety:
 * - Performs GET requests only.
 * - Fails closed (non-zero exit) on request/parse failures or missing expected fields.
 * - Does not support `--confirm`.
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'test-menu-display'
const DEFAULT_BASE_URL = 'http://localhost:3000'

type Args = {
  baseUrl: string
  bookingRef: string
}

function findFlagValue(argv: string[], flag: string): string | null {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) return eq.split('=')[1] ?? null

  const idx = argv.indexOf(flag)
  if (idx === -1) return null

  const value = argv[idx + 1]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error(`[${SCRIPT_NAME}] Invalid base URL`)
  }
  return trimmed
}

function readArgs(argv = process.argv.slice(2)): Args {
  if (argv.includes('--confirm')) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm`)
  }

  const baseUrl = normalizeBaseUrl(findFlagValue(argv, '--url') ?? process.env.TEST_MENU_DISPLAY_BASE_URL ?? DEFAULT_BASE_URL)
  const bookingRef =
    (findFlagValue(argv, '--booking-ref') ?? process.env.TEST_MENU_DISPLAY_BOOKING_REF ?? '').trim()

  if (!bookingRef) {
    throw new Error(
      `[${SCRIPT_NAME}] Missing --booking-ref (or TEST_MENU_DISPLAY_BOOKING_REF).`
    )
  }

  return { baseUrl, bookingRef }
}

function hasOwn(obj: unknown, key: string): boolean {
  return !!obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key)
}

async function run(): Promise<void> {
  const args = readArgs()

  console.log(`[${SCRIPT_NAME}] starting (read-only)\n`)
  console.log(`Base URL: ${args.baseUrl}`)
  console.log(`Booking reference: ${args.bookingRef}\n`)

  const url = `${args.baseUrl}/api/table-bookings/${encodeURIComponent(args.bookingRef)}/public`
  console.log(`GET ${url}`)

  const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
  const bodyText = await response.text()
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} body=${bodyText.slice(0, 200)}`)
  }

  let payload: any
  try {
    payload = JSON.parse(bodyText)
  } catch (error) {
    throw new Error(`Response was not JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const items = Array.isArray(payload?.items) ? payload.items : []
  console.log(`\nitems: ${items.length}`)

  const requiredFields = ['custom_item_name', 'guest_name', 'special_requests', 'item_type']
  let failures = 0

  if (items.length === 0) {
    console.error('❌ No items returned. (This script targets bookings that include menu items.)')
    failures += 1
  }

  for (const [idx, item] of items.entries()) {
    const missing = requiredFields.filter((field) => !hasOwn(item, field))
    if (missing.length > 0) {
      failures += 1
      console.error(`❌ Item ${idx + 1} missing fields: ${missing.join(', ')}`)
    }
  }

  if (failures > 0) {
    throw new Error(`[${SCRIPT_NAME}] public API payload missing expected menu item fields`)
  }

  console.log('\n✅ Public API includes expected menu item fields.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})

