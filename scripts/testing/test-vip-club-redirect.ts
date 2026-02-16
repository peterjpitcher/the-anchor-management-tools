#!/usr/bin/env tsx

/**
 * VIP-CLUB short link redirect diagnostics (read-only).
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

const SCRIPT_NAME = 'test-vip-club-redirect'

interface ShortLinkDiagnosticRow {
  short_code: string
  destination_url: string | null
  link_type: string | null
  click_count: number | null
}

interface ShortLinkDetailsRow extends ShortLinkDiagnosticRow {
  created_at: string
  expires_at: string | null
}

async function run() {
  if (process.argv.includes('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  console.log('VIP-CLUB redirect diagnostics (read-only)\n')

  const supabase = createAdminClient()
  
  // Check existing short links
  console.log('Current short links in database (latest 10):')
  const { data: linksData, error: linksError } = await supabase
    .from('short_links')
    .select('short_code, destination_url, link_type, click_count')
    .order('created_at', { ascending: false })
    .limit(10)

  const links =
    (assertScriptQuerySucceeded({
      operation: 'List recent short links',
      error: linksError,
      data: linksData as ShortLinkDiagnosticRow[] | null,
      allowMissing: true,
    }) ?? []) as ShortLinkDiagnosticRow[]
  
  if (links.length > 0) {
    links.forEach(link => {
      console.log(`- vip-club.uk/${link.short_code} -> ${link.destination_url} (type=${link.link_type}, clicks=${link.click_count || 0})`)
    })
  } else {
    console.log('   No short links found')
  }
  
  // Find the specific link mentioned
  const { data: specificLinkData, error: specificError } = await supabase
    .from('short_links')
    .select('*')
    .eq('short_code', 'gt341d')
    .single()

  const specificLink = assertScriptQuerySucceeded({
    operation: 'Load short link gt341d',
    error: specificError,
    data: specificLinkData as ShortLinkDetailsRow | null,
    allowMissing: true,
  })

  if (specificLink) {
    console.log('\nFound gt341d link:')
    console.log(`URL: vip-club.uk/gt341d`)
    console.log(`Destination: ${specificLink.destination_url}`)
    console.log(`Created: ${new Date(specificLink.created_at).toLocaleString()}`)
    console.log(`Expires: ${specificLink.expires_at ? new Date(specificLink.expires_at).toLocaleString() : 'Never'}`)
  }
  
  console.log('\nManual browser test:')
  console.log('- Open an incognito window')
  console.log('- Visit https://vip-club.uk/gt341d and verify it redirects directly (not to login)')
  console.log('\n✅ Read-only redirect diagnostics completed.')
}

run().catch((error: unknown) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, error)
  process.exitCode = 1
})
