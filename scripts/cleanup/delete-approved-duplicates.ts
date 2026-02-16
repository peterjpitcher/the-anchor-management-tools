#!/usr/bin/env tsx

/**
 * delete-approved-duplicates (safe by default)
 *
 * Deletes a curated list of approved duplicate customer records.
 *
 * Dry-run (default):
 *   tsx scripts/cleanup/delete-approved-duplicates.ts
 *
 * Mutation mode (requires multi-gating + explicit caps):
 *   RUN_DELETE_APPROVED_DUPLICATES_MUTATION=true \\
 *   ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT=true \\
 *     tsx scripts/cleanup/delete-approved-duplicates.ts --confirm --limit 10 [--offset 0]
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
  assertDuplicateCleanupCompletedWithoutFailures,
  assertDuplicateCleanupTargetsResolved
} from '../../src/lib/duplicate-customer-cleanup-safety'
import {
  assertDeleteApprovedDuplicatesLimit,
  assertDeleteApprovedDuplicatesMutationAllowed,
  isDeleteApprovedDuplicatesMutationEnabled,
  readDeleteApprovedDuplicatesLimit,
  readDeleteApprovedDuplicatesOffset
} from '../../src/lib/delete-approved-duplicates-script-safety'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

type DuplicateCustomerTarget = {
  id: string
  name: string
  phone: string
}

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
}

function isFlagPresent(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(flag)
}

// Approved duplicate customer IDs to delete.
const DUPLICATES_TO_DELETE: DuplicateCustomerTarget[] = [
  { id: '5c23cc40-9e7a-4399-a781-3fcacbf50ce5', name: 'Jane Evans (duplicate)', phone: '+447801257158' },
  { id: '9270f7ba-868a-41a6-9691-fc4546def473', name: 'Jade . (keep Jade Brown)', phone: '+447935785513' },
  { id: '392c9c49-0c0e-4499-a6b3-fdb159a8b05a', name: 'Jade (duplicate)', phone: '+447742116805' },
  { id: '5aac58fc-3b13-45f1-a691-e60ad9504c8c', name: 'Rory .', phone: '+447999348877' },
  { id: 'cb5ec7a9-a1e6-4270-92e6-106418b6d039', name: 'Pike .', phone: '+447513520317' },
  { id: '061257d4-6e26-4e04-aa4a-9fff591384b2', name: 'Paul . (keep Paul White)', phone: '+447795514533' },
  { id: '49582ace-e9ac-41ef-ae15-a012e8779545', name: 'Charlotte . (keep Linda Charlotte)', phone: '+447962373977' },
  { id: '8e0aa0a5-27e2-4142-a8a4-718644a93221', name: 'Ken & Lucy (keep Lucy .)', phone: '+447597537511' },
  { id: 'e466c524-7b95-47ec-aff3-7a471a740133', name: 'Shirley . (keep Shell Quiz Night)', phone: '+447860100825' },
  { id: '5195e34e-9eec-4aad-8cf9-296eb487e5b5', name: 'Lauren Harding (duplicate)', phone: '+447305866052' },
]

async function run(): Promise<void> {
  const argv = process.argv
  const confirm = isFlagPresent('--confirm', argv)
  const mutationEnabled = isDeleteApprovedDuplicatesMutationEnabled(argv, process.env)

  const HARD_CAP = 50

  if (isFlagPresent('--help', argv)) {
    console.log(`
delete-approved-duplicates (safe by default)

Dry-run (default):
  tsx scripts/cleanup/delete-approved-duplicates.ts

Mutation mode (requires multi-gating + explicit caps):
  RUN_DELETE_APPROVED_DUPLICATES_MUTATION=true \\
  ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT=true \\
    tsx scripts/cleanup/delete-approved-duplicates.ts --confirm --limit 10 [--offset 0]

Notes:
  - --limit is required in mutation mode (hard cap ${HARD_CAP}).
  - This script only deletes the curated IDs listed in the source file.
`)
    return
  }

  if (confirm && !mutationEnabled && !isFlagPresent('--dry-run', argv)) {
    throw new Error(
      'delete-approved-duplicates received --confirm but RUN_DELETE_APPROVED_DUPLICATES_MUTATION is not enabled. Set RUN_DELETE_APPROVED_DUPLICATES_MUTATION=true and ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT=true to apply deletions.'
    )
  }

  const supabase = createAdminClient()
  const modeLabel = mutationEnabled ? 'MUTATION' : 'DRY-RUN'

  console.log(`🗑️  delete-approved-duplicates (${modeLabel})`)
  console.log(`Targets in list: ${DUPLICATES_TO_DELETE.length}`)

  let offset = 0
  let limit = DUPLICATES_TO_DELETE.length

  if (mutationEnabled) {
    assertDeleteApprovedDuplicatesMutationAllowed(process.env)
    limit = assertDeleteApprovedDuplicatesLimit(
      readDeleteApprovedDuplicatesLimit(argv, process.env),
      HARD_CAP
    )
    offset = readDeleteApprovedDuplicatesOffset(argv, process.env) ?? 0
  }

  const selectedTargets = mutationEnabled
    ? DUPLICATES_TO_DELETE.slice(offset, offset + limit)
    : DUPLICATES_TO_DELETE

  if (mutationEnabled) {
    console.log(`Processing window: offset=${offset} limit=${limit}`)
  }

  if (selectedTargets.length === 0) {
    console.log('No targets selected for this run.')
    return
  }

  const customerIds = selectedTargets.map((target) => target.id)
  const { data: customersData, error: fetchError } = await supabase
    .from('customers')
    .select('id, first_name, last_name, mobile_number')
    .in('id', customerIds)

  const customers = assertScriptQuerySucceeded({
    operation: 'Fetch duplicate customer targets for delete-approved-duplicates',
    error: fetchError,
    data: customersData ?? [],
    allowMissing: true
  }) as CustomerRow[]

  assertDuplicateCleanupTargetsResolved({
    requestedIds: customerIds,
    fetchedRows: customers.map((row) => ({ id: row.id }))
  })

  console.log('\nCustomers to delete:')
  selectedTargets.forEach((target) => {
    const customer = customers.find((row) => row.id === target.id)
    console.log(`- ${customer?.first_name ?? 'Unknown'} ${customer?.last_name ?? ''}`.trim())
    console.log(`  ID: ${target.id}`)
    console.log(`  Phone (expected): ${target.phone}`)
    console.log(`  Phone (current): ${customer?.mobile_number ?? '<missing>'}`)
    console.log(`  Reason: ${target.name}`)
  })

  if (!mutationEnabled) {
    console.log('\nDry-run mode: no customers deleted.')
    console.log(
      'To delete, pass --confirm + --limit, and set RUN_DELETE_APPROVED_DUPLICATES_MUTATION=true and ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT=true.'
    )
    return
  }

  const failures: Array<{ customerId: string; reason: string }> = []
  let deletedCount = 0

  for (const target of selectedTargets) {
    const customer = customers.find((row) => row.id === target.id)
    const label = `${customer?.first_name ?? 'Unknown'} ${customer?.last_name ?? ''}`.trim() || target.id

    const { data: deletedRows, error: deleteError } = await supabase
      .from('customers')
      .delete()
      .eq('id', target.id)
      .select('id')

    try {
      const { updatedCount } = assertScriptMutationSucceeded({
        operation: `Delete customer ${label}`,
        error: deleteError,
        updatedRows: deletedRows as Array<{ id?: string }> | null,
        allowZeroRows: false
      })
      assertScriptExpectedRowCount({
        operation: `Delete customer ${label}`,
        expected: 1,
        actual: updatedCount
      })
      deletedCount += 1
      console.log(`✅ Deleted ${label} (${target.id})`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ customerId: target.id, reason: `delete_failed:${message}` })
      console.error(`❌ Failed deleting ${label}: ${message}`)
      continue
    }

    const auditPayload = {
      user_id: null,
      user_email: 'script@system',
      operation_type: 'delete',
      resource_type: 'customer',
      resource_id: target.id,
      operation_status: 'success',
      old_values: customer ?? null,
      new_values: null,
      error_message: null,
      additional_info: {
        script: 'delete-approved-duplicates.ts',
        reason: target.name,
        expected_phone: target.phone,
      }
    }

    const { data: auditRows, error: auditError } = await supabase
      .from('audit_logs')
      .insert(auditPayload)
      .select('id')

    try {
      const { updatedCount: auditCount } = assertScriptMutationSucceeded({
        operation: `Insert audit log for customer ${target.id}`,
        error: auditError,
        updatedRows: auditRows as Array<{ id?: string }> | null,
        allowZeroRows: false
      })
      assertScriptExpectedRowCount({
        operation: `Insert audit log for customer ${target.id}`,
        expected: 1,
        actual: auditCount
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ customerId: target.id, reason: `audit_failed:${message}` })
      console.error(`❌ Audit log insert failed for ${target.id}: ${message}`)
    }
  }

  console.log(`\nSummary: deleted ${deletedCount}/${selectedTargets.length} customer(s).`)
  assertDuplicateCleanupCompletedWithoutFailures(failures)
}

run().catch((error) => {
  console.error('delete-approved-duplicates failed:', error)
  process.exitCode = 1
})

