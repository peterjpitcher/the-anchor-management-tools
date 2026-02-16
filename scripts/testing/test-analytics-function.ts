#!/usr/bin/env tsx

/**
 * Short link analytics diagnostics (read-only).
 *
 * Safety note:
 * - This script is strictly read-only and blocks `--confirm`.
 * - It fails closed on any required RPC/query errors (non-zero exit).
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'test-analytics-function'

async function run() {
  if (process.argv.includes('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  console.log('Short link analytics diagnostics (read-only)\n')

  const supabase = createAdminClient()

  const shortCode = process.env.TEST_SHORT_LINK_CODE ?? 'gt341d'
  const days = 30

  console.log(`Short code: ${shortCode}`)
  console.log(`Days: ${days}`)
  console.log('')

  console.log('1) Calling get_short_link_analytics...')
  const { data: analytics, error: analyticsError } = await supabase.rpc('get_short_link_analytics', {
    p_short_code: shortCode,
    p_days: days,
  })

  const safeAnalytics = assertScriptQuerySucceeded({
    operation: 'RPC get_short_link_analytics',
    error: analyticsError,
    data: analytics as unknown,
    allowMissing: true,
  })

  const analyticsCount = Array.isArray(safeAnalytics) ? safeAnalytics.length : 0
  console.log(`✅ get_short_link_analytics OK (rows=${analyticsCount})`)
  if (analyticsCount > 0) {
    console.log('Sample row:', safeAnalytics?.[0])
  }
  console.log('')

  console.log('2) Calling get_all_links_analytics...')
  const { data: allLinks, error: allLinksError } = await supabase.rpc('get_all_links_analytics', {
    p_days: days,
  })

  const safeAllLinks = assertScriptQuerySucceeded({
    operation: 'RPC get_all_links_analytics',
    error: allLinksError,
    data: allLinks as unknown,
    allowMissing: true,
  })

  const allLinksCount = Array.isArray(safeAllLinks) ? safeAllLinks.length : 0
  console.log(`✅ get_all_links_analytics OK (links=${allLinksCount})`)
  console.log('')

  console.log('3) Resolving short_links.id...')
  const { data: linkRowData, error: linkError } = await supabase
    .from('short_links')
    .select('id')
    .eq('short_code', shortCode)
    .maybeSingle()

  const linkRow = assertScriptQuerySucceeded({
    operation: `Resolve short_links.id for ${shortCode}`,
    error: linkError,
    data: linkRowData as { id: string } | null,
    allowMissing: true,
  })

  if (!linkRow?.id) {
    throw new Error(`Short link not found for short_code=${shortCode}`)
  }

  console.log(`✅ short_links.id=${linkRow.id}`)
  console.log('')

  console.log('4) Sampling short_link_clicks...')
  const { data: clicksData, error: clicksError } = await supabase
    .from('short_link_clicks')
    .select('clicked_at, device_type, country')
    .eq('short_link_id', linkRow.id)
    .order('clicked_at', { ascending: false })
    .limit(5)

  const clicks =
    (assertScriptQuerySucceeded({
      operation: 'Load short_link_clicks sample',
      error: clicksError,
      data: clicksData as Array<{
        clicked_at: string
        device_type: string | null
        country: string | null
      }> | null,
      allowMissing: true,
    }) ?? []) as Array<{
      clicked_at: string
      device_type: string | null
      country: string | null
    }>

  console.log(`✅ short_link_clicks sample rows=${clicks.length}`)
  console.log('Clicks:', clicks)
  console.log('\n✅ Read-only analytics diagnostics completed.')
}

run().catch((error: unknown) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, error)
  process.exitCode = 1
})
