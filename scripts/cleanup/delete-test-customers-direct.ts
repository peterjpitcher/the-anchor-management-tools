#!/usr/bin/env tsx

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import {
  assertDeleteTestCustomersDirectCompletedWithoutFailures,
  assertDeleteTestCustomersDirectLimit,
  assertDeleteTestCustomersDirectMutationAllowed,
  assertDeleteTestCustomersDirectMutationSucceeded,
  assertDeleteTestCustomersDirectTargetMatches,
  isDeleteTestCustomersDirectMutationRunEnabled,
  readDeleteTestCustomersDirectLimit,
  resolveDeleteTestCustomersDirectRows
} from '../../src/lib/delete-test-customers-direct-safety'
import { createAdminClient } from '../../src/lib/supabase/admin'

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
}

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

async function deleteTestCustomersDirect(): Promise<void> {
  const hasConfirmFlag = process.argv.includes('--confirm')
  const runMutations = isDeleteTestCustomersDirectMutationRunEnabled(process.argv)
  const HARD_CAP = 50
  const limit = readDeleteTestCustomersDirectLimit(process.argv)

  if (runMutations) {
    assertDeleteTestCustomersDirectMutationAllowed()
    assertDeleteTestCustomersDirectLimit(limit ?? 0, HARD_CAP)
    console.log('Mutation mode enabled for delete-test-customers-direct.')
  } else if (hasConfirmFlag) {
    throw new Error(
      'delete-test-customers-direct received --confirm but RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION is not enabled. Set RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true and ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true to apply deletions.'
    )
  } else {
    console.log(
      'Read-only mode. Re-run with --confirm plus RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true and ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true to apply deletions.'
    )
  }

  const supabase = createAdminClient()
  console.log('Inspecting customers matching test-name filters.\n')

  const { data: customerRowsRaw, error: customerRowsError } = await supabase
    .from('customers')
    .select('id, first_name, last_name')
    .or('first_name.ilike.%test%,last_name.ilike.%test%')

  const customerRows = resolveDeleteTestCustomersDirectRows<CustomerRow>({
    operation: 'Load customers matching test-name filters',
    rows: customerRowsRaw as CustomerRow[] | null,
    error: customerRowsError
  })

  if (customerRows.length === 0) {
    console.log('No test customers found.')
    return
  }

  console.log(`Found ${customerRows.length} customer(s):`)
  customerRows.forEach((customer) => {
    const displayName = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Unknown'
    console.log(`  - ${displayName} (${customer.id})`)
  })
  console.log()

  const customersToProcess = runMutations
    ? customerRows.slice(0, Math.min(customerRows.length, limit ?? 0))
    : customerRows

  if (runMutations && customersToProcess.length < customerRows.length) {
    console.log(
      `Cap applied: deleting ${customersToProcess.length}/${customerRows.length} customer(s) in this run (hard cap ${HARD_CAP}).`
    )
    console.log()
  }

  const failures: string[] = []
  const deletedCustomerIds: string[] = []

  for (const customer of customersToProcess) {
    const displayName = `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || customer.id

    try {
      assertDeleteTestCustomersDirectTargetMatches({
        customerId: customer.id,
        firstName: customer.first_name,
        lastName: customer.last_name
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error(`❌ Target validation failed for ${displayName}: ${message}`)
      continue
    }

    if (!runMutations) {
      continue
    }

    const { data: deletedCustomerRows, error: deleteCustomerError } = await supabase
      .from('customers')
      .delete()
      .eq('id', customer.id)
      .select('id')

    try {
      assertDeleteTestCustomersDirectMutationSucceeded({
        operation: `Delete customer ${customer.id}`,
        error: deleteCustomerError,
        rows: deletedCustomerRows as Array<{ id?: string }> | null,
        expectedCount: 1
      })
      deletedCustomerIds.push(customer.id)
      console.log(`✅ Deleted ${displayName}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error(`❌ Delete failed for ${displayName}: ${message}`)
      continue
    }

    const { data: auditRows, error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        action: 'bulk_delete',
        entity_type: 'customer',
        entity_id: customer.id,
        metadata: {
          reason: 'Bulk deletion of test customers via script',
          script: 'delete-test-customers-direct.ts',
          customer_name: displayName
        }
      })
      .select('id')

    try {
      assertDeleteTestCustomersDirectMutationSucceeded({
        operation: `Insert delete-test-customers-direct audit row for ${customer.id}`,
        error: auditError,
        rows: auditRows as Array<{ id?: string }> | null,
        expectedCount: 1
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error(`❌ Audit insert failed for ${displayName}: ${message}`)
    }
  }

  if (runMutations && deletedCustomerIds.length > 0) {
    const { data: remainingRowsRaw, error: remainingRowsError } = await supabase
      .from('customers')
      .select('id')
      .in('id', deletedCustomerIds)

    const remainingRows = resolveDeleteTestCustomersDirectRows<{ id: string }>({
      operation: 'Verify deleted test customers no longer exist',
      rows: remainingRowsRaw as Array<{ id: string }> | null,
      error: remainingRowsError
    })

    if (remainingRows.length > 0) {
      failures.push(
        `Expected 0 remaining deleted test customers, found ${remainingRows.length}`
      )
    }
  }

  if (runMutations) {
    assertDeleteTestCustomersDirectCompletedWithoutFailures({
      failureCount: failures.length,
      failures
    })
    console.log(
      `\n✅ delete-test-customers-direct completed without unresolved failures. Deleted ${deletedCustomerIds.length} customer(s).`
    )
    return
  }

  if (failures.length > 0) {
    assertDeleteTestCustomersDirectCompletedWithoutFailures({
      failureCount: failures.length,
      failures
    })
  }

  console.log('Read-only inspection completed without unresolved failures.')
  console.log(
    `Re-run with --confirm --limit <n> plus RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true and ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true to delete up to ${HARD_CAP} customer(s) per batch.`
  )
}

deleteTestCustomersDirect().catch((error) => {
  console.error('delete-test-customers-direct script failed:', error)
  process.exitCode = 1
})
