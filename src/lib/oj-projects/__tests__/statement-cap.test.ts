import { describe, expect, it } from 'vitest'
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations'
import {
  applyStatementCapTopUp,
  computeStatementCapTargetIncVat,
} from '@/lib/oj-projects/statement-cap'

/**
 * Records the filters each query applied, so a test can assert on the window a
 * query was bounded by rather than just on the number it produced.
 */
function createMockSupabase(tables: Record<string, { data?: unknown; error?: unknown }>) {
  const filters: Record<string, Array<[string, unknown]>> = {}

  return {
    filters,
    from(table: string) {
      filters[table] = filters[table] || []
      const response = tables[table] || { data: [], error: null }

      const proxy: any = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (resolve: (value: unknown) => void) =>
                resolve({ data: response.data ?? [], error: response.error ?? null })
            }
            return (...args: unknown[]) => {
              filters[table].push([String(prop), args[0]])
              return proxy
            }
          },
        }
      )
      return proxy
    },
  }
}

const CAPPED_SETTINGS = {
  billing_mode: 'cap',
  statement_mode: true,
  monthly_cap_inc_vat: 500,
  vat_rate: 20,
  hourly_rate_ex_vat: 62.5,
  mileage_rate: 0.55,
}

describe('applyStatementCapTopUp', () => {
  it('tops a rebuilt invoice back up to the cap', () => {
    // The live regression: Golden Barrels' June invoice was rebuilt from its
    // remaining items and fell from GBP 500.00 to GBP 460.50.
    const lineItems = [
      {
        catalog_item_id: null,
        description: 'Account balance payment (20% VAT)',
        quantity: 1,
        unit_price: 383.75,
        discount_percentage: 0,
        vat_rate: 20,
      },
    ]
    const totals = calculateInvoiceTotals(lineItems, 0)
    expect(totals.totalAmount).toBe(460.5)

    const adjusted = applyStatementCapTopUp({ lineItems, totals, targetIncVat: 500, vatRate: 20 })

    expect(adjusted.totals.totalAmount).toBe(500)
    expect(adjusted.lineItems).toHaveLength(1)
  })

  it('leaves an invoice alone when it already meets the target', () => {
    const lineItems = [
      {
        catalog_item_id: null,
        description: 'Account balance payment (20% VAT)',
        quantity: 1,
        unit_price: 500,
        discount_percentage: 0,
        vat_rate: 20,
      },
    ]
    const totals = calculateInvoiceTotals(lineItems, 0)

    const adjusted = applyStatementCapTopUp({ lineItems, totals, targetIncVat: 500, vatRate: 20 })

    // Only ever tops up, so it can never reduce what has been billed.
    expect(adjusted.totals.totalAmount).toBe(totals.totalAmount)
  })
})

describe('computeStatementCapTargetIncVat', () => {
  const baseInput = {
    vendorId: 'vendor-1',
    invoiceId: 'inv-june',
    invoiceDate: '2026-07-01',
    reference: 'OJ Projects 2026-06',
    linkedEntries: [] as any[],
    linkedRecurringInstances: [] as any[],
  }

  it('returns the cap when the client owes more than the cap', async () => {
    const client = createMockSupabase({
      // A single 16 hour entry inside the period, far more than the cap.
      oj_entries: { data: [{ entry_type: 'time', duration_minutes_rounded: 960, hourly_rate_ex_vat_snapshot: 62.5, vat_rate_snapshot: 20 }] },
      oj_recurring_charge_instances: { data: [] },
      invoices: { data: [] },
    })

    const target = await computeStatementCapTargetIncVat({
      ...baseInput,
      client: client as any,
      settings: CAPPED_SETTINGS,
    })

    expect(target).toBe(500)
  })

  it('bills only what is owed when the debt is smaller than the cap', async () => {
    const client = createMockSupabase({
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      invoices: { data: [] },
    })

    const target = await computeStatementCapTargetIncVat({
      ...baseInput,
      client: client as any,
      settings: CAPPED_SETTINGS,
      // One hour at GBP 62.50 plus VAT is GBP 75.00, well under the cap.
      linkedEntries: [
        { entry_type: 'time', duration_minutes_rounded: 60, hourly_rate_ex_vat_snapshot: 62.5, vat_rate_snapshot: 20 },
      ],
    })

    expect(target).toBe(75)
  })

  it('measures the balance as at the invoice date, so a later invoice cannot inflate it', async () => {
    const client = createMockSupabase({
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      invoices: { data: [] },
    })

    await computeStatementCapTargetIncVat({
      ...baseInput,
      client: client as any,
      settings: CAPPED_SETTINGS,
    })

    const invoiceFilters = client.filters.invoices || []
    // Rebuilding June must not see the August invoice: topping this one up
    // against a debt August is already collecting bills the same money twice.
    expect(invoiceFilters).toContainEqual(['lte', 'invoice_date'])
    expect(invoiceFilters).toContainEqual(['neq', 'id'])

    // Work is likewise bounded by the end of the period being rebuilt, so July
    // entries never land on a June invoice.
    const entryFilters = client.filters.oj_entries || []
    expect(entryFilters).toContainEqual(['lte', 'entry_date'])
  })

  it('counts an unpaid earlier invoice toward the debt', async () => {
    const client = createMockSupabase({
      oj_entries: { data: [] },
      oj_recurring_charge_instances: { data: [] },
      invoices: { data: [{ id: 'inv-older', total_amount: 300, paid_amount: 100 }] },
    })

    const target = await computeStatementCapTargetIncVat({
      ...baseInput,
      client: client as any,
      settings: CAPPED_SETTINGS,
    })

    // GBP 200 still outstanding on the earlier invoice, nothing else owed.
    expect(target).toBe(200)
  })

  it('returns null for a client with no cap, leaving the invoice as the sum of its items', async () => {
    const client = createMockSupabase({})

    const target = await computeStatementCapTargetIncVat({
      ...baseInput,
      client: client as any,
      settings: { billing_mode: 'full', statement_mode: false, vat_rate: 20 },
    })

    expect(target).toBeNull()
  })

  it('returns null for a statement client whose cap is not set', async () => {
    const client = createMockSupabase({})

    const target = await computeStatementCapTargetIncVat({
      ...baseInput,
      client: client as any,
      settings: { billing_mode: 'cap', statement_mode: true, monthly_cap_inc_vat: null, vat_rate: 20 },
    })

    expect(target).toBeNull()
  })
})
