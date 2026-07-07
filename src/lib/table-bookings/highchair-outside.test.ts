import { describe, expect, it, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks
//
// bookings.ts transitively imports the Twilio, admin-Supabase, email and
// notification modules at load time (via @/lib/sms/bulk -> @/lib/twilio, etc.),
// so we stub every external transport per the workspace rule (never hit real
// APIs). Internal utilities (getSmartFirstName, ensureReplyInstruction) are left
// real so we exercise the true wording path.
// ---------------------------------------------------------------------------

const notifyCustomerMock = vi.fn()

vi.mock('@/lib/notifications/notify', () => ({
  notifyCustomer: (input: unknown) => notifyCustomerMock(input),
}))

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(async () => ({ success: true, code: null, logFailure: false })),
}))

vi.mock('@/lib/table-bookings/manage-booking', () => ({
  // Token creation would otherwise hit the DB / crypto; a stable stub keeps the
  // manage link deterministic so wording assertions stay focused on chairs/outside.
  createTableManageToken: vi.fn(async () => ({
    rawToken: 'raw',
    url: 'https://example.test/g/raw/table-manage',
    expiresAt: '2026-07-10T00:00:00.000Z',
  })),
}))

// AuditService.logAuditEvent is invoked as a side-effect on the comms path.
vi.mock('@/services/audit', () => ({
  AuditService: { logAuditEvent: vi.fn(async () => undefined) },
}))

// admin client is imported at module load by kitchen-pacing / bulk; a no-op
// factory keeps the import graph happy. Per-test Supabase behaviour is supplied
// through the explicit client argument each function accepts.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}))

import {
  enrichSlotsWithHighChairsRemaining,
  getHighChairInventory,
  DEFAULT_HIGH_CHAIR_INVENTORY,
  type HighChairHoldRow,
  type KitchenAvailabilitySlot,
} from './kitchen-pacing'
import {
  sendTableBookingCreatedSmsIfAllowed,
  type TableBookingRpcResult,
} from './bookings'

// A fixed "now" that sits before every fixture hold's start so live rows stay eligible.
const NOW = new Date('2026-07-05T10:00:00.000Z')

// ---------------------------------------------------------------------------
// Fixtures / factories
// ---------------------------------------------------------------------------

function slot(time: string): KitchenAvailabilitySlot {
  return { time, covers: 0, remaining: 10 }
}

