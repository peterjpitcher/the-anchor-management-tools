/**
 * The external create-booking route is authenticated by API key, so it runs
 * with no user session. Every private_bookings RLS policy is scoped to
 * authenticated users, which means the booking write MUST go through the
 * service-role admin client. Until 15 August 2026 it went through the default
 * session client instead: the insert failed, the route returned a generic 500,
 * and the website quietly fell back to email, so no website Christmas enquiry
 * ever reached /private-bookings. These tests pin the fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createBookingMock = vi.fn();
const sendManagerEmailMock = vi.fn(async () => ({ sent: true }));

// One recognisable sentinel: the assertion is that THIS object reaches the
// service, proving the route hands its admin client to the booking write.
const adminClient = { __sentinel: 'admin-client' };

vi.mock('@/services/private-bookings', () => ({
  PrivateBookingService: { createBooking: createBookingMock },
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => adminClient,
}));

vi.mock('@/lib/api/auth', () => ({
  // Pass-through: authentication is not under test here.
  withApiAuth: async (handler: (req: Request, apiKey: unknown) => Promise<Response>) =>
    handler(currentRequest as Request, { id: 'test-key', permissions: ['*'] }),
}));

vi.mock('@/lib/api/idempotency', () => ({
  getIdempotencyKey: () => null,
  computeIdempotencyRequestHash: () => 'test-hash',
  claimIdempotencyKey: vi.fn(async () => ({ state: 'claimed' })),
  persistIdempotencyResponse: vi.fn(async () => undefined),
  releaseIdempotencyClaim: vi.fn(async () => undefined),
}));

vi.mock('@/lib/private-bookings/manager-notifications', () => ({
  sendManagerPrivateBookingCreatedEmail: sendManagerEmailMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let currentRequest: Request | null = null;

function buildRequest(body: Record<string, unknown>): Request {
  return new Request('https://management.example.test/api/external/create-booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: 'ZZTEST DoNotContact',
  email: 'test@example.com',
  phone: '07700900000',
  partySize: 24,
  preferredDate: '2026-12-11',
  preferredTime: '19:00',
  notes: 'Unit test enquiry',
  perks: [],
};

describe('POST /api/external/create-booking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBookingMock.mockResolvedValue({
      id: 'pb-test-1',
      booking_reference: 'PB-TEST-1',
      status: 'draft',
    });
  });

  it('creates the private booking through the admin client, never the session client', async () => {
    currentRequest = buildRequest(validBody);
    const { POST } = await import('./route');
    const response = await POST(currentRequest as never);

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toEqual({ success: true, id: 'pb-test-1', reference: 'PB-TEST-1' });

    expect(createBookingMock).toHaveBeenCalledTimes(1);
    const [input, options] = createBookingMock.mock.calls[0];
    // The client option is the whole fix: without it the write runs on the
    // session client and RLS refuses it for API-key callers.
    expect(options).toEqual({ client: adminClient });
    expect(input.event_type).toBe('Christmas Party');
    expect(input.source).toBe('website');
    expect(input.status).toBe('draft');
    expect(input.internal_notes).toContain('[Created via Website Christmas Form]');
  });

  it('notifies the manager once the booking is created', async () => {
    currentRequest = buildRequest(validBody);
    const { POST } = await import('./route');
    await POST(currentRequest as never);

    expect(sendManagerEmailMock).toHaveBeenCalledTimes(1);
    expect(sendManagerEmailMock.mock.calls[0][0]).toMatchObject({
      createdVia: 'api_external_create_booking',
    });
  });

  it('returns a 500 without a manager email when the booking write fails', async () => {
    createBookingMock.mockRejectedValueOnce(new Error('insert refused'));
    currentRequest = buildRequest(validBody);
    const { POST } = await import('./route');
    const response = await POST(currentRequest as never);

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(sendManagerEmailMock).not.toHaveBeenCalled();
  });
});
