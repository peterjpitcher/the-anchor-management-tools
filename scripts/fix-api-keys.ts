#!/usr/bin/env tsx
/**
 * API key cleanup script.
 *
 * 1. Deactivate keys named "Test", "test", "Music Bing App"
 * 2. Replace wildcard "*" permissions on "website" / "Website integration"
 *    with a scoped set
 * 3. Reduce rate_limit from 1000 → 30 on keys that have create:bookings
 *    (or previously had wildcard)
 * 4. Print before/after for verification
 *
 * Usage: npx tsx scripts/fix-api-keys.ts
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { createAdminClient } from '../src/lib/supabase/admin'

interface ApiKeyRow {
  id: string
  name: string
  is_active: boolean | null
  permissions: string[] | string | null
  rate_limit: number | null
}

const SCOPED_PERMISSIONS = [
  'read:events',
  'read:menu',
  'read:business',
  'create:bookings',
  'read:customers',
  'write:customers',
  'read:table_bookings',
  'write:table_bookings',
]

const DEACTIVATE_NAMES = ['Test', 'test', 'Music Bing App']
const WILDCARD_SCOPE_NAMES = ['website', 'Website integration']

function formatRow(row: ApiKeyRow): string {
  return [
    `  id:          ${row.id}`,
    `  name:        ${row.name}`,
    `  is_active:   ${row.is_active}`,
    `  permissions: ${JSON.stringify(row.permissions)}`,
    `  rate_limit:  ${row.rate_limit}`,
  ].join('\n')
}

async function run(): Promise<void> {
  const supabase = createAdminClient()

  // ── Load all keys ────────────────────────────────────────────────
  const { data: allKeys, error: loadError } = await supabase
    .from('api_keys')
    .select('id, name, is_active, permissions, rate_limit')
    .order('name')

  if (loadError) throw new Error(`Failed to load api_keys: ${loadError.message}`)
  if (!allKeys || allKeys.length === 0) {
    console.log('No API keys found in database.')
    return
  }

  const keys = allKeys as ApiKeyRow[]

  // ── Print BEFORE state ───────────────────────────────────────────
  console.log('=== BEFORE ===\n')
  for (const key of keys) {
    console.log(formatRow(key))
    console.log('')
  }

  // ── 1. Deactivate test / junk keys ──────────────────────────────
  const toDeactivate = keys.filter((k) => DEACTIVATE_NAMES.includes(k.name))
  if (toDeactivate.length > 0) {
    console.log(`Deactivating ${toDeactivate.length} key(s): ${toDeactivate.map((k) => k.name).join(', ')}`)
    const { error } = await supabase
      .from('api_keys')
      .update({ is_active: false })
      .in('id', toDeactivate.map((k) => k.id))
    if (error) throw new Error(`Deactivate failed: ${error.message}`)
  } else {
    console.log('No keys matched deactivation list.')
  }

  // ── 2. Scope wildcard permissions ───────────────────────────────
  const toScope = keys.filter(
    (k) =>
      WILDCARD_SCOPE_NAMES.includes(k.name) &&
      hasWildcard(k.permissions)
  )
  if (toScope.length > 0) {
    console.log(`Scoping wildcard on ${toScope.length} key(s): ${toScope.map((k) => k.name).join(', ')}`)
    for (const key of toScope) {
      const { error } = await supabase
        .from('api_keys')
        .update({ permissions: SCOPED_PERMISSIONS })
        .eq('id', key.id)
      if (error) throw new Error(`Scope permissions failed for ${key.name}: ${error.message}`)
    }
  } else {
    console.log('No wildcard keys matched for scoping.')
  }

  // ── 3. Reduce rate_limit on keys with create:bookings ──────────
  // Re-fetch to pick up permission changes from step 2
  const { data: refreshed, error: refreshError } = await supabase
    .from('api_keys')
    .select('id, name, is_active, permissions, rate_limit')
    .order('name')

  if (refreshError) throw new Error(`Refresh failed: ${refreshError.message}`)
  const refreshedKeys = (refreshed ?? []) as ApiKeyRow[]

  const toRateLimit = refreshedKeys.filter(
    (k) =>
      k.rate_limit === 1000 &&
      hasPermission(k.permissions, 'create:bookings')
  )
  if (toRateLimit.length > 0) {
    console.log(`Reducing rate_limit 1000→30 on ${toRateLimit.length} key(s): ${toRateLimit.map((k) => k.name).join(', ')}`)
    const { error } = await supabase
      .from('api_keys')
      .update({ rate_limit: 30 })
      .in('id', toRateLimit.map((k) => k.id))
    if (error) throw new Error(`Rate limit update failed: ${error.message}`)
  } else {
    console.log('No keys with rate_limit=1000 and create:bookings permission found.')
  }

  // ── Print AFTER state ────────────────────────────────────────────
  const { data: finalKeys, error: finalError } = await supabase
    .from('api_keys')
    .select('id, name, is_active, permissions, rate_limit')
    .order('name')

  if (finalError) throw new Error(`Final load failed: ${finalError.message}`)

  console.log('\n=== AFTER ===\n')
  for (const key of (finalKeys ?? []) as ApiKeyRow[]) {
    console.log(formatRow(key))
    console.log('')
  }

  console.log('Done. All changes applied successfully.')
}

// ── Helpers ──────────────────────────────────────────────────────────

function hasWildcard(permissions: string[] | string | null): boolean {
  if (!permissions) return false
  if (typeof permissions === 'string') return permissions === '*'
  if (Array.isArray(permissions)) return permissions.includes('*')
  return false
}

function hasPermission(permissions: string[] | string | null, perm: string): boolean {
  if (!permissions) return false
  if (typeof permissions === 'string') return permissions === '*' || permissions === perm
  if (Array.isArray(permissions)) return permissions.includes('*') || permissions.includes(perm)
  return false
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
