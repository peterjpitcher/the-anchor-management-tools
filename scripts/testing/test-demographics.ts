#!/usr/bin/env tsx
/**
 * Short link demographics diagnostics (read-only).
 *
 * Safety note:
 * - This script must not insert/update/delete rows in production.
 * - It is strictly read-only and fails closed on any query/RPC error.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

type ShortLinkRow = { id: string; short_code: string }
const SCRIPT_NAME = 'test-demographics'
const HARD_CAP_DAYS = 365
const HARD_CAP_LIMIT = 2000

function getArgValue(flag: string): string | null {
  const withEqualsPrefix = `${flag}=`
  for (let i = 2; i < process.argv.length; i += 1) {
    const entry = process.argv[i]
    if (entry === flag) {
      const next = process.argv[i + 1]
      return typeof next === 'string' && next.length > 0 ? next : null
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

function parseBoundedPositiveInt(value: string | null, defaultValue: number, flag: string, hardCap: number): number {
  if (!value) return defaultValue
  const trimmed = value.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`Invalid positive integer for ${flag}: ${value}`)
  }
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${flag}: ${value}`)
  }
  if (parsed > hardCap) {
    throw new Error(`${flag} exceeds hard cap ${hardCap}`)
  }
  return parsed
}

function parseDays(value: string | null, defaultValue: number): number {
  return parseBoundedPositiveInt(value, defaultValue, '--days', HARD_CAP_DAYS)
}

function parseLimit(value: string | null, defaultValue: number): number {
  return parseBoundedPositiveInt(value, defaultValue, '--limit', HARD_CAP_LIMIT)
}

async function run() {
  if (isFlagPresent('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  console.log('Short link demographics diagnostics (read-only)\n')

  const shortCode = getArgValue('--short-code') ?? process.env.TEST_SHORT_LINK_CODE ?? null
  const days = parseDays(getArgValue('--days') ?? process.env.TEST_SHORT_LINK_DAYS ?? null, 30)
  const limit = parseLimit(getArgValue('--limit') ?? process.env.TEST_SHORT_LINK_CLICK_LIMIT ?? null, 500)

  console.log(`Short code: ${shortCode ?? '(missing)'} (set --short-code or TEST_SHORT_LINK_CODE)`)
  console.log(`Days: ${days}`)
  console.log(`Click sample limit: ${limit}`)
  console.log('')

  if (!shortCode) {
    throw new Error('Missing required --short-code (or TEST_SHORT_LINK_CODE).')
  }

  const supabase = createAdminClient()

  console.log('1) Loading short link...')
  const { data: linkData, error: linkError } = await supabase
    .from('short_links')
    .select('id, short_code')
    .eq('short_code', shortCode)
    .maybeSingle()

  const link = assertScriptQuerySucceeded({
    operation: `Load short link ${shortCode}`,
    error: linkError,
    data: linkData as ShortLinkRow | null,
    allowMissing: true,
  })

  if (!link) {
    throw new Error(`Short link not found for short_code=${shortCode}`)
  }

  const linkRow = link as ShortLinkRow
  console.log(`✅ Link loaded: ${linkRow.id}`)
  console.log('')

  console.log('2) Calling analytics RPC (get_short_link_analytics)...')
  const { data: analytics, error: analyticsError } = await supabase.rpc('get_short_link_analytics', {
    p_short_code: shortCode,
    p_days: days,
  })

  const analyticsPayload = assertScriptQuerySucceeded({
    operation: 'RPC get_short_link_analytics',
    error: analyticsError,
    data: analytics as unknown,
    allowMissing: true,
  })

  console.log('✅ Analytics payload:', JSON.stringify(analyticsPayload, null, 2))
  console.log('')

  console.log('3) Calling volume analytics RPC (get_all_links_analytics)...')
  const { data: volumeData, error: volumeError } = await supabase.rpc('get_all_links_analytics', {
    p_days: days,
  })

  const safeVolumeData = assertScriptQuerySucceeded({
    operation: 'RPC get_all_links_analytics',
    error: volumeError,
    data: volumeData as unknown,
    allowMissing: true,
  })

  const volumeCount = Array.isArray(safeVolumeData) ? safeVolumeData.length : 0
  console.log(`✅ Volume analytics rows: ${volumeCount}`)
  console.log('')

  console.log('4) Sampling click demographics (short_link_clicks)...')
  const { data: clicks, error: clicksError } = await supabase
    .from('short_link_clicks')
    .select('country, city, device_type, browser, os')
    .eq('short_link_id', linkRow.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  const safeClicks =
    (assertScriptQuerySucceeded({
      operation: 'Load short_link_clicks demographics sample',
      error: clicksError,
      data: clicks as Array<{
        country: string | null
        city: string | null
        device_type: string | null
        browser: string | null
        os: string | null
      }> | null,
      allowMissing: true,
    }) ?? []) as Array<{
      country: string | null
      city: string | null
      device_type: string | null
      browser: string | null
      os: string | null
    }>

  const demographics = {
    countries: {} as Record<string, number>,
    devices: {} as Record<string, number>,
    browsers: {} as Record<string, number>,
    os: {} as Record<string, number>,
  }

  for (const click of safeClicks) {
    const entry = click as {
      country: string | null
      device_type: string | null
      browser: string | null
      os: string | null
    }
    if (entry.country) demographics.countries[entry.country] = (demographics.countries[entry.country] || 0) + 1
    if (entry.device_type) demographics.devices[entry.device_type] = (demographics.devices[entry.device_type] || 0) + 1
    if (entry.browser) demographics.browsers[entry.browser] = (demographics.browsers[entry.browser] || 0) + 1
    if (entry.os) demographics.os[entry.os] = (demographics.os[entry.os] || 0) + 1
  }

  console.log(`✅ Click sample size: ${safeClicks.length}`)
  console.log('Countries:', demographics.countries)
  console.log('Devices:', demographics.devices)
  console.log('Browsers:', demographics.browsers)
  console.log('OS:', demographics.os)

  console.log('\n✅ Read-only demographics diagnostics completed.')
}

run().catch((error: unknown) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, error)
  process.exitCode = 1
})
