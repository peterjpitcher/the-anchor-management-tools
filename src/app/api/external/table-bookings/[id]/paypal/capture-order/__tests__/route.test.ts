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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      update: mockUpdate,
    })),
  })),
}));

const mockCapturePayPalPayment = vi.fn();
const mockGetPayPalOrder = vi.fn();

vi.mock('@/lib/paypal', () => ({
  capturePayPalPayment: mockCapturePayPalPayment,
  getPayPalOrder: mockGetPayPalOrder,
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
    hold_expires_at: '2099-01-01T12:00:00Z',
    paypal_deposit_order_id: 'ORDER-123',
    paypal_deposit_capture_id: null,
    deposit_amount: 40,
    deposit_amount_locked: null,
    deposit_waived: false,
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
function mockUpdateSuccess(result: { data: unknown; error: unknown } = { data: { id: 'booking-uuid-1' }, error: null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ maybeSingle }));
  const chain = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    select,
  };
  mockUpdate.mockReturnValue(chain);
}

function makePayPalOrder(amount: string) {
  return { purchase_units: [{ amount: { value: amount, currency_code: 'GBP' } }] };
}

// Import AFTER mocks are declared (dynamic to avoid hoisting issues)
async function callRoute(id: string, body: object) {
  const { POST } = await import('../route');
  const req = new NextRequest(`http://localhost/api/external/table-bookings/${id}/paypal/capture-order`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

describe('POST /api/external/table-bookings/[id]/paypal/capture-order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('captures payment and returns success', async () => {
    const booking = makeBooking({ paypal_deposit_order_id: 'ORDER-123' });
    mockBookingFetch(booking);
    mockUpdateSuccess();
    mockGetPayPalOrder.mockResolvedValueOnce(makePayPalOrder('40.00'));
    mockCapturePayPalPayment.mockResolvedValueOnce({
      transactionId: 'CAPTURE-ABC',
      status: 'COMPLETED',
      payerId: 'PAYER-1',
      amount: '40.00',
    });

    const res = await callRoute('booking-uuid-1', { orderId: 'ORDER-123' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockCapturePayPalPayment).toHaveBeenCalledOnce();
    expect(mockCapturePayPalPayment).toHaveBeenCalledWith('ORDER-123');
  });

  it('returns 404 if booking not found', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });
    mockEq.mockReturnValue({ single: mockSingle });
    mockSelect.mockReturnValue({ eq: mockEq });

    const res = await callRoute('non-existent-id', { orderId: 'ORDER-123' });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
    expect(mockCapturePayPalPayment).not.toHaveBeenCalled();
  });

  it('returns 400 if orderId does not match stored order', async () => {
    const booking = makeBooking({ paypal_deposit_order_id: 'ORDER-123' });
    mockBookingFetch(booking);

    const res = await callRoute('booking-uuid-1', { orderId: 'WRONG-ORDER' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(mockCapturePayPalPayment).not.toHaveBeenCalled();
  });

  it('is idempotent — returns success if already captured', async () => {
    const booking = makeBooking({
      payment_status: 'completed',
      paypal_deposit_capture_id: 'CAPTURE-EXISTING',
    });
    mockBookingFetch(booking);

    const res = await callRoute('booking-uuid-1', { orderId: 'ORDER-123' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockCapturePayPalPayment).not.toHaveBeenCalled();
  });

  it('returns 502 on PayPal capture failure', async () => {
    const booking = makeBooking({ paypal_deposit_order_id: 'ORDER-123' });
    mockBookingFetch(booking);
    mockGetPayPalOrder.mockResolvedValueOnce(makePayPalOrder('40.00'));
    mockCapturePayPalPayment.mockRejectedValueOnce(new Error('PayPal capture failed'));

    const res = await callRoute('booking-uuid-1', { orderId: 'ORDER-123' });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBeDefined();
  });

  it('returns 502 and logs reconciliation event if PayPal succeeds but DB update fails', async () => {
    const booking = makeBooking({ paypal_deposit_order_id: 'ORDER-123' });
    mockBookingFetch(booking);
    mockGetPayPalOrder.mockResolvedValueOnce(makePayPalOrder('40.00'));
    mockCapturePayPalPayment.mockResolvedValueOnce({
      transactionId: 'CAPTURE-XYZ',
      status: 'COMPLETED',
      payerId: 'PAYER-2',
      amount: '40.00',
    });
    // DB update returns an error
    mockUpdateSuccess({ data: null, error: { message: 'DB write failed' } });

    const res = await callRoute('booking-uuid-1', { orderId: 'ORDER-123' });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBeDefined();

    const { logAuditEvent } = await import('@/app/actions/audit');
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'payment.capture_local_update_failed' }),
    );
  });
});
