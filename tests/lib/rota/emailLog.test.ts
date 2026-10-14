import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settleRotaEmailLogWrite } from '@/lib/rota/email-log'

// The check constraint refusal that went unreported from 18 August to 13 October 2026.
const CHECK_VIOLATION = {
  code: '23514',
  message: 'new row for relation "rota_email_log" violates check constraint "rota_email_log_email_type_check"',
  details: 'Failing row contains (...)',
  hint: null,
}

describe('settleRotaEmailLogWrite', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('reports a refused write at error level, field by field, and does not throw', async () => {
    const ok = await settleRotaEmailLogWrite(Promise.resolve({ error: CHECK_VIOLATION }), {
      type: 'unfilled_urgent',
      entityId: 'shift-1',
    })

    expect(ok).toBe(false)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[rota_email_log] Log write failed'),
      {
        emailType: 'unfilled_urgent',
        entityId: 'shift-1',
        code: '23514',
        message: CHECK_VIOLATION.message,
        details: 'Failing row contains (...)',
        hint: null,
      },
    )
  })

  it('reports a write that throws and does not rethrow', async () => {
    const ok = await settleRotaEmailLogWrite(Promise.reject(new Error('fetch failed')), {
      type: 'staff_rota',
      entityId: 'week-1',
    })

    expect(ok).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[rota_email_log] Log write threw'),
      { emailType: 'staff_rota', entityId: 'week-1', message: 'fetch failed' },
    )
  })

  it('stays quiet when the write succeeds', async () => {
    const ok = await settleRotaEmailLogWrite(Promise.resolve({ error: null }), {
      type: 'payroll_export',
      entityId: 'approval-1',
    })

    expect(ok).toBe(true)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
