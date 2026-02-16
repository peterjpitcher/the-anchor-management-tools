import { describe, expect, it } from 'vitest'
import {
  assertDeleteInvoiceCleanupCompletedWithoutFailures,
  assertDeleteInvoiceCleanupLimit,
  assertDeleteInvoiceCleanupMutationAllowed,
  assertDeleteInvoiceCleanupMutationSucceeded,
  isDeleteInvoiceCleanupMutationRunEnabled,
  readDeleteInvoiceCleanupLimit,
  resolveDeleteInvoiceCleanupRows
} from '@/lib/delete-invoice-cleanup-safety'

describe('delete-invoice-cleanup safety', () => {
  it('requires --confirm and RUN env to enable mutation mode', () => {
    const previous = process.env.RUN_DELETE_TEST_INVOICES_MUTATION
    process.env.RUN_DELETE_TEST_INVOICES_MUTATION = 'true'

    expect(
      isDeleteInvoiceCleanupMutationRunEnabled({
        argv: ['tsx', 'script.ts'],
        runEnvVar: 'RUN_DELETE_TEST_INVOICES_MUTATION'
      })
    ).toBe(false)
    expect(
      isDeleteInvoiceCleanupMutationRunEnabled({
        argv: ['tsx', 'script.ts', '--confirm'],
        runEnvVar: 'RUN_DELETE_TEST_INVOICES_MUTATION'
      })
    ).toBe(true)

    if (previous === undefined) {
      delete process.env.RUN_DELETE_TEST_INVOICES_MUTATION
    } else {
      process.env.RUN_DELETE_TEST_INVOICES_MUTATION = previous
    }
  })

  it('blocks mutation when allow env is missing', () => {
    const previous = process.env.ALLOW_DELETE_TEST_INVOICES_MUTATION
    delete process.env.ALLOW_DELETE_TEST_INVOICES_MUTATION

    expect(() =>
      assertDeleteInvoiceCleanupMutationAllowed({
        scriptName: 'delete-test-invoices',
        allowEnvVar: 'ALLOW_DELETE_TEST_INVOICES_MUTATION'
      })
    ).toThrow(
      'delete-test-invoices blocked by safety guard. Set ALLOW_DELETE_TEST_INVOICES_MUTATION=true to run this mutation script.'
    )

    if (previous === undefined) {
      delete process.env.ALLOW_DELETE_TEST_INVOICES_MUTATION
    } else {
      process.env.ALLOW_DELETE_TEST_INVOICES_MUTATION = previous
    }
  })

  it('reads --limit from argv or env fallback', () => {
    expect(
      readDeleteInvoiceCleanupLimit({
        argv: ['tsx', 'script.ts', '--limit', '7'],
        limitEnvVar: 'DELETE_TEST_INVOICES_LIMIT'
      })
    ).toBe(7)

    const previous = process.env.DELETE_TEST_INVOICES_LIMIT
    process.env.DELETE_TEST_INVOICES_LIMIT = '9'
    expect(
      readDeleteInvoiceCleanupLimit({
        argv: ['tsx', 'script.ts'],
        limitEnvVar: 'DELETE_TEST_INVOICES_LIMIT'
      })
    ).toBe(9)
    if (previous === undefined) {
      delete process.env.DELETE_TEST_INVOICES_LIMIT
    } else {
      process.env.DELETE_TEST_INVOICES_LIMIT = previous
    }
  })

  it('requires a positive mutation limit within hard cap', () => {
    expect(() =>
      assertDeleteInvoiceCleanupLimit({
        scriptName: 'delete-test-invoices',
        limit: null,
        hardCap: 200
      })
    ).toThrow('delete-test-invoices blocked: --limit is required in mutation mode.')

    expect(() =>
      assertDeleteInvoiceCleanupLimit({
        scriptName: 'delete-test-invoices',
        limit: 201,
        hardCap: 200
      })
    ).toThrow(
      'delete-test-invoices blocked: --limit 201 exceeds hard cap 200. Run in smaller batches.'
    )

    expect(
      assertDeleteInvoiceCleanupLimit({
        scriptName: 'delete-test-invoices',
        limit: 20,
        hardCap: 200
      })
    ).toBe(20)
  })

  it('supports strict hard-cap=1 enforcement for delete-specific-invoice', () => {
    expect(() =>
      assertDeleteInvoiceCleanupLimit({
        scriptName: 'delete-specific-invoice',
        limit: 2,
        hardCap: 1
      })
    ).toThrow(
      'delete-specific-invoice blocked: --limit 2 exceeds hard cap 1. Run in smaller batches.'
    )

    expect(
      assertDeleteInvoiceCleanupLimit({
        scriptName: 'delete-specific-invoice',
        limit: 1,
        hardCap: 1
      })
    ).toBe(1)
  })

  it('fails closed when query errors', () => {
    expect(() =>
      resolveDeleteInvoiceCleanupRows({
        operation: 'Load TEST-* invoices',
        rows: null,
        error: { message: 'invoices lookup failed' }
      })
    ).toThrow('Load TEST-* invoices failed: invoices lookup failed')
  })

  it('fails closed when mutation row count mismatches expected', () => {
    expect(() =>
      assertDeleteInvoiceCleanupMutationSucceeded({
        operation: 'Delete invoice row for TEST-1',
        error: null,
        rows: [{ id: 'invoice-1' }],
        expectedCount: 2
      })
    ).toThrow('Delete invoice row for TEST-1 affected unexpected row count (expected 2, got 1)')
  })

  it('fails closed when mutation returns database error', () => {
    expect(() =>
      assertDeleteInvoiceCleanupMutationSucceeded({
        operation: 'Delete invoice row for TEST-1',
        error: { message: 'delete failed' },
        rows: null,
        expectedCount: 1
      })
    ).toThrow('Delete invoice row for TEST-1 failed: delete failed')
  })

  it('fails completion when unresolved failures remain', () => {
    expect(() =>
      assertDeleteInvoiceCleanupCompletedWithoutFailures({
        scriptName: 'delete-test-invoices',
        failureCount: 1,
        failures: ['Expected 0 remaining targeted TEST-* invoices, found 2']
      })
    ).toThrow(
      'delete-test-invoices completed with 1 failure(s): Expected 0 remaining targeted TEST-* invoices, found 2'
    )
  })
})
