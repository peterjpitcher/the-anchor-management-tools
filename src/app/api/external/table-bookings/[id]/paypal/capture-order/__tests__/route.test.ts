import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { withApiAuth } from '@/lib/api/auth';

// --- Module mocks ---

vi.mock('@/lib/api/auth', () => ({
  withApiAuth: vi.fn(
    (
      handler: (req: Request, apiKey: unknown) => Promise<Response>,
      _permissions: string[],
      request: Request,
    ) => handler(request, { id: 'test-key-id', name: 'Test Key', permissions: ['payments:capture'], rate_limit: 100, is_active: true }),
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

// Hoisted, unlike the mocks above: the factory below reads these two while the route is being
// imported at the top of the file, before an ordinary const here would exist.
const { mockCapturePayPalPayment, mockGetPayPalOrder } = vi.hoisted(() => ({
  mockCapturePayPalPayment: vi.fn(),
  mockGetPayPalOrder: vi.fn(),
}));

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  capturePayPalPayment: mockCapturePayPalPayment,
  getPayPalOrder: mockGetPayPalOrder,
}));

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// Imported once, after the mocks. The route's imports reach the table-booking SMS and email code
// (some 80 modules, plus the Twilio, Resend and Microsoft Graph clients): about half a second to
// load, and far longer in a busy full run. Loading it inside each test after vi.resetModules()
// charged that to the first test's 5 second budget. These tests never run that code and nothing
// they do run keeps state between tests, so one load is enough.
import { POST } from '../route';

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

async function callRoute(id: string, body: object) {
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
    expect(withApiAuth).toHaveBeenCalledWith(expect.any(Function), ['payments:capture'], expect.any(Request));
    expect(mockCapturePayPalPayment).toHaveBeenCalledOnce();
    expect(mockCapturePayPalPayment).toHaveBeenCalledWith('ORDER-123', 'GBP');
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
