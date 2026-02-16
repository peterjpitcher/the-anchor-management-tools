#!/usr/bin/env tsx

/**
 * Delete a specific set of customer rows (one-off cleanup).
 *
 * Safety note:
 * - Dry-run by default.
 * - Mutations require: --confirm + RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true + ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true
 * - Mutations require explicit caps: --limit=<n> (must equal number of targets); hard cap enforced.
 */

import { config } from 'dotenv'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertDeleteSpecificCustomersCompletedWithoutFailures,
  assertDeleteSpecificCustomersMutationAllowed,
  assertDeleteSpecificCustomersMutationSucceeded,
  assertDeleteSpecificCustomersTargetsResolved,
  isDeleteSpecificCustomersMutationRunEnabled,
  resolveDeleteSpecificCustomersRows
} from '../../src/lib/delete-specific-customers-safety'

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
}

type CleanupFailure = {
  customerId: string
  reason: string
}

config({ path: '.env.local' })

const supabase = createAdminClient()

const CUSTOMERS_TO_DELETE = [
  'dd5a6d12-d7e8-4d6a-a4e1-981d7a95af36',
  '709bf1fd-c1bf-4120-8a3e-4c16f886a92c',
  '70c6def5-81c3-43d8-a1c4-73501ac04e5f'
]

function parseOptionalPositiveInt(
  raw: string | null | undefined,
  label: '--limit' | 'DELETE_SPECIFIC_CUSTOMERS_LIMIT'
): number | null {
  if (raw == null || raw === '') {
    return null
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`delete-specific-customers blocked: ${label} must be a positive integer.`)
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`delete-specific-customers blocked: ${label} must be a positive integer.`)
  }

  return parsed
}

function readArgValue(argv: string[], flag: string): string | null {
  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    const value = argv[idx + 1]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    const [, value] = eq.split('=', 2)
    return value && value.trim().length > 0 ? value.trim() : null
  }

  return null
}

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

async function deleteSpecificCustomers(): Promise<void> {
  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const limit =
    parseOptionalPositiveInt(readArgValue(argv, '--limit'), '--limit') ??
    parseOptionalPositiveInt(process.env.DELETE_SPECIFIC_CUSTOMERS_LIMIT, 'DELETE_SPECIFIC_CUSTOMERS_LIMIT')
  const HARD_CAP = 50

  if (argv.includes('--help')) {
    console.log(`
delete-specific-customers (safe by default)

Dry-run (default):
  tsx scripts/cleanup/delete-specific-customers.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true \\
    tsx scripts/cleanup/delete-specific-customers.ts --confirm --limit <n>

Notes:
  - --limit must equal the number of targeted customers (and must not exceed hard cap ${HARD_CAP}).
  - Use --dry-run to force analysis mode even with --confirm.
`)
    return
  }

  console.log('Inspecting targeted customer cleanup set.\n')

  const mutationEnabled =
    !dryRunOverride && hasConfirmFlag && isDeleteSpecificCustomersMutationRunEnabled()

  if (hasConfirmFlag && !mutationEnabled && !dryRunOverride) {
    throw new Error(
      'delete-specific-customers blocked: --confirm requires RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true.'
    )
  }

  if (!mutationEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `DRY RUN${extra}: no customers will be deleted. Re-run with --confirm RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true --limit=<n> to apply deletions.`
    )
  } else {
    assertDeleteSpecificCustomersMutationAllowed()
    if (!limit) {
      throw new Error(
        'delete-specific-customers blocked: mutations require an explicit cap via --limit=<n> (or DELETE_SPECIFIC_CUSTOMERS_LIMIT).'
      )
    }
    if (limit > HARD_CAP) {
      throw new Error(
        `delete-specific-customers blocked: --limit ${limit} exceeds hard cap ${HARD_CAP}. Run in smaller batches.`
      )
    }
  }

  const { data: customersData, error: customersError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .in('id', CUSTOMERS_TO_DELETE)

  const customers = resolveDeleteSpecificCustomersRows<CustomerRow>({
    operation: 'Load customer rows targeted by delete-specific-customers',
    rows: customersData as CustomerRow[] | null,
    error: customersError
  })

  assertDeleteSpecificCustomersTargetsResolved({
    requestedIds: CUSTOMERS_TO_DELETE,
    fetchedRows: customers.map((customer) => ({ id: customer.id }))
  })

  if (mutationEnabled) {
    if (limit !== customers.length) {
      throw new Error(
        `delete-specific-customers blocked: --limit must equal the number of targeted customers (${customers.length}).`
      )
    }
  }

  console.log(`Found ${customers.length} targeted customer row(s):`)
  customers.forEach((customer) => {
    console.log(
      `  - ${customer.first_name ?? ''} ${customer.last_name ?? ''} (${customer.mobile_number ?? 'no phone'}) [${customer.id}]`
    )
  })

  if (!mutationEnabled) {
    console.log('\nDry-run complete. No customer rows deleted.')
    return
  }

  console.log('\n⚠️ Proceeding with destructive customer deletion...')

  const failures: CleanupFailure[] = []

  for (const customer of customers) {
    const name = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || customer.id

    const { data: deletedCustomerRows, error: deleteError } = await supabase
      .from('customers')
      .delete()
      .eq('id', customer.id)
      .select('id')

    try {
      assertDeleteSpecificCustomersMutationSucceeded({
        operation: `Delete customer ${customer.id}`,
        error: deleteError,
        rows: deletedCustomerRows as Array<{ id?: string }> | null,
        expectedCount: 1
      })
      console.log(`✅ Deleted customer ${name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ customerId: customer.id, reason: `delete_failed:${message}` })
      console.error(`❌ Failed deleting customer ${name}: ${message}`)
      continue
    }

    const { data: auditRows, error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        action: 'delete',
        entity_type: 'customer',
        entity_id: customer.id,
        metadata: {
          reason: 'Deletion of non-real/system customer accounts',
          script: 'delete-specific-customers.ts',
          first_name: customer.first_name,
          last_name: customer.last_name,
          mobile_number: customer.mobile_number
        }
      })
      .select('id')

    try {
      assertDeleteSpecificCustomersMutationSucceeded({
        operation: `Insert delete audit log for customer ${customer.id}`,
        error: auditError,
        rows: auditRows as Array<{ id?: string }> | null,
        expectedCount: 1
      })
      console.log(`📝 Audit log created for customer ${name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ customerId: customer.id, reason: `audit_failed:${message}` })
      console.error(`❌ Failed writing audit log for customer ${name}: ${message}`)
    }
  }

  assertDeleteSpecificCustomersCompletedWithoutFailures(failures)
  console.log('\n✅ delete-specific-customers completed without unresolved failures.')
}

deleteSpecificCustomers().catch((error) => {
  markFailure('delete-specific-customers failed.', error)
})
