import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CashingUpService } from '@/services/cashing-up.service';
import { normalizeCashCountInput, normalizeCashCountInputs } from '@/lib/cashing-up/cash-counts';
import { SupabaseClient } from '@supabase/supabase-js';

// Mock Supabase Client
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSelectFromEq = vi.fn();

const mockSupabase = {
  from: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  })),
} as unknown as SupabaseClient;

function isCashCountInsertPayload(payload: unknown): payload is Array<Record<string, unknown>> {
  return Array.isArray(payload) && payload.some(row => (
    typeof row === 'object' &&
    row !== null &&
    'denomination' in row &&
    'total_amount' in row
  ));
}

function isSalesBreakdownInsertPayload(payload: unknown): payload is Array<Record<string, unknown>> {
  return Array.isArray(payload) && payload.some(row => (
    typeof row === 'object' &&
    row !== null &&
    'sales_category' in row &&
    'amount' in row
  ));
}

// Chain mocks
mockSelect.mockReturnValue({ eq: mockEq });
mockInsert.mockReturnValue({ select: vi.fn(() => ({ single: mockSingle })) });
mockUpdate.mockReturnValue({ eq: mockEq });
mockDelete.mockReturnValue({ eq: mockEq });
mockSelectFromEq.mockReturnValue({ single: mockSingle, maybeSingle: mockMaybeSingle });
mockEq.mockReturnValue({ 
  single: mockSingle, 
  maybeSingle: mockMaybeSingle,
  eq: mockEq,
  is: mockEq,
  select: mockSelectFromEq
});

