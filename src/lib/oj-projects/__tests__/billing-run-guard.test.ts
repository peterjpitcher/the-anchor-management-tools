import { describe, expect, it } from 'vitest'
import {
  BILLING_RUN_IN_FLIGHT_GRACE_MS,
  shouldSkipConcurrentBillingRun,
} from '@/lib/oj-projects/billing-run-guard'

const NOW_MS = Date.parse('2026-09-01T01:05:10.000Z')

describe('shouldSkipConcurrentBillingRun', () => {
  it('allows a new run created by the current invocation to continue', () => {
    expect(shouldSkipConcurrentBillingRun({
      createdByThisInvocation: true,
      status: 'processing',
      invoiceId: null,
      startedAt: '2026-09-01T01:05:09.500Z',
      nowMs: NOW_MS,
    })).toBe(false)
  })

  it('skips an existing recent run owned by another invocation', () => {
    expect(shouldSkipConcurrentBillingRun({
      createdByThisInvocation: false,
      status: 'processing',
      invoiceId: null,
      startedAt: '2026-09-01T01:05:09.500Z',
      nowMs: NOW_MS,
    })).toBe(true)
  })

  it('allows an existing stale run to be recovered', () => {
    expect(shouldSkipConcurrentBillingRun({
      createdByThisInvocation: false,
      status: 'processing',
      invoiceId: null,
      startedAt: new Date(NOW_MS - BILLING_RUN_IN_FLIGHT_GRACE_MS).toISOString(),
      nowMs: NOW_MS,
    })).toBe(false)
  })

  it('allows reconciliation when the run already has an invoice', () => {
    expect(shouldSkipConcurrentBillingRun({
      createdByThisInvocation: false,
      status: 'processing',
      invoiceId: 'invoice-1',
      startedAt: '2026-09-01T01:05:09.500Z',
      nowMs: NOW_MS,
    })).toBe(false)
  })

  it('treats an invalid start time as recoverable', () => {
    expect(shouldSkipConcurrentBillingRun({
      createdByThisInvocation: false,
      status: 'processing',
      invoiceId: null,
      startedAt: null,
      nowMs: NOW_MS,
    })).toBe(false)
  })
})
