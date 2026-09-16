import { describe, it, expect, vi } from 'vitest';
import { CashingUpService } from '@/services/cashing-up.service';
import { SupabaseClient } from '@supabase/supabase-js';

// Supabase caps every request at 1,000 rows and reports no error when it truncates.
// In the live 12-month window the cash-up insights page matches 1,044 payment
// breakdown rows and 1,035 sales breakdown rows, so an unpaged read quietly drops
// the remainder from the Payment Mix and Sales Mix cards.
const PAYMENT_ROW_COUNT = 1044;
const SALES_ROW_COUNT = 1035;
// A fixed date inside the 2026 calendar-year window these tests ask for, so nothing
// depends on the host clock or the host time zone.
const SESSION_DATE = '2026-03-04';
const SALES_CATEGORIES = ['drinks_sales', 'food_sales', 'other_sales'] as const;

type QueryResponse = { data: unknown[] | null; error: { message: string } | null };
type RangeCall = [number, number];
type PaymentRow = {
  payment_type_label: string;
  counted_amount: number;
  cashup_sessions: { site_id: string; session_date: string };
};
type SalesRow = {
  sales_category: (typeof SALES_CATEGORIES)[number];
  amount: number;
  cashup_sessions: { site_id: string; session_date: string };
};

// The reads that stay unpaged end at their last filter, exactly as they do today.
function createStaticQuery(response: QueryResponse, terminalMethod: 'lte' | 'order') {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => (terminalMethod === 'lte' ? response : chain));
  chain.order = vi.fn(() => (terminalMethod === 'order' ? response : chain));
  return chain;
}

// A paged read ends at .range(), which serves the requested slice and records the
// window it was asked for.
function createPagedQuery(
  rows: unknown[],
  rangeCalls: RangeCall[],
  pageError?: { message: string }
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.gte = vi.fn(() => chain);
  chain.lte = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to]);
    if (pageError) return Promise.resolve({ data: null, error: pageError });
    return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
  });
  return chain;
}

function buildPaymentRows(): PaymentRow[] {
  return Array.from({ length: PAYMENT_ROW_COUNT }, (_, index) => ({
    payment_type_label: index % 2 === 0 ? 'Card' : 'Cash',
    counted_amount: 1 + (index % 4),
    cashup_sessions: { site_id: 'site-1', session_date: SESSION_DATE },
  }));
}

function buildSalesRows(): SalesRow[] {
  return Array.from({ length: SALES_ROW_COUNT }, (_, index) => ({
    sales_category: SALES_CATEGORIES[index % SALES_CATEGORIES.length],
    amount: 1 + (index % 5),
    cashup_sessions: { site_id: 'site-1', session_date: SESSION_DATE },
  }));
}

function buildInsightsClient(options: {
  paymentRows: PaymentRow[];
  salesRows: SalesRow[];
  paymentRangeCalls: RangeCall[];
  salesRangeCalls: RangeCall[];
  paymentPageError?: { message: string };
}) {
  const queries = {
    cashup_sessions: createStaticQuery(
      {
        data: [{ session_date: SESSION_DATE, total_counted_amount: 1000, total_variance_amount: 0 }],
        error: null,
      },
      'lte'
    ),
    cashup_targets: createStaticQuery({ data: [], error: null }, 'order'),
    cashup_payment_breakdowns: createPagedQuery(
      options.paymentRows,
      options.paymentRangeCalls,
      options.paymentPageError
    ),
    cashup_sales_breakdowns: createPagedQuery(options.salesRows, options.salesRangeCalls),
    pnl_sales_imports: createStaticQuery({ data: [], error: null }, 'lte'),
  };

  return {
    from: vi.fn((table: keyof typeof queries) => queries[table]),
  } as unknown as SupabaseClient;
}

describe('CashingUpService.getInsightsData paging', () => {
  it('builds the payment mix from every breakdown row past the 1,000-row cap', async () => {
    const paymentRows = buildPaymentRows();
    const paymentRangeCalls: RangeCall[] = [];
    const salesRangeCalls: RangeCall[] = [];
    const supabase = buildInsightsClient({
      paymentRows,
      salesRows: buildSalesRows(),
      paymentRangeCalls,
      salesRangeCalls,
    });

    const data = await CashingUpService.getInsightsData(supabase, 'site-1', 2026);

    const expectedTotal = paymentRows.reduce((sum, row) => sum + row.counted_amount, 0);
    const expectedCard = paymentRows
      .filter((row) => row.payment_type_label === 'Card')
      .reduce((sum, row) => sum + row.counted_amount, 0);
    const expectedCash = expectedTotal - expectedCard;

    expect(paymentRangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(data.paymentMix.reduce((sum, entry) => sum + entry.value, 0)).toBe(expectedTotal);
    expect(data.paymentMix.find((entry) => entry.label === 'Card')?.value).toBe(expectedCard);
    expect(data.paymentMix.find((entry) => entry.label === 'Cash')?.value).toBe(expectedCash);
  });

  it('builds the sales mix from every breakdown row past the 1,000-row cap', async () => {
    const salesRows = buildSalesRows();
    const paymentRangeCalls: RangeCall[] = [];
    const salesRangeCalls: RangeCall[] = [];
    const supabase = buildInsightsClient({
      paymentRows: buildPaymentRows(),
      salesRows,
      paymentRangeCalls,
      salesRangeCalls,
    });

    const data = await CashingUpService.getInsightsData(supabase, 'site-1', 2026);

    const sumFor = (category: (typeof SALES_CATEGORIES)[number]) =>
      salesRows
        .filter((row) => row.sales_category === category)
        .reduce((sum, row) => sum + row.amount, 0);
    const expectedTotal = salesRows.reduce((sum, row) => sum + row.amount, 0);

    expect(salesRangeCalls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(data.salesMix.reduce((sum, entry) => sum + entry.value, 0)).toBe(expectedTotal);
    expect(data.salesMix.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Drinks', value: sumFor('drinks_sales') },
      { label: 'Food', value: sumFor('food_sales') },
      { label: 'Other', value: sumFor('other_sales') },
    ]);
    // March is the third bucket of the 2026 calendar year.
    expect(data.salesMixMonthly[2]).toEqual(
      expect.objectContaining({
        monthLabel: 'Mar',
        drinksSales: sumFor('drinks_sales'),
        foodSales: sumFor('food_sales'),
        otherSales: sumFor('other_sales'),
        totalSales: expectedTotal,
      })
    );
  });

  it('propagates a failed page instead of returning a partial mix', async () => {
    const supabase = buildInsightsClient({
      paymentRows: buildPaymentRows(),
      salesRows: buildSalesRows(),
      paymentRangeCalls: [],
      salesRangeCalls: [],
      paymentPageError: { message: 'statement timeout' },
    });

    await expect(CashingUpService.getInsightsData(supabase, 'site-1', 2026)).rejects.toThrow(
      'statement timeout'
    );
  });
});