describe('CashingUpService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default chain setup
    mockSupabase.from = vi.fn().mockReturnValue({
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
        delete: mockDelete,
    });
    
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ 
        single: mockSingle, 
        maybeSingle: mockMaybeSingle,
        eq: mockEq,
        is: mockEq, // Handle chained .eq().is()
        select: mockSelectFromEq
    });
    mockInsert.mockReturnValue({ select: vi.fn(() => ({ single: mockSingle })) });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockDelete.mockReturnValue({ eq: mockEq });
    mockSelectFromEq.mockReturnValue({ single: mockSingle, maybeSingle: mockMaybeSingle });
  });

  it('should calculate totals correctly on upsert', async () => {
    const userId = 'user-123';
    const dto = {
      siteId: 'site-1',
      sessionDate: '2025-01-01',
      status: 'draft' as const,
      notes: 'Test',
      paymentBreakdowns: [
        { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 100, countedAmount: 90 }, // -10
        { paymentTypeCode: 'CARD', paymentTypeLabel: 'Card', expectedAmount: 200, countedAmount: 200 }, // 0
      ],
      cashCounts: [],
    };

    // Mock no existing session
    mockMaybeSingle.mockResolvedValue({ data: null });
    
    // Mock successful insert
    mockSingle.mockResolvedValue({ data: { id: 'new-session-id' } });
    
    // Mock getSession return
    const mockSession = {
        id: 'new-session-id',
        total_expected_amount: 300,
        total_counted_amount: 290,
        total_variance_amount: -10
    };
    // We need to handle the getSession call at the end of upsert
    // It calls select().eq().single()
    // We can mock the implementation of mockSingle to return different things based on context if needed,
    // or just rely on the fact that we want to verify the INSERT call arguments.
    
    mockSingle.mockResolvedValueOnce({ data: { id: 'new-session-id' } }) // for insert
              .mockResolvedValueOnce({ data: mockSession }); // for getSession

    await CashingUpService.upsertSession(mockSupabase, dto, userId);

    // Verify insert was called with correct calculations
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      total_expected_amount: 300,
      total_counted_amount: 290,
      total_variance_amount: -10,
      status: 'draft'
    }));
  });

  it('should persist denomination total values as exact derived counts', async () => {
    const userId = 'user-123';
    const dto = {
      siteId: 'site-1',
      sessionDate: '2025-01-01',
      status: 'draft' as const,
      notes: 'Screenshot case',
      paymentBreakdowns: [
        { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 0, countedAmount: 51.8 },
      ],
      cashCounts: [
        { denomination: 20, totalAmount: 40 },
        { denomination: 10, totalAmount: 10 },
        { denomination: 1, totalAmount: 1 },
        { denomination: 0.2, totalAmount: 0.2 },
        { denomination: 0.1, totalAmount: 0.1 },
        { denomination: 0.05, totalAmount: 0.5 },
      ],
    };

    mockMaybeSingle.mockResolvedValue({ data: null });
    mockSingle
      .mockResolvedValueOnce({ data: { id: 'new-session-id' } })
      .mockResolvedValueOnce({ data: { id: 'new-session-id' } });

    await CashingUpService.upsertSession(mockSupabase, dto, userId);

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      total_counted_amount: 51.8,
      total_variance_amount: 51.8,
    }));

    const cashCountInsertCall = mockInsert.mock.calls.find(([payload]) => isCashCountInsertPayload(payload));
    expect(cashCountInsertCall?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ denomination: 20, quantity: 2, total_amount: 40 }),
      expect.objectContaining({ denomination: 10, quantity: 1, total_amount: 10 }),
      expect.objectContaining({ denomination: 1, quantity: 1, total_amount: 1 }),
      expect.objectContaining({ denomination: 0.2, quantity: 1, total_amount: 0.2 }),
      expect.objectContaining({ denomination: 0.1, quantity: 1, total_amount: 0.1 }),
      expect.objectContaining({ denomination: 0.05, quantity: 10, total_amount: 0.5 }),
    ]));
  });

  it('should persist drinks, food, and other sales split rows', async () => {
    const userId = 'user-123';
    const dto = {
      siteId: 'site-1',
      sessionDate: '2025-01-01',
      status: 'draft' as const,
      notes: 'Sales split',
      paymentBreakdowns: [
        { paymentTypeCode: 'CASH', paymentTypeLabel: 'Cash', expectedAmount: 0, countedAmount: 100 },
      ],
      cashCounts: [],
      salesBreakdowns: [
        { salesCategory: 'drinks_sales' as const, amount: 70 },
        { salesCategory: 'food_sales' as const, amount: 20 },
        { salesCategory: 'other_sales' as const, amount: 10 },
      ],
    };

    mockMaybeSingle.mockResolvedValue({ data: null });
    mockSingle
      .mockResolvedValueOnce({ data: { id: 'new-session-id' } })
      .mockResolvedValueOnce({ data: { id: 'new-session-id' } });

    await CashingUpService.upsertSession(mockSupabase, dto, userId);

    const salesInsertCall = mockInsert.mock.calls.find(([payload]) => isSalesBreakdownInsertPayload(payload));
    expect(salesInsertCall?.[0]).toEqual([
      expect.objectContaining({ cashup_session_id: 'new-session-id', sales_category: 'drinks_sales', amount: 70 }),
      expect.objectContaining({ cashup_session_id: 'new-session-id', sales_category: 'food_sales', amount: 20 }),
      expect.objectContaining({ cashup_session_id: 'new-session-id', sales_category: 'other_sales', amount: 10 }),
    ]);
  });

  it('should throw error if session already exists for site/date', async () => {
    const userId = 'user-123';
    const dto = {
      siteId: 'site-1',
      sessionDate: '2025-01-01',
      paymentBreakdowns: [],
      cashCounts: []
    };

    // Mock existing session
    mockMaybeSingle.mockResolvedValue({ data: { id: 'existing-id' } });

    await expect(CashingUpService.upsertSession(mockSupabase, dto, userId))
      .rejects.toThrow('already exists');
  });

  it('should move draft sessions to submitted on submitSession', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        total_counted_amount: 0,
        cashup_sales_breakdowns: [],
      },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'session-1' }, error: null });
    mockSingle.mockResolvedValueOnce({ data: { id: 'session-1', status: 'submitted' }, error: null });

    await CashingUpService.submitSession(mockSupabase, 'session-1', 'user-1');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      approved_by_user_id: null
    }));
  });

  it('should reject submitSession when session is not draft', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        total_counted_amount: 0,
        cashup_sales_breakdowns: [],
      },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      CashingUpService.submitSession(mockSupabase, 'session-1', 'user-1')
    ).rejects.toThrow('not in draft status');
  });

  it('should reject submitSession when the saved sales split does not match total sales', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        total_counted_amount: 100,
        cashup_sales_breakdowns: [
          { sales_category: 'drinks_sales', amount: 80 },
          { sales_category: 'food_sales', amount: 10 },
          { sales_category: 'other_sales', amount: 0 },
        ],
      },
      error: null,
    });

    await expect(
      CashingUpService.submitSession(mockSupabase, 'session-1', 'user-1')
    ).rejects.toThrow('Sales split must match the total sales');
  });

  it('should reject approveSession when session is not submitted', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        total_counted_amount: 0,
        cashup_sales_breakdowns: [],
      },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      CashingUpService.approveSession(mockSupabase, 'session-1', 'user-1')
    ).rejects.toThrow('not in submitted status');
  });

  it('should reject upsertSession update when target session no longer exists', async () => {
    const userId = 'user-123';
    const dto = {
      siteId: 'site-1',
      sessionDate: '2025-01-01',
      paymentBreakdowns: [],
      cashCounts: []
    };

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      CashingUpService.upsertSession(mockSupabase, dto, userId, 'session-1')
    ).rejects.toThrow('Session not found');
  });

  it('should reject lockSession when session is missing', async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'session-1',
        total_counted_amount: 0,
        cashup_sales_breakdowns: [],
      },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      CashingUpService.lockSession(mockSupabase, 'session-1', 'user-1')
    ).rejects.toThrow('Session not found');
  });

  it('should reject unlockSession when session is not locked', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      CashingUpService.unlockSession(mockSupabase, 'session-1', 'user-1')
    ).rejects.toThrow('Session not found or not locked');
  });
});

