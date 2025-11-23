import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CashingUpService } from '@/services/cashing-up.service';
import { SupabaseClient } from '@supabase/supabase-js';

// Mock Supabase Client
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const mockSupabase = {
  from: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  })),
} as unknown as SupabaseClient;

// Chain mocks
mockSelect.mockReturnValue({ eq: mockEq });
mockInsert.mockReturnValue({ select: vi.fn(() => ({ single: mockSingle })) });
mockUpdate.mockReturnValue({ eq: mockEq });
mockDelete.mockReturnValue({ eq: mockEq });
mockEq.mockReturnValue({ 
  single: mockSingle, 
  maybeSingle: mockMaybeSingle,
  eq: mockEq,
  is: mockEq 
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
        is: mockEq // Handle chained .eq().is()
    });
    mockInsert.mockReturnValue({ select: vi.fn(() => ({ single: mockSingle })) });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockDelete.mockReturnValue({ eq: mockEq });
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
});
