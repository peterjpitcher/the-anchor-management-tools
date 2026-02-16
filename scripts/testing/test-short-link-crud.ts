#!/usr/bin/env tsx
/**
 * Short link diagnostics (read-only).
 *
 * This script used to insert/update/delete rows in `short_links` using the
 * Supabase service-role key. Keep incident/diagnostic scripts strictly
 * read-only to avoid accidental production mutations.
 */

import { config } from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'

config({ path: path.resolve(process.cwd(), '.env.local') })

function previewUrl(url: unknown): string {
  if (typeof url !== 'string' || url.trim().length === 0) return '(missing)'
  const trimmed = url.trim()
  if (trimmed.length <= 80) return trimmed
  return `${trimmed.slice(0, 77)}...`
}

async function runDiagnostics() {
  console.log('Short link diagnostics (read-only)\n')

  const supabase = createAdminClient()

  const { data: links, error } = await supabase
    .from('short_links')
    .select('id, short_code, destination_url, link_type, click_count, created_at')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    throw new Error(`Failed to read short_links: ${error.message || 'unknown database error'}`)
  }

  console.log(`Found ${links?.length || 0} short link(s) (showing up to 10).`)
  for (const link of links || []) {
    console.log(`- ${link.short_code} -> ${previewUrl(link.destination_url)} (${link.link_type || 'unknown'})`)
  }

  console.log('\n✅ Short link diagnostics complete.')
}

runDiagnostics().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
