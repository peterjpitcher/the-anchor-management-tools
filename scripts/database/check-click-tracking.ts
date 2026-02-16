#!/usr/bin/env tsx

/**
 * Short-link click tracking diagnostics (read-only).
 *
 * Safety:
 * - No DB mutations.
 * - Fails closed on query/RPC errors (non-zero exit).
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function isFlagPresent(flag: string): boolean {
  return process.argv.includes(flag)
}

async function run() {
  if (isFlagPresent('--help')) {
    console.log(`
check-click-tracking (read-only)

Usage:
  tsx scripts/database/check-click-tracking.ts
`)
    return
  }

  if (isFlagPresent('--confirm')) {
    throw new Error('check-click-tracking is read-only and does not support --confirm.')
  }

  console.log('🔍 Checking short link click tracking (read-only)\n')

  const supabase = createAdminClient()

  // 1) Recent short links
  console.log('1️⃣ Recent short links:')
  const { data: links, error: linksError } = await supabase
    .from('short_links')
    .select('id, short_code, destination_url, click_count, last_clicked_at, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  if (linksError) {
    throw new Error(`Error fetching short_links: ${linksError.message || 'unknown error'}`)
  }

  if (Array.isArray(links) && links.length > 0) {
    links.forEach((link: any) => {
      console.log(`\n📎 ${link.short_code}`)
      console.log(`   Destination: ${link.destination_url}`)
      console.log(`   Click count: ${link.click_count ?? 0}`)
      console.log(`   Last clicked: ${link.last_clicked_at ?? 'Never'}`)
      console.log(
        `   Created: ${link.created_at ? new Date(link.created_at).toLocaleString() : 'Unknown'}`
      )
    })
  } else {
    console.log('   No short links found')
  }

  // 2) Recent clicks
  console.log('\n\n2️⃣ Recent clicks (last 10):')
  const { data: clicks, error: clicksError } = await supabase
    .from('short_link_clicks')
    .select(
      `
      id,
      clicked_at,
      ip_address,
      country,
      city,
      device_type,
      browser,
      os,
      user_agent,
      short_links!inner(short_code)
    `
    )
    .order('clicked_at', { ascending: false })
    .limit(10)

  if (clicksError) {
    throw new Error(`Error fetching short_link_clicks: ${clicksError.message || 'unknown error'}`)
  }

  if (Array.isArray(clicks) && clicks.length > 0) {
    clicks.forEach((click: any) => {
      console.log(`\n🖱️  Click ID: ${click.id}`)
      console.log(`   Short code: ${click.short_links?.short_code}`)
      console.log(
        `   Clicked at: ${click.clicked_at ? new Date(click.clicked_at).toLocaleString() : 'Unknown'}`
      )
      console.log(`   IP: ${click.ip_address || 'Not captured'}`)
      console.log(`   Country: ${click.country || 'Not captured'}`)
      console.log(`   City: ${click.city || 'Not captured'}`)
      console.log(`   Device: ${click.device_type || 'Not captured'}`)
      console.log(`   Browser: ${click.browser || 'Not captured'}`)
      console.log(`   OS: ${click.os || 'Not captured'}`)
      console.log(
        `   User Agent: ${click.user_agent ? String(click.user_agent).slice(0, 60) + '…' : 'Not captured'}`
      )
    })
  } else {
    console.log('   No clicks recorded')
  }

  // 3) Click counts
  console.log('\n\n3️⃣ Click statistics:')
  const { count: totalClicks, error: clickCountError } = await supabase
    .from('short_link_clicks')
    .select('id', { count: 'exact', head: true })

  if (clickCountError) {
    throw new Error(
      `Error counting short_link_clicks: ${clickCountError.message || 'unknown error'}`
    )
  }

  console.log(`   Total clicks recorded: ${typeof totalClicks === 'number' ? totalClicks : 0}`)

  // 4) Schema/columns (best-effort but still fail closed on unexpected RPC errors)
  console.log('\n\n4️⃣ Column inventory:')

  const { data: columnRows, error: columnError } = await supabase
    .rpc('get_table_columns', { table_name: 'short_link_clicks' })
    .select('*')

  if (!columnError && Array.isArray(columnRows)) {
    const names = columnRows
      .map((row) => (row && typeof row === 'object' ? (row as any).column_name : null))
      .filter((name): name is string => typeof name === 'string' && name.length > 0)

    if (names.length > 0) {
      names.forEach((name) => console.log(`   - ${name}`))
      console.log('\n✅ Read-only click tracking diagnostics complete.')
      return
    }
  }

  // Fallback: infer from a sample row.
  const { data: sample, error: sampleError } = await supabase
    .from('short_link_clicks')
    .select('*')
    .limit(1)

  if (sampleError) {
    throw new Error(`Error sampling short_link_clicks: ${sampleError.message || 'unknown error'}`)
  }

  if (Array.isArray(sample) && sample.length > 0 && sample[0] && typeof sample[0] === 'object') {
    Object.keys(sample[0] as Record<string, unknown>).forEach((name) => console.log(`   - ${name}`))
  } else {
    console.log('   short_link_clicks has no rows; cannot infer columns without get_table_columns().')
  }

  console.log('\n✅ Read-only click tracking diagnostics complete.')
}

run().catch((error) => markFailure('check-click-tracking failed', error))
