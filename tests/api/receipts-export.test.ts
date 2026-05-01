import { describe, it, expect } from 'vitest';
import {
  buildOjProjectInvoiceSummaryCsv,
  loadOjProjectInvoicesPaidInQuarter,
} from '@/lib/receipts/export/oj-project-invoices'

// Inline copy of the helper to test the logic independently
function escapeCsvCell(value: string): string {
  if (!value || typeof value !== 'string') return value;
  if (['=', '+', '-', '@'].includes(value[0])) {
    return '\t' + value;
  }
  return value;
}

describe('escapeCsvCell', () => {
  it('should prefix = with a tab', () => {
    expect(escapeCsvCell('=SUM(A1:A10)')).toBe('\t=SUM(A1:A10)');
  });
  it('should prefix + with a tab', () => {
    expect(escapeCsvCell('+1234')).toBe('\t+1234');
  });
  it('should prefix - with a tab', () => {
    expect(escapeCsvCell('-1234')).toBe('\t-1234');
  });
  it('should prefix @ with a tab', () => {
    expect(escapeCsvCell('@user')).toBe('\t@user');
  });
  it('should not modify safe values', () => {
    expect(escapeCsvCell('Tesco')).toBe('Tesco');
    expect(escapeCsvCell('100.00')).toBe('100.00');
    expect(escapeCsvCell('')).toBe('');
  });
});

describe('OJ Projects invoice receipts export helpers', () => {
  it('loads only invoice payments linked to OJ Projects plus linked paid_at rows for the quarter', async () => {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = []
    const invoiceRows = [
      invoiceRow({ id: 'entry-paid-at-invoice', invoice_number: 'INV-ENTRY', invoice_date: '2026-03-02' }),
      invoiceRow({ id: 'payment-linked-invoice', invoice_number: 'INV-PAYMENT', invoice_date: '2026-01-02' }),
      invoiceRow({ id: 'recurring-paid-at-invoice', invoice_number: 'INV-RECUR', invoice_date: '2026-03-04' }),
    ]

    const supabase = {
      from: (table: string) => createQuery(table, calls, invoiceRows),
    }

    const invoices = await loadOjProjectInvoicesPaidInQuarter(
      supabase as any,
      '2026-01-01',
      '2026-03-31'
    )

    expect(invoices.map((invoice) => invoice.id)).toEqual([
      'payment-linked-invoice',
      'entry-paid-at-invoice',
      'recurring-paid-at-invoice',
    ])

    expect(calls).toContainEqual({
      table: 'invoice_payments',
      method: 'gte',
      args: ['payment_date', '2026-01-01'],
    })
    expect(calls).toContainEqual({
      table: 'invoice_payments',
      method: 'lte',
      args: ['payment_date', '2026-03-31'],
    })
    expect(calls).toContainEqual({
      table: 'oj_entries',
      method: 'lt',
      args: ['paid_at', '2026-04-01T00:00:00.000Z'],
    })
    expect(calls).toContainEqual({
      table: 'invoices',
      method: 'in',
      args: ['id', ['payment-linked-invoice', 'entry-paid-at-invoice', 'recurring-paid-at-invoice']],
    })
  })

  it('summarises OJ Project invoices and only lists payments inside the exported quarter', () => {
    const csv = buildOjProjectInvoiceSummaryCsv(
      [
        invoiceRow({
          id: 'invoice-1',
          invoice_number: '=INV-001',
          vendor: { name: '@Client' },
          payments: [
            { id: 'payment-1', invoice_id: 'invoice-1', payment_date: '2026-02-15', amount: 123.45, payment_method: 'bank_transfer', created_at: '2026-02-15T00:00:00Z' },
            { id: 'payment-2', invoice_id: 'invoice-1', payment_date: '2026-04-01', amount: 50, payment_method: 'bank_transfer', created_at: '2026-04-01T00:00:00Z' },
          ],
        }),
      ],
      { year: 2026, quarter: 1, startDate: '2026-01-01', endDate: '2026-03-31' }
    ).toString('utf-8')

    expect(csv).toContain('Total OJ Projects invoices,1')
    expect(csv).toContain('\t=INV-001')
    expect(csv).toContain('\t@Client')
    expect(csv).toContain('2026-02-15: 123.45')
    expect(csv).not.toContain('2026-04-01: 50.00')
  })
})

function invoiceRow(overrides: Record<string, any> = {}) {
  return {
    id: 'invoice-id',
    invoice_number: 'INV-001',
    vendor_id: 'vendor-1',
    invoice_date: '2026-01-01',
    due_date: '2026-01-31',
    reference: 'OJ Projects 2026-01',
    status: 'paid',
    invoice_discount_percentage: 0,
    subtotal_amount: 100,
    discount_amount: 0,
    vat_amount: 20,
    total_amount: 120,
    paid_amount: 120,
    notes: null,
    internal_notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    vendor: {
      id: 'vendor-1',
      name: 'Client',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    line_items: [],
    payments: [],
    ...overrides,
  }
}

function createQuery(
  table: string,
  calls: Array<{ table: string; method: string; args: unknown[] }>,
  invoiceRows: Array<Record<string, any>>
) {
  const queryCalls: Array<{ method: string; args: unknown[] }> = []
  const query: Record<string, any> = {
    select: (...args: unknown[]) => record('select', args),
    gte: (...args: unknown[]) => record('gte', args),
    lte: (...args: unknown[]) => record('lte', args),
    lt: (...args: unknown[]) => record('lt', args),
    not: (...args: unknown[]) => record('not', args),
    in: (...args: unknown[]) => record('in', args),
    is: (...args: unknown[]) => record('is', args),
    order: (...args: unknown[]) => record('order', args),
    then: (resolve: (value: unknown) => void) => resolve(resolveQuery(table, queryCalls, invoiceRows)),
  }

  function record(method: string, args: unknown[]) {
    queryCalls.push({ method, args })
    calls.push({ table, method, args })
    return query
  }

  return query
}

function resolveQuery(
  table: string,
  queryCalls: Array<{ method: string; args: unknown[] }>,
  invoiceRows: Array<Record<string, any>>
) {
  if (table === 'invoice_payments') {
    return {
      data: [
        { invoice_id: 'payment-linked-invoice' },
        { invoice_id: 'ordinary-invoice' },
        { invoice_id: 'payment-linked-invoice' },
      ],
      error: null,
    }
  }

  if (table === 'oj_entries') {
    const isPaidAtQuery = queryCalls.some((call) => call.method === 'gte' && call.args[0] === 'paid_at')
    return {
      data: isPaidAtQuery
        ? [{ invoice_id: 'entry-paid-at-invoice' }]
        : [{ invoice_id: 'payment-linked-invoice' }],
      error: null,
    }
  }

  if (table === 'oj_recurring_charge_instances') {
    const isPaidAtQuery = queryCalls.some((call) => call.method === 'gte' && call.args[0] === 'paid_at')
    return {
      data: isPaidAtQuery
        ? [{ invoice_id: 'recurring-paid-at-invoice' }]
        : [],
      error: null,
    }
  }

  if (table === 'invoices') {
    return { data: invoiceRows, error: null }
  }

  return { data: [], error: null }
}
