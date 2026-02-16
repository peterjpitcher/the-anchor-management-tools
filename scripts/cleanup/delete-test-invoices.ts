#!/usr/bin/env tsx

import { config } from 'dotenv'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertDeleteInvoiceCleanupCompletedWithoutFailures,
  assertDeleteInvoiceCleanupLimit,
  assertDeleteInvoiceCleanupMutationAllowed,
  assertDeleteInvoiceCleanupMutationSucceeded,
  isDeleteInvoiceCleanupMutationRunEnabled,
  readDeleteInvoiceCleanupLimit,
  resolveDeleteInvoiceCleanupRows
} from '../../src/lib/delete-invoice-cleanup-safety'

type InvoiceRow = {
  id: string
  invoice_number: string | null
  total_amount: number | null
  created_at: string | null
}

config({ path: '.env.local' })

async function deleteTestInvoices(): Promise<void> {
  const HARD_CAP = 200
  const hasConfirmFlag = process.argv.includes('--confirm')
  const runMutations = isDeleteInvoiceCleanupMutationRunEnabled({
    argv: process.argv,
    runEnvVar: 'RUN_DELETE_TEST_INVOICES_MUTATION'
  })
  const mutationLimit = runMutations
    ? assertDeleteInvoiceCleanupLimit({
      scriptName: 'delete-test-invoices',
      limit: readDeleteInvoiceCleanupLimit({
        argv: process.argv,
        limitEnvVar: 'DELETE_TEST_INVOICES_LIMIT'
      }),
      hardCap: HARD_CAP
    })
    : null

  if (runMutations) {
    assertDeleteInvoiceCleanupMutationAllowed({
      scriptName: 'delete-test-invoices',
      allowEnvVar: 'ALLOW_DELETE_TEST_INVOICES_MUTATION'
    })
    console.log(`Mutation mode enabled for delete-test-invoices (limit=${mutationLimit}).`)
  } else if (hasConfirmFlag) {
    throw new Error(
      'delete-test-invoices received --confirm but RUN_DELETE_TEST_INVOICES_MUTATION is not enabled. Set RUN_DELETE_TEST_INVOICES_MUTATION=true and ALLOW_DELETE_TEST_INVOICES_MUTATION=true, and pass --limit, to apply deletions.'
    )
  } else {
    console.log(
      'Read-only mode. Re-run with --confirm --limit <n> plus RUN_DELETE_TEST_INVOICES_MUTATION=true and ALLOW_DELETE_TEST_INVOICES_MUTATION=true to apply deletions.'
    )
  }

  const supabase = createAdminClient()
  console.log('Inspecting invoices with invoice_number like TEST-%.')

  const { data: invoiceRowsRaw, error: invoiceRowsError } = await supabase
    .from('invoices')
    .select('id, invoice_number, total_amount, created_at')
    .like('invoice_number', 'TEST-%')
    .order('created_at', { ascending: false })

  const invoices = resolveDeleteInvoiceCleanupRows<InvoiceRow>({
    operation: 'Load TEST-* invoices',
    rows: invoiceRowsRaw as InvoiceRow[] | null,
    error: invoiceRowsError
  })

  if (invoices.length === 0) {
    console.log('No TEST-* invoices found.')
    return
  }

  if (runMutations && mutationLimit !== null && invoices.length > mutationLimit) {
    throw new Error(
      `delete-test-invoices blocked: matched ${invoices.length} invoice(s), exceeding --limit ${mutationLimit}.`
    )
  }

  console.log(`Found ${invoices.length} test invoice(s):`)
  invoices.forEach((invoice, index) => {
    console.log(
      `  ${index + 1}. ${invoice.invoice_number ?? 'unknown'} | amount=${invoice.total_amount ?? 0} | created=${invoice.created_at ?? 'unknown'}`
    )
  })

  if (!runMutations) {
    return
  }

  const failures: string[] = []
  const targetedInvoiceIds = invoices.map((invoice) => invoice.id)

  for (const invoice of invoices) {
    const label = invoice.invoice_number ?? invoice.id

    const { data: emailLogRowsRaw, error: emailLogRowsError } = await supabase
      .from('invoice_email_logs')
      .select('id')
      .eq('invoice_id', invoice.id)

    let expectedEmailLogDeletes = 0
    try {
      const emailLogRows = resolveDeleteInvoiceCleanupRows<{ id: string }>({
        operation: `Load invoice email logs for ${label}`,
        rows: emailLogRowsRaw as Array<{ id: string }> | null,
        error: emailLogRowsError
      })
      expectedEmailLogDeletes = emailLogRows.length
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error(`❌ ${message}`)
      continue
    }

    const { data: deletedEmailLogRows, error: deleteEmailLogsError } = await supabase
      .from('invoice_email_logs')
      .delete()
      .eq('invoice_id', invoice.id)
      .select('id')

    try {
      assertDeleteInvoiceCleanupMutationSucceeded({
        operation: `Delete invoice email logs for ${label}`,
        error: deleteEmailLogsError,
        rows: deletedEmailLogRows as Array<{ id?: string }> | null,
        expectedCount: expectedEmailLogDeletes
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error(`❌ ${message}`)
      continue
    }

    const { data: deletedInvoiceRows, error: deleteInvoiceError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoice.id)
      .select('id')

    try {
      assertDeleteInvoiceCleanupMutationSucceeded({
        operation: `Delete invoice row for ${label}`,
        error: deleteInvoiceError,
        rows: deletedInvoiceRows as Array<{ id?: string }> | null,
        expectedCount: 1
      })
      console.log(`✅ Deleted ${label}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error(`❌ ${message}`)
      continue
    }

    const { data: auditRows, error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        action: 'bulk_delete',
        entity_type: 'invoice',
        entity_id: invoice.id,
        metadata: {
          reason: 'Delete TEST-* invoices cleanup script',
          script: 'delete-test-invoices.ts',
          invoice_number: invoice.invoice_number
        }
      })
      .select('id')

    try {
      assertDeleteInvoiceCleanupMutationSucceeded({
        operation: `Insert delete-test-invoices audit row for ${label}`,
        error: auditError,
        rows: auditRows as Array<{ id?: string }> | null,
        expectedCount: 1
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error(`❌ ${message}`)
    }
  }

  const { data: remainingInvoicesRaw, error: remainingInvoicesError } = await supabase
    .from('invoices')
    .select('id')
    .in('id', targetedInvoiceIds)

  const remainingInvoices = resolveDeleteInvoiceCleanupRows<{ id: string }>({
    operation: 'Verify targeted TEST-* invoices no longer exist',
    rows: remainingInvoicesRaw as Array<{ id: string }> | null,
    error: remainingInvoicesError
  })

  if (remainingInvoices.length > 0) {
    failures.push(
      `Expected 0 remaining targeted TEST-* invoices, found ${remainingInvoices.length}`
    )
  }

  assertDeleteInvoiceCleanupCompletedWithoutFailures({
    scriptName: 'delete-test-invoices',
    failureCount: failures.length,
    failures
  })

  console.log('\n✅ delete-test-invoices completed without unresolved failures.')
}

deleteTestInvoices().catch((error) => {
  console.error('delete-test-invoices script failed:', error)
  process.exitCode = 1
})
