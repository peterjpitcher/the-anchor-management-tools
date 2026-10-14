import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reportWriteError, settleWrite } from '@/lib/supabase/settle-write'

const CHECK_VIOLATION = {
  code: '23514',
  message: 'new row for relation "payroll_month_approvals" violates check constraint',
  details: 'Failing row contains (...)',
  hint: null,
}

describe('settleWrite', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('reports a refused write at error level, field by field, and returns false', async () => {
    const ok = await settleWrite(Promise.resolve({ error: CHECK_VIOLATION }), {
      table: 'payroll_month_approvals',
      what: 'Clearing the payroll approval',
      ids: { year: 2026, month: 10 },
    })

    expect(ok).toBe(false)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith('[payroll_month_approvals] Clearing the payroll approval failed', {
      year: 2026,
      month: 10,
      code: '23514',
      message: CHECK_VIOLATION.message,
      details: 'Failing row contains (...)',
      hint: null,
    })
  })

  it('reports a write that throws, does not rethrow, and adds the note', async () => {
    const ok = await settleWrite(Promise.reject(new Error('fetch failed')), {
      table: 'invoices',
      what: 'Marking the invoice sent',
      note: 'the email itself was sent',
      ids: { invoiceId: 'inv-1' },
    })

    expect(ok).toBe(false)
    expect(consoleError).toHaveBeenCalledWith('[invoices] Marking the invoice sent threw; the email itself was sent', {
      invoiceId: 'inv-1',
      message: 'fetch failed',
    })
  })

  it('treats a write that resolves to nothing as failed rather than throwing', async () => {
    const ok = await settleWrite(Promise.resolve(undefined as unknown as { error: null }), {
      table: 'events',
      what: 'Closing bookings',
    })

    expect(ok).toBe(false)
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('stays quiet and returns true when the write succeeds', async () => {
    const ok = await settleWrite(Promise.resolve({ error: null }), { table: 'quotes', what: 'Marking the quote sent' })

    expect(ok).toBe(true)
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('reportWriteError', () => {
  it('reports an error already in hand', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportWriteError(CHECK_VIOLATION, { table: 'signing_documents', what: 'Voiding older versions', ids: { seriesId: 's-1' } })
    expect(consoleError).toHaveBeenCalledWith('[signing_documents] Voiding older versions failed', {
      seriesId: 's-1',
      code: '23514',
      message: CHECK_VIOLATION.message,
      details: 'Failing row contains (...)',
      hint: null,
    })
    consoleError.mockRestore()
  })
})