function hold(partial: Partial<HighChairHoldRow>): HighChairHoldRow {
  return {
    start_datetime: '2026-07-05T18:00:00.000Z',
    end_datetime: '2026-07-05T20:00:00.000Z',
    high_chair_count: 1,
    status: 'confirmed',
    left_at: null,
    hold_expires_at: null,
    payment_status: null,
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// enrichSlotsWithHighChairsRemaining (pure)
// ---------------------------------------------------------------------------

describe('enrichSlotsWithHighChairsRemaining', () => {
  const DATE = '2026-07-05'
  const STEP = 30
  const INVENTORY = 2

  it('should subtract overlapping granted chairs from inventory when a slot overlaps a hold', () => {
    // Hold spans 19:00–21:00 London; the 19:00 slot [19:00,19:30) overlaps it.
    const holds = [
      hold({
        start_datetime: '2026-07-05T18:00:00.000Z', // 19:00 London (BST)
        end_datetime: '2026-07-05T20:00:00.000Z', // 21:00 London
        high_chair_count: 1,
      }),
    ]
    const result = enrichSlotsWithHighChairsRemaining([slot('19:00')], holds, INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(1)
  })

  it('should leave a non-overlapping slot at full inventory', () => {
    // Hold spans 19:00–20:00 London; the 18:00 slot [18:00,18:30) does not overlap.
    const holds = [
      hold({
        start_datetime: '2026-07-05T18:00:00.000Z', // 19:00 London
        end_datetime: '2026-07-05T19:00:00.000Z', // 20:00 London
        high_chair_count: 2,
      }),
    ]
    const result = enrichSlotsWithHighChairsRemaining([slot('18:00')], holds, INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(INVENTORY)
  })

  it('should clamp remaining at zero when overlapping holds oversubscribe the inventory', () => {
    const holds = [
      hold({ start_datetime: '2026-07-05T18:00:00.000Z', end_datetime: '2026-07-05T20:00:00.000Z', high_chair_count: 2 }),
      hold({ start_datetime: '2026-07-05T18:00:00.000Z', end_datetime: '2026-07-05T20:00:00.000Z', high_chair_count: 2 }),
    ]
    const result = enrichSlotsWithHighChairsRemaining([slot('19:00')], holds, INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(0)
  })

  it('should exclude cancelled, no_show, left, and expired-hold rows (parity with shouldCountBooking)', () => {
    const holds = [
      hold({ status: 'cancelled', high_chair_count: 2 }),
      hold({ status: 'no_show', high_chair_count: 2 }),
      hold({ left_at: '2026-07-05T19:30:00.000Z', high_chair_count: 2 }),
      hold({
        status: 'pending_payment',
        hold_expires_at: '2026-07-05T09:00:00.000Z', // before NOW -> expired
        payment_status: 'pending',
        high_chair_count: 2,
      }),
    ]
    const result = enrichSlotsWithHighChairsRemaining([slot('19:00')], holds, INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(INVENTORY)
  })

  it('should still count a live (unexpired) pending-payment hold', () => {
    const holds = [
      hold({
        status: 'pending_payment',
        hold_expires_at: '2026-07-05T23:00:00.000Z', // after NOW -> live
        payment_status: 'pending',
        high_chair_count: 1,
        start_datetime: '2026-07-05T18:00:00.000Z',
        end_datetime: '2026-07-05T20:00:00.000Z',
      }),
    ]
    const result = enrichSlotsWithHighChairsRemaining([slot('19:00')], holds, INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(1)
  })

  it('should ignore rows with a zero or missing chair count', () => {
    const holds = [
      hold({ high_chair_count: 0 }),
      hold({ high_chair_count: null }),
    ]
    const result = enrichSlotsWithHighChairsRemaining([slot('19:00')], holds, INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(INVENTORY)
  })

  it('should fall back to the default inventory when inventory is not finite', () => {
    const result = enrichSlotsWithHighChairsRemaining([slot('19:00')], [], Number.NaN, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(DEFAULT_HIGH_CHAIR_INVENTORY)
  })

  it('should treat a negative inventory as zero', () => {
    const result = enrichSlotsWithHighChairsRemaining([slot('19:00')], [], -5, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(0)
  })

  it('should ignore holds with an unparseable seating span', () => {
    const holds = [hold({ start_datetime: null, high_chair_count: 2 })]
    const result = enrichSlotsWithHighChairsRemaining([slot('19:00')], holds, INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(INVENTORY)
  })

  it('should be DST-safe: a BST-evening overlap is resolved via London-local slot windows', () => {
    // 2026-07-05 is British Summer Time (UTC+1). A 19:30 London slot maps to
    // 18:30Z; the hold 18:00Z–20:00Z (19:00–21:00 London) must overlap it.
    const holds = [
      hold({
        start_datetime: '2026-07-05T18:00:00.000Z',
        end_datetime: '2026-07-05T20:00:00.000Z',
        high_chair_count: 2,
      }),
    ]
    const result = enrichSlotsWithHighChairsRemaining([slot('19:30')], holds, INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(0)
  })

  it('should default a malformed slot time to full inventory rather than throwing', () => {
    const bad = { time: 'not-a-time', covers: 0, remaining: 10 }
    const result = enrichSlotsWithHighChairsRemaining([bad], [], INVENTORY, DATE, STEP, NOW)
    expect(result[0].high_chairs_remaining).toBe(INVENTORY)
  })
})

// ---------------------------------------------------------------------------
// getHighChairInventory / DEFAULT_HIGH_CHAIR_INVENTORY
// ---------------------------------------------------------------------------

describe('getHighChairInventory', () => {
  function clientReturning(result: { data: unknown; error: unknown }) {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => result),
          })),
        })),
      })),
    } as never
  }

  it('should read the {value} wrapper when the setting row is present', async () => {
    const client = clientReturning({
      data: { key: 'high_chair_inventory', value: { value: 5 } },
      error: null,
    })
    await expect(getHighChairInventory(client)).resolves.toBe(5)
  })

  it('should fall back to the default of 2 when the row is missing', async () => {
    const client = clientReturning({ data: null, error: null })
    await expect(getHighChairInventory(client)).resolves.toBe(DEFAULT_HIGH_CHAIR_INVENTORY)
    expect(DEFAULT_HIGH_CHAIR_INVENTORY).toBe(2)
  })

  it('should fall back to the default when the query errors', async () => {
    const client = clientReturning({ data: null, error: { message: 'boom' } })
    await expect(getHighChairInventory(client)).resolves.toBe(DEFAULT_HIGH_CHAIR_INVENTORY)
  })

  it('should fall back to the default when the value is malformed', async () => {
    const client = clientReturning({
      data: { key: 'high_chair_inventory', value: { value: 'not-a-number' } },
      error: null,
    })
    await expect(getHighChairInventory(client)).resolves.toBe(DEFAULT_HIGH_CHAIR_INVENTORY)
  })
})

// ---------------------------------------------------------------------------
// Comms wording — sendTableBookingCreatedSmsIfAllowed
//
// notifyCustomer is the transport boundary; we capture the SMS body and email
// HTML/text it is handed and assert the outside-safe wording and GRANTED chair
// count. Supabase is mocked to return a customer row.
// ---------------------------------------------------------------------------

describe('sendTableBookingCreatedSmsIfAllowed — wording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifyCustomerMock.mockResolvedValue({
      selectedChannels: ['email'],
      attempts: [{ channel: 'email', success: true }],
    })
  })

  function customerClient() {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: 'cust-1',
                first_name: 'Sam',
                last_name: 'Jones',
                mobile_e164: '+447700900123',
                mobile_number: '+447700900123',
                email: 'sam@example.test',
                sms_status: 'active',
                sms_opt_in: true,
                marketing_sms_opt_in: true,
                email_status: 'active',
                email_deactivated_at: null,
                marketing_email_opt_in: true,
              },
              error: null,
            })),
          })),
        })),
      })),
    } as never
  }

  function confirmedResult(partial: Partial<TableBookingRpcResult>): TableBookingRpcResult {
    return {
      state: 'confirmed',
      table_booking_id: 'tb-1',
      booking_reference: 'TB-0001',
      party_size: 4,
      start_datetime: '2026-07-10T18:00:00.000Z',
      high_chair_count: 0,
      is_outside_seating: false,
      ...partial,
    }
  }

  async function capture() {
    const arg = notifyCustomerMock.mock.calls[0]?.[0] as
      | { sms?: { body?: string }; email?: { html?: string; text?: string } }
      | undefined
    return {
      sms: arg?.sms?.body ?? '',
      html: arg?.email?.html ?? '',
      text: arg?.email?.text ?? '',
    }
  }

  it('should use outside/booking wording (not "your table") for an outside booking', async () => {
    await sendTableBookingCreatedSmsIfAllowed(customerClient(), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult({ is_outside_seating: true }),
    })
    const { sms, html, text } = await capture()
    expect(sms).toContain('outside booking')
    expect(sms).toContain('Outside seating (weather permitting)')
    expect(sms).not.toMatch(/your table/i)
    expect(text).toContain('Outside seating (weather permitting)')
    expect(html).toContain('Outside seating')
    // Confirmed outside subject line, never "table confirmed".
    expect(html).not.toMatch(/table booking at the anchor is confirmed/i)
  })

  it('should render "High chair reserved x2" using the GRANTED count', async () => {
    await sendTableBookingCreatedSmsIfAllowed(customerClient(), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult({ high_chair_count: 2 }),
    })
    const { sms, html, text } = await capture()
    expect(sms).toContain('High chair reserved x2')
    expect(text).toContain('High chair reserved x2')
    // Email HTML uses the &times; entity.
    expect(html).toContain('High chair reserved')
    expect(html).toContain('&times;2')
  })

  it('should render neither chair nor outside wording for an indoor booking with no chairs', async () => {
    await sendTableBookingCreatedSmsIfAllowed(customerClient(), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult({ high_chair_count: 0, is_outside_seating: false }),
    })
    const { sms, html, text } = await capture()
    expect(sms).toMatch(/table booking/i)
    expect(sms).not.toMatch(/high chair/i)
    expect(sms).not.toMatch(/outside/i)
    expect(text).not.toMatch(/high chair/i)
    expect(text).not.toMatch(/outside/i)
    expect(html).not.toMatch(/high chair/i)
    expect(html).not.toMatch(/outside/i)
  })

  it('should not be fooled into a requested count — only the granted high_chair_count renders', async () => {
    // The RPC returns high_chairs_granted separately, but the message must key off
    // high_chair_count (the persisted granted value). Granted 1, "granted" hint 2.
    await sendTableBookingCreatedSmsIfAllowed(customerClient(), {
      customerId: 'cust-1',
      normalizedPhone: '+447700900123',
      bookingResult: confirmedResult({ high_chair_count: 1, high_chairs_granted: 2 }),
    })
    const { sms } = await capture()
    expect(sms).toContain('High chair reserved x1')
    expect(sms).not.toContain('High chair reserved x2')
  })
})
