#!/usr/bin/env tsx

/**
 * fix-table-booking-api-permissions (safe by default)
 *
 * Ensure an API key has permission to call the Table Booking API endpoints.
 *
 * Dry-run (default):
 *   tsx scripts/fixes/fix-table-booking-api-permissions.ts --key-hash <sha256>
 *
 * Mutation mode (requires multi-gating):
 *   RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION=true \\
 *   ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT=true \\
 *     tsx scripts/fixes/fix-table-booking-api-permissions.ts --confirm --limit=1 --key-hash <sha256>
 *
 * Notes:
 * - This script does NOT accept a raw API key to avoid secrets in shell history.
 * - Compute the key hash locally:
 *     API_KEY="anch_..." node -e "const {createHash}=require('crypto'); console.log(createHash('sha256').update(process.env.API_KEY||'').digest('hex'))"
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded
} from '../../src/lib/script-mutation-safety'
import {
  assertFixTableBookingApiPermissionsLimit,
  assertFixTableBookingApiPermissionsKeyHash,
  assertFixTableBookingApiPermissionsMutationAllowed,
  isFixTableBookingApiPermissionsMutationEnabled,
  readFixTableBookingApiPermissionsLimit,
  readFixTableBookingApiPermissionsKeyHash
} from '../../src/lib/fix-table-booking-api-permissions-script-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

type ApiKeyRow = {
  id: string
  name: string | null
  permissions: string[] | null
  is_active: boolean | null
  rate_limit: number | null
  last_used_at: string | null
}

function uniquePermissions(value: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const perm of value) {
    const normalized = typeof perm === 'string' ? perm.trim() : ''
    if (!normalized) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

async function run(): Promise<void> {
  const argv = process.argv
  const confirm = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const mutationEnabled =
    !dryRunOverride && isFixTableBookingApiPermissionsMutationEnabled(argv, process.env)

  if (argv.includes('--help')) {
    console.log(`
fix-table-booking-api-permissions (safe by default)

Dry-run (default):
  tsx scripts/fixes/fix-table-booking-api-permissions.ts --key-hash <sha256>

Mutation mode (requires multi-gating):
  RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION=true \\
  ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT=true \\
    tsx scripts/fixes/fix-table-booking-api-permissions.ts --confirm --limit=1 --key-hash <sha256>

Notes:
  - This script ensures the API key permissions include "create:bookings".
  - Provide --key-hash (sha256 hex) instead of the raw API key.
`)
    return
  }

  const keyHash = assertFixTableBookingApiPermissionsKeyHash(
    readFixTableBookingApiPermissionsKeyHash(argv, process.env)
  )

  if (confirm && !mutationEnabled && !dryRunOverride) {
    throw new Error(
      'fix-table-booking-api-permissions blocked: --confirm requires RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION=true and ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT=true.'
    )
  }

  if (mutationEnabled) {
    assertFixTableBookingApiPermissionsLimit(readFixTableBookingApiPermissionsLimit(argv, process.env))
    assertFixTableBookingApiPermissionsMutationAllowed(process.env)
  }

  const supabase = createAdminClient()
  const modeLabel = mutationEnabled ? 'MUTATION' : 'DRY-RUN'
  console.log(`🔧 fix-table-booking-api-permissions (${modeLabel})\n`)

  const { data: apiKeyRowRaw, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('id, name, permissions, is_active, rate_limit, last_used_at')
    .eq('key_hash', keyHash)
    .maybeSingle()

  const apiKeyRow = assertScriptQuerySucceeded<ApiKeyRow | null>({
    operation: 'Load api_keys row by key_hash',
    error: apiKeyError,
    data: apiKeyRowRaw as ApiKeyRow | null,
    allowMissing: true
  })

  if (!apiKeyRow) {
    throw new Error(
      'fix-table-booking-api-permissions blocked: no matching api_keys row found for the provided --key-hash.'
    )
  }

  const currentPermissions = Array.isArray(apiKeyRow.permissions) ? apiKeyRow.permissions : []
  const hasWildcard = currentPermissions.includes('*')
  const requiredPermissions = ['create:bookings']
  const nextPermissions = hasWildcard
    ? ['*']
    : uniquePermissions([...currentPermissions, ...requiredPermissions])

  const missingRequired = requiredPermissions.filter(
    (permission) => !hasWildcard && !currentPermissions.includes(permission)
  )

  console.log(`Key name: ${apiKeyRow.name || '<unnamed>'}`)
  console.log(`Key id: ${apiKeyRow.id}`)
  console.log(`Key hash: ${keyHash.slice(0, 8)}...`)
  console.log(`Active: ${apiKeyRow.is_active === true}`)
  console.log(`Rate limit: ${apiKeyRow.rate_limit ?? '<unknown>'}`)
  console.log(`Last used: ${apiKeyRow.last_used_at || 'Never'}`)
  console.log('\nCurrent permissions:')
  console.log(JSON.stringify(currentPermissions, null, 2))

  if (missingRequired.length === 0) {
    console.log('\n✅ No update required (already includes create:bookings or wildcard).')
    return
  }

  console.log('\nProposed permissions (additive):')
  console.log(JSON.stringify(nextPermissions, null, 2))

  if (!mutationEnabled) {
    console.log(
      '\nDry-run mode: no rows updated. Re-run with --confirm --limit=1 RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION=true ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT=true to apply.'
    )
    return
  }

  const now = new Date().toISOString()
  const { data: updatedRows, error: updateError } = await supabase
    .from('api_keys')
    .update({ permissions: nextPermissions, updated_at: now })
    .eq('id', apiKeyRow.id)
    .select('id')

  const { updatedCount } = assertScriptMutationSucceeded({
    operation: 'Update api_keys permissions',
    error: updateError,
    updatedRows: (updatedRows ?? []) as Array<{ id?: string }>,
    allowZeroRows: false
  })

  assertScriptExpectedRowCount({
    operation: 'Update api_keys permissions',
    expected: 1,
    actual: updatedCount
  })

  const { data: verifyRowRaw, error: verifyError } = await supabase
    .from('api_keys')
    .select('permissions')
    .eq('id', apiKeyRow.id)
    .maybeSingle()

  const verifyRow = assertScriptQuerySucceeded<{ permissions: string[] | null } | null>({
    operation: 'Reload api_keys permissions for verification',
    error: verifyError,
    data: verifyRowRaw as { permissions: string[] | null } | null,
    allowMissing: true
  })

  const verifiedPermissions = Array.isArray(verifyRow?.permissions) ? verifyRow.permissions : []
  if (!verifiedPermissions.includes('create:bookings') && !verifiedPermissions.includes('*')) {
    throw new Error(
      'fix-table-booking-api-permissions verification failed: updated permissions still missing create:bookings.'
    )
  }

  console.log('\n✅ Permissions updated successfully.')
}

run().catch((error) => {
  console.error('❌ fix-table-booking-api-permissions script failed:', error)
  process.exitCode = 1
})
