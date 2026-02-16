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

function resolveInvoiceIdArg(argv: string[]): string {
  const optionArg = argv.find((arg) => arg.startsWith('--invoice-id='))
  if (optionArg) {
    const invoiceId = optionArg.split('=')[1]?.trim()
    if (invoiceId) {
      return invoiceId
    }
  }

  const positional = argv.slice(2).find((arg) => !arg.startsWith('--'))
  if (positional && positional.trim().length > 0) {
    return positional.trim()
  }

  throw new Error(
    'Missing invoice id. Provide --invoice-id=<uuid> (or a positional invoice id) to target a single invoice.'
  )
}

config({ path: '.env.local' })

async function deleteSpecificInvoice(): Promise<void> {
  const HARD_CAP = 1
  const invoiceId = resolveInvoiceIdArg(process.argv)
  const hasConfirmFlag = process.argv.includes('--confirm')
  const runMutations = isDeleteInvoiceCleanupMutationRunEnabled({
    argv: process.argv,
    runEnvVar: 'RUN_DELETE_SPECIFIC_INVOICE_MUTATION'
  })
  const mutationLimit = runMutations
    ? assertDeleteInvoiceCleanupLimit({
      scriptName: 'delete-specific-invoice',
      limit: readDeleteInvoiceCleanupLimit({
        argv: process.argv,
        limitEnvVar: 'DELETE_SPECIFIC_INVOICE_LIMIT'
      }),
      hardCap: HARD_CAP
    })
    : null

  if (runMutations) {
    assertDeleteInvoiceCleanupMutationAllowed({
      scriptName: 'delete-specific-invoice',
      allowEnvVar: 'ALLOW_DELETE_SPECIFIC_INVOICE_MUTATION'
    })
    console.log(`Mutation mode enabled for delete-specific-invoice (limit=${mutationLimit}).`)
  } else if (hasConfirmFlag) {
    throw new Error(
      'delete-specific-invoice received --confirm but RUN_DELETE_SPECIFIC_INVOICE_MUTATION is not enabled. Set RUN_DELETE_SPECIFIC_INVOICE_MUTATION=true and ALLOW_DELETE_SPECIFIC_INVOICE_MUTATION=true, and pass --limit, to apply deletions.'
    )
  } else {
    console.log(
      'Read-only mode. Re-run with --confirm --limit 1 plus RUN_DELETE_SPECIFIC_INVOICE_MUTATION=true and ALLOW_DELETE_SPECIFIC_INVOICE_MUTATION=true to apply deletions.'
    )
  }

  const supabase = createAdminClient()
  console.log(`Inspecting invoice ${invoiceId}.\n`)

  const { data: invoiceRowsRaw, error: invoiceRowsError } = await supabase
    .from('invoices')
    .select('id, invoice_number, total_amount, created_at')
    .eq('id', invoiceId)

  const invoiceRows = resolveDeleteInvoiceCleanupRows<InvoiceRow>({
    operation: `Load invoice row ${invoiceId}`,
    rows: invoiceRowsRaw as InvoiceRow[] | null,
    error: invoiceRowsError
  })

  if (invoiceRows.length === 0) {
    console.log(`No invoice row found for ${invoiceId}.`)
    return
  }

  if (runMutations && mutationLimit !== null && invoiceRows.length > mutationLimit) {
    throw new Error(
      `delete-specific-invoice blocked: matched ${invoiceRows.length} invoice row(s), exceeding --limit ${mutationLimit}.`
    )
  }

  const invoice = invoiceRows[0]
  const label = invoice.invoice_number ?? invoice.id
  console.log(
    `Target invoice: ${label} | amount=${invoice.total_amount ?? 0} | created=${invoice.created_at ?? 'unknown'}`
  )

  const { data: lineItemRowsRaw, error: lineItemRowsError } = await supabase
    .from('invoice_line_items')
    .select('id')
    .eq('invoice_id', invoiceId)

  const lineItemRows = resolveDeleteInvoiceCleanupRows<{ id: string }>({
    operation: `Load invoice line items for ${label}`,
    rows: lineItemRowsRaw as Array<{ id: string }> | null,
    error: lineItemRowsError
  })
  console.log(`Found ${lineItemRows.length} invoice line item(s).`)

  if (!runMutations) {
    return
  }

  const failures: string[] = []

  const { data: deletedLineItemRows, error: deleteLineItemsError } = await supabase
    .from('invoice_line_items')
    .delete()
    .eq('invoice_id', invoiceId)
    .select('id')

  try {
    assertDeleteInvoiceCleanupMutationSucceeded({
      operation: `Delete invoice line items for ${label}`,
      error: deleteLineItemsError,
      rows: deletedLineItemRows as Array<{ id?: string }> | null,
      expectedCount: lineItemRows.length
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(message)
    console.error(`❌ ${message}`)
  }

  if (failures.length === 0) {
    const { data: deletedInvoiceRows, error: deleteInvoiceError } = await supabase
      .from('invoices')
      .delete()
      .eq('id', invoiceId)
      .select('id')

    try {
      assertDeleteInvoiceCleanupMutationSucceeded({
        operation: `Delete invoice row for ${label}`,
        error: deleteInvoiceError,
        rows: deletedInvoiceRows as Array<{ id?: string }> | null,
        expectedCount: 1
      })
      console.log(`✅ Deleted invoice ${label}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(message)
      console.error(`❌ ${message}`)
    }
  }

  if (failures.length === 0) {
    const { data: auditRows, error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        action: 'delete',
        entity_type: 'invoice',
        entity_id: invoiceId,
        metadata: {
          reason: 'Delete specific invoice cleanup script',
          script: 'delete-specific-invoice.ts',
          invoice_number: invoice.invoice_number
        }
      })
      .select('id')

    try {
      assertDeleteInvoiceCleanupMutationSucceeded({
        operation: `Insert delete-specific-invoice audit row for ${label}`,
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

  const { data: remainingInvoiceRowsRaw, error: remainingInvoiceRowsError } = await supabase
    .from('invoices')
    .select('id')
    .eq('id', invoiceId)

  const remainingInvoiceRows = resolveDeleteInvoiceCleanupRows<{ id: string }>({
    operation: `Verify invoice ${invoiceId} no longer exists`,
    rows: remainingInvoiceRowsRaw as Array<{ id: string }> | null,
    error: remainingInvoiceRowsError
  })

  if (remainingInvoiceRows.length > 0) {
    failures.push(`Expected invoice ${invoiceId} to be deleted, but it still exists`)
  }

  const { data: remainingLineItemRowsRaw, error: remainingLineItemRowsError } = await supabase
    .from('invoice_line_items')
    .select('id')
    .eq('invoice_id', invoiceId)

  const remainingLineItemRows = resolveDeleteInvoiceCleanupRows<{ id: string }>({
    operation: `Verify invoice line items for ${invoiceId} no longer exist`,
    rows: remainingLineItemRowsRaw as Array<{ id: string }> | null,
    error: remainingLineItemRowsError
  })

  if (remainingLineItemRows.length > 0) {
    failures.push(
      `Expected 0 remaining invoice line items for ${invoiceId}, found ${remainingLineItemRows.length}`
    )
  }

  assertDeleteInvoiceCleanupCompletedWithoutFailures({
    scriptName: 'delete-specific-invoice',
    failureCount: failures.length,
    failures
  })

  console.log('\n✅ delete-specific-invoice completed without unresolved failures.')
}

deleteSpecificInvoice().catch((error) => {
  console.error('delete-specific-invoice script failed:', error)
  process.exitCode = 1
})
