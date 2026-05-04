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
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'session-1' }, error: null });
    mockSingle.mockResolvedValueOnce({ data: { id: 'session-1', status: 'submitted' }, error: null });

    await CashingUpService.submitSession(mockSupabase, 'session-1', 'user-1');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      approved_by_user_id: null
    }));
  });

  it('should reject submitSession when session is not draft', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      CashingUpService.submitSession(mockSupabase, 'session-1', 'user-1')
    ).rejects.toThrow('not in draft status');
  });

  it('should reject approveSession when session is not submitted', async () => {
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
