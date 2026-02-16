import { describe, expect, it, vi } from 'vitest'

import {
  hasSentInvoiceEmailLog,
  insertSentInvoiceEmailLogs,
  assertInvoiceReminderScriptCompletedWithoutErrors
} from '@/lib/invoice-reminder-safety'

describe('invoice reminder safety helpers', () => {
  it('returns an error when reminder dedupe lookup fails', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'invoice_email_logs read failed' }
    })
    const eqSubject = vi.fn().mockReturnValue({ maybeSingle })
    const eqStatus = vi.fn().mockReturnValue({ eq: eqSubject })
    const eqInvoice = vi.fn().mockReturnValue({ eq: eqStatus })
    const select = vi.fn().mockReturnValue({ eq: eqInvoice })

    const supabase = {
      from: vi.fn(() => ({ select }))
    }

    const result = await hasSentInvoiceEmailLog(supabase, {
      invoiceId: 'invoice-1',
      subject: 'Reminder subject'
    })

    expect(result).toEqual({
      exists: true,
      error: 'invoice_email_logs read failed'
    })
  })

  it('reports dedupe hit when reminder log row exists', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'log-1' },
      error: null
    })
    const eqSubject = vi.fn().mockReturnValue({ maybeSingle })
    const eqStatus = vi.fn().mockReturnValue({ eq: eqSubject })
    const eqInvoice = vi.fn().mockReturnValue({ eq: eqStatus })
    const select = vi.fn().mockReturnValue({ eq: eqInvoice })

    const supabase = {
      from: vi.fn(() => ({ select }))
    }

    const result = await hasSentInvoiceEmailLog(supabase, {
      invoiceId: 'invoice-2',
      subject: 'Reminder subject'
    })

    expect(result).toEqual({ exists: true })
  })

  it('returns an error when reminder send-log persistence fails', async () => {
    const insert = vi.fn().mockResolvedValue({
      error: { message: 'insert failed' }
    })
    const supabase = {
      from: vi.fn(() => ({ insert }))
    }

    const result = await insertSentInvoiceEmailLogs(supabase, [
      {
        invoice_id: 'invoice-3',
        sent_to: 'vendor@example.com',
        sent_by: 'system',
        subject: 'Reminder',
        body: 'Reminder body',
        status: 'sent'
      }
    ])

    expect(result).toEqual({ error: 'insert failed' })
  })

  it('throws when reminder script completes with processing errors', () => {
    expect(() =>
      assertInvoiceReminderScriptCompletedWithoutErrors([
        {
          invoice_number: 'INV-1001',
          vendor: 'Acme',
          error: 'Customer reminder sent but log persistence failed'
        }
      ])
    ).toThrow(
      'Invoice reminders script completed with 1 error(s): INV-1001:Customer reminder sent but log persistence failed'
    )
  })

  it('does not throw when reminder script has no errors', () => {
    expect(() => assertInvoiceReminderScriptCompletedWithoutErrors([])).not.toThrow()
  })
})
