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

const mockCapturePayPalPayment = vi.fn();

vi.mock('@/lib/paypal', () => ({
  capturePayPalPayment: mockCapturePayPalPayment,
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
    paypal_deposit_order_id: 'ORDER-123',
    paypal_deposit_capture_id: null,
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
    mockCapturePayPalPayment.mockRejectedValueOnce(new Error('PayPal capture failed'));

    const res = await callRoute('booking-uuid-1', { orderId: 'ORDER-123' });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBeDefined();
  });
});
