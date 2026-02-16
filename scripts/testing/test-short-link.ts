#!/usr/bin/env tsx

/**
 * Short link diagnostics (read-only).
 *
 * Safety note:
 * - Strictly read-only and blocks `--confirm`.
 * - Fails closed (non-zero exit) on env/query errors.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'test-short-link'

interface ShortLinkRow {
  short_code: string
  link_type: string | null
  destination_url: string | null
  click_count: number | null
  created_at: string
  expires_at: string | null
}

interface ShortLinkSummaryRow {
  short_code: string
  destination_url: string | null
  click_count: number | null
  created_at: string
}

async function run(shortCode: string) {
  if (process.argv.includes('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  console.log(`Short link diagnostics (read-only): ${shortCode}\n`)

  const supabase = createAdminClient()
  
  // Get the short link
  const { data: linkData, error: linkError } = await supabase
    .from('short_links')
    .select('*')
    .eq('short_code', shortCode)
    .single()

  const link = assertScriptQuerySucceeded({
    operation: `Load short link ${shortCode}`,
    error: linkError,
    data: linkData as ShortLinkRow | null,
  })

  if (!link) {
    throw new Error(`Short link not found: ${shortCode}`)
  }
  
  console.log('✅ Found short link:')
  console.log(`Code: ${link.short_code}`)
  console.log(`Type: ${link.link_type}`)
  console.log(`Destination: ${link.destination_url}`)
  console.log(`Click count: ${link.click_count || 0}`)
  console.log(`Created: ${new Date(link.created_at).toLocaleString()}`)
  console.log(`Expires: ${link.expires_at ? new Date(link.expires_at).toLocaleString() : 'Never'}`)
  
  console.log(`\nShort URL: https://vip-club.uk/${shortCode}`)
  console.log(`Redirects to: ${link.destination_url}`)
  
  // List all short links
  console.log('\nAll short links (latest 10):')
  const { data: allLinksData, error: allLinksError } = await supabase
    .from('short_links')
    .select('short_code, destination_url, click_count, created_at')
    .order('created_at', { ascending: false })
    .limit(10)

  const allLinks =
    (assertScriptQuerySucceeded({
      operation: 'List recent short links',
      error: allLinksError,
      data: allLinksData as ShortLinkSummaryRow[] | null,
      allowMissing: true,
    }) ?? []) as ShortLinkSummaryRow[]

  if (allLinks.length > 0) {
    allLinks.forEach(l => {
      console.log(`- vip-club.uk/${l.short_code} -> ${String(l.destination_url).substring(0, 60)}${String(l.destination_url).length > 60 ? '...' : ''} (clicks=${l.click_count || 0})`)
    })
  }

  console.log('\n✅ Read-only short link diagnostics completed.')
}

// Get short code from command line or use default
const shortCode = process.argv[2] || 'gt341d'

run(shortCode).catch((error: unknown) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, error)
  process.exitCode = 1
})
