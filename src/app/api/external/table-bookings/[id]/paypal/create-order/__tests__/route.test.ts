import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Module mocks ---

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    (
      handler: (req: Request, apiKey: unknown) => Promise<Response>,
      _permissions: string[],
      request: Request,
    ) => handler(request, { id: 'test-key-id', name: 'Test Key', permissions: ['read:events'], rate_limit: 100, is_active: true }),
  ),
}));

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateEq = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
    })),
  })),
}));

const mockCreateSimplePayPalOrder = vi.fn();

vi.mock('@/lib/paypal', () => ({
  createSimplePayPalOrder: mockCreateSimplePayPalOrder,
}));

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Helper to build a fake booking row
function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-uuid-1',
    party_size: 4,
    status: 'pending_payment',
    payment_status: 'pending',
    paypal_deposit_order_id: null,
    deposit_amount: 40,
    ...overrides,
  };
}

// Helper to mock a successful Supabase select chain
function mockBookingFetch(booking: ReturnType<typeof makeBooking> | null, dbError: unknown = null) {
  mockSingle.mockResolvedValueOnce({ data: booking, error: dbError });
  mockEq.mockReturnValue({ single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq });
}

// Helper to mock a successful Supabase update chain
function mockUpdateSuccess() {
  mockUpdateEq.mockResolvedValueOnce({ error: null });
  mockUpdate.mockReturnValue({ eq: mockUpdateEq });
}

// Import AFTER mocks are declared (dynamic to avoid hoisting issues)
async function callRoute(id: string) {
  const { POST } = await import('../route');
  const req = new NextRequest(`http://localhost/api/external/table-bookings/${id}/paypal/create-order`, {
    method: 'POST',
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

describe('POST /api/external/table-bookings/[id]/paypal/create-order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates a PayPal order for a valid booking requiring a deposit', async () => {
    const booking = makeBooking();
    mockBookingFetch(booking);
    mockUpdateSuccess();
    mockCreateSimplePayPalOrder.mockResolvedValueOnce({
      orderId: 'PAYPAL-ORDER-123',
      approveUrl: 'https://paypal.com/approve/123',
    });

    const res = await callRoute('booking-uuid-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.orderId).toBe('PAYPAL-ORDER-123');
    expect(mockCreateSimplePayPalOrder).toHaveBeenCalledOnce();
    expect(mockCreateSimplePayPalOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'tb-deposit-booking-uuid-1',
        amount: 40,
      }),
    );
  });

  it('returns existing orderId without calling PayPal if paypal_deposit_order_id already set (idempotent)', async () => {
    const booking = makeBooking({ paypal_deposit_order_id: 'PAYPAL-EXISTING-456' });
    mockBookingFetch(booking);

    const res = await callRoute('booking-uuid-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.orderId).toBe('PAYPAL-EXISTING-456');
    expect(mockCreateSimplePayPalOrder).not.toHaveBeenCalled();
  });

  it('returns 409 if booking payment is already completed (paid)', async () => {
    const booking = makeBooking({ status: 'confirmed', payment_status: 'completed' });
    mockBookingFetch(booking);

    const res = await callRoute('booking-uuid-1');
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBeDefined();
    expect(mockCreateSimplePayPalOrder).not.toHaveBeenCalled();
  });

  it('returns 400 if booking does not require a deposit (not pending_payment)', async () => {
    const booking = makeBooking({ status: 'confirmed', payment_status: null });
    mockBookingFetch(booking);

    const res = await callRoute('booking-uuid-1');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(mockCreateSimplePayPalOrder).not.toHaveBeenCalled();
  });

  it('returns 404 if booking not found', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq });

    const res = await callRoute('non-existent-id');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it('returns 502 if PayPal API throws', async () => {
    const booking = makeBooking();
    mockBookingFetch(booking);
    mockCreateSimplePayPalOrder.mockRejectedValueOnce(new Error('PayPal network error'));

    const res = await callRoute('booking-uuid-1');
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBeDefined();
  });
});