describe('CashingUpService.getInsightsData', () => {
  function createInsightsQuery(response: { data: unknown[]; error: null }, terminalMethod: 'lte' | 'order') {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.gte = vi.fn(() => chain);
    chain.lte = vi.fn(() => (terminalMethod === 'lte' ? response : chain));
    chain.order = vi.fn(() => (terminalMethod === 'order' ? response : chain));
    return chain;
  }

  it('aggregates drinks, food, and other sales mix for the selected period', async () => {
    const queries = {
      cashup_sessions: createInsightsQuery({
        data: [
          { session_date: '2026-01-02', total_counted_amount: 300, total_variance_amount: 0 },
        ],
        error: null,
      }, 'lte'),
      cashup_targets: createInsightsQuery({ data: [], error: null }, 'order'),
      cashup_payment_breakdowns: createInsightsQuery({
        data: [{ payment_type_label: 'Card', counted_amount: 300 }],
        error: null,
      }, 'lte'),
      cashup_sales_breakdowns: createInsightsQuery({
        data: [
          { sales_category: 'drinks_sales', amount: 150, cashup_sessions: { session_date: '2026-01-02' } },
          { sales_category: 'food_sales', amount: 100, cashup_sessions: { session_date: '2026-01-02' } },
          { sales_category: 'other_sales', amount: 50, cashup_sessions: { session_date: '2026-01-02' } },
        ],
        error: null,
      }, 'lte'),
      pnl_sales_imports: createInsightsQuery({ data: [], error: null }, 'lte'),
    };
    const supabase = {
      from: vi.fn((table: keyof typeof queries) => queries[table]),
    } as unknown as SupabaseClient;

    const data = await CashingUpService.getInsightsData(supabase, 'site-1', 2026);

    expect((supabase.from as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('cashup_sales_breakdowns');
    expect(data.salesMix.map(({ label, value, color }) => ({ label, value, color }))).toEqual([
      { label: 'Drinks', value: 150, color: '#2563EB' },
      { label: 'Food', value: 100, color: '#16A34A' },
      { label: 'Other', value: 50, color: '#F59E0B' },
    ]);
    expect(data.salesMix[0].percentage).toBeCloseTo(50);
    expect(data.salesMix[1].percentage).toBeCloseTo(33.333);
    expect(data.salesMix[2].percentage).toBeCloseTo(16.667);
    expect(data.salesMixMonthly[0]).toEqual(expect.objectContaining({
      monthLabel: 'Jan',
      drinksSales: 150,
      foodSales: 100,
      otherSales: 50,
      totalSales: 300,
    }));
  });

  it('prefers imported till sales mix over empty or missing cash-up split history', async () => {
    const queries = {
      cashup_sessions: createInsightsQuery({
        data: [
          { session_date: '2026-01-02', total_counted_amount: 300, total_variance_amount: 0 },
        ],
        error: null,
      }, 'lte'),
      cashup_targets: createInsightsQuery({ data: [], error: null }, 'order'),
      cashup_payment_breakdowns: createInsightsQuery({
        data: [{ payment_type_label: 'Card', counted_amount: 300 }],
        error: null,
      }, 'lte'),
      cashup_sales_breakdowns: createInsightsQuery({
        data: [
          { sales_category: 'drinks_sales', amount: 999 },
          { sales_category: 'food_sales', amount: 999 },
          { sales_category: 'other_sales', amount: 999 },
        ],
        error: null,
      }, 'lte'),
      pnl_sales_imports: createInsightsQuery({
        data: [
          { sale_date: '2026-01-02', drinks_sales: 80, food_sales: 20, other_sales: 10 },
        ],
        error: null,
      }, 'lte'),
    };
    const supabase = {
      from: vi.fn((table: keyof typeof queries) => queries[table]),
    } as unknown as SupabaseClient;

    const data = await CashingUpService.getInsightsData(supabase, 'site-1', 2026);

    expect(data.salesMix.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'Drinks', value: 80 },
      { label: 'Food', value: 20 },
      { label: 'Other', value: 10 },
    ]);
    expect(data.salesMixMonthly[0]).toEqual(expect.objectContaining({
      monthLabel: 'Jan',
      drinksSales: 80,
      foodSales: 20,
      otherSales: 10,
    }));
    expect(data.salesMixMonthly[0].drinksPercentage).toBeCloseTo(72.727);
    expect(data.salesMix[0].percentage).toBeCloseTo(72.727);
  });
});

describe('cash count normalization', () => {
  it('normalizes total-value inputs using pence-safe arithmetic', () => {
    expect(normalizeCashCountInputs([
      { denomination: 20, totalAmount: 40 },
      { denomination: 0.2, totalAmount: 0.2 },
      { denomination: 0.05, totalAmount: 0.5 },
    ])).toEqual([
      { denomination: 20, quantity: 2, totalAmount: 40 },
      { denomination: 0.2, quantity: 1, totalAmount: 0.2 },
      { denomination: 0.05, quantity: 10, totalAmount: 0.5 },
    ]);
  });

  it('rejects totals that are not exact multiples of the denomination', () => {
    expect(() => normalizeCashCountInput({ denomination: 0.2, totalAmount: 0.3 }))
      .toThrow('must be a multiple of £0.20');
  });

  it('rejects negative totals', () => {
    expect(() => normalizeCashCountInput({ denomination: 10, totalAmount: -10 }))
      .toThrow('cannot be negative');
  });
});
