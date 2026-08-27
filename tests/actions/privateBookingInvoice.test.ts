import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn(() => true),
  sendInvoiceEmail: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { sendInvoiceEmail, isGraphConfigured } from '@/lib/microsoft-graph'
import {
  generatePrivateBookingInvoice,
  previewPrivateBookingInvoice,
  retryPrivateBookingInvoiceEmail,
} from '@/app/actions/privateBookingInvoice'

const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedSendInvoiceEmail = sendInvoiceEmail as unknown as Mock
const mockedIsGraphConfigured = isGraphConfigured as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

const BOOKING_ID = '11111111-1111-1111-1111-111111111111'
const INVOICE_ID = '22222222-2222-2222-2222-222222222222'
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333'
const VENDOR_ID = '44444444-4444-4444-4444-444444444444'
const USER_ID = '55555555-5555-5555-5555-555555555555'

function buildBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    status: 'confirmed',
    customer_id: CUSTOMER_ID,
    customer_full_name: 'Test Customer',
    contact_email: 'test@example.com',
    contact_phone: '+447700900000',
    event_date: '2026-10-15',
    event_type: 'Birthday',
    balance_due_date: '2026-10-01',
    deposit_amount: 250,
    deposit_paid_date: '2026-08-12T14:37:43.188Z',
    deposit_payment_method: 'cash',
    deposit_waived: false,
    discount_type: null,
    discount_amount: 0,
    date_tbd: false,
    cancelled_at: null,
    invoice_id: null,
    invoice_sent_at: null,
    invoice_deposit_treatment: null,
    items: [
      {
        id: 'item-1',
        item_type: 'space',
        description: 'The Dining Room',
        quantity: 4,
        unit_price: 200,
        discount_type: null,
        discount_value: 0,
        vat_rate: 20,
        line_total: 800,
        display_order: 0,
        created_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 'item-2',
        item_type: 'catering',
        description: 'Finger Buffet',
        quantity: 10,
        unit_price: 15,
        discount_type: null,
        discount_value: 0,
        vat_rate: 20,
        line_total: 150,
        display_order: 1,
        created_at: '2026-08-01T00:00:00Z',
      },
    ],
    payments: [],
    ...overrides,
  }
}

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV-003WD',
    status: 'draft',
    total_amount: 1140,
    paid_amount: 0,
    due_date: '2026-10-01',
    reference: 'Test Customer Birthday, 15 October 2026',
    vendor: { id: VENDOR_ID, name: 'Test Customer' },
    line_items: [],
    payments: [],
    ...overrides,
  }
}

/**
 * A chainable Supabase stub. Every builder method returns `this`, and the
 * terminal awaits resolve from a per-table script, so a test only has to say
 * what each table should return rather than model the query shape.
 */
function makeAdminClient(config: {
  roles?: Array<{ role_name: string }>
  booking?: Record<string, unknown> | null
  vendorLookup?: { id: string } | null
  vendorInsert?: { id: string } | null
  invoice?: Record<string, unknown> | null
  rpcResult?: unknown
  rpcError?: { message: string } | null
}) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = []
  const inserts: Array<{ table: string; values: unknown }> = []
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []

  const builder = (table: string) => {
    const state: { op: string; values?: Record<string, unknown> } = { op: 'select' }
    const chain: Record<string, unknown> = {}
    const passthrough = ['select', 'eq', 'is', 'not', 'order', 'limit']
    for (const method of passthrough) {
      chain[method] = vi.fn(() => chain)
    }
    chain.update = vi.fn((values: Record<string, unknown>) => {
      state.op = 'update'
      state.values = values
      updates.push({ table, values })
      return chain
    })
    chain.insert = vi.fn((values: unknown) => {
      state.op = 'insert'
      inserts.push({ table, values })
      return chain
    })

    const resolve = () => {
      if (state.op === 'update') return { data: null, error: null }
      if (state.op === 'insert') {
        if (table === 'invoice_vendors') {
          return { data: config.vendorInsert ?? { id: VENDOR_ID }, error: null }
        }
        return { data: null, error: null }
      }
      if (table === 'private_bookings') return { data: config.booking ?? null, error: null }
      if (table === 'invoice_vendors') return { data: config.vendorLookup ?? null, error: null }
      if (table === 'invoices') return { data: config.invoice ?? null, error: null }
      return { data: null, error: null }
    }

    chain.maybeSingle = vi.fn(async () => resolve())
    chain.single = vi.fn(async () => resolve())
    // Support `await db.from(...).update(...).eq(...)` with no terminal call.
    ;(chain as { then?: unknown }).then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled)

    return chain
  }

  return {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'get_user_roles') {
        return { data: config.roles ?? [{ role_name: 'super_admin' }], error: null }
      }
      if (fn === 'create_private_booking_invoice_atomic') {
        if (config.rpcError) return { data: null, error: config.rpcError }
        return {
          data: config.rpcResult ?? { created: true, invoice: buildInvoice() },
          error: null,
        }
      }
      return { data: null, error: null }
    }),
    __updates: updates,
    __inserts: inserts,
    __rpcCalls: rpcCalls,
  }
}

function setAuthedUser(userId: string | null) {
  mockedCreateClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  setAuthedUser(USER_ID)
  mockedIsGraphConfigured.mockReturnValue(true)
  mockedSendInvoiceEmail.mockResolvedValue({ success: true, messageId: 'msg-1' })
})

describe('generatePrivateBookingInvoice', () => {
  describe('authorisation', () => {
    it('refuses a signed-out caller', async () => {
      setAuthedUser(null)
      mockedCreateAdminClient.mockReturnValue(makeAdminClient({}))

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })
      expect(result.error).toBe('Unauthorized')
    })

    it('refuses a manager', async () => {
      // Managers already hold invoices.create and private_bookings.edit, so a
      // permission-row check would let them through. Only the explicit role
      // check keeps this super_admin only.
      mockedCreateAdminClient.mockReturnValue(
        makeAdminClient({ roles: [{ role_name: 'manager' }], booking: buildBooking() }),
      )

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })
      expect(result.error).toContain('super admins')
      expect(result.invoiceId).toBeUndefined()
    })

    it('allows a super_admin', async () => {
      mockedCreateAdminClient.mockReturnValue(
        makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() }),
      )

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })
      expect(result.error).toBeUndefined()
      expect(result.invoiceNumber).toBe('INV-003WD')
    })
  })

  describe('guards', () => {
    it('refuses a booking with no email', async () => {
      mockedCreateAdminClient.mockReturnValue(
        makeAdminClient({ booking: buildBooking({ contact_email: null }) }),
      )

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })
      expect(result.error).toContain('email address')
    })

    it('refuses an unknown deposit treatment', async () => {
      mockedCreateAdminClient.mockReturnValue(makeAdminClient({ booking: buildBooking() }))

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'whatever' as never,
      })
      expect(result.error).toBeTruthy()
    })

    it('refuses when the booking changed since the dialog opened', async () => {
      // The preview is only meaningful if it still describes the booking. A
      // stale confirmation could otherwise send different figures than the
      // operator approved.
      mockedCreateAdminClient.mockReturnValue(makeAdminClient({ booking: buildBooking() }))

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
        sourceHash: 'a-hash-from-a-different-version',
      })
      expect(result.error).toContain('changed while the invoice was on screen')
    })
  })

  describe('the database call', () => {
    it('passes the mapped lines, totals and dates through', async () => {
      const admin = makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() })
      mockedCreateAdminClient.mockReturnValue(admin)

      await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'deducted',
        reference: 'PO-12345',
      })

      const call = admin.__rpcCalls.find(c => c.fn === 'create_private_booking_invoice_atomic')
      expect(call).toBeDefined()
      expect(call?.args.p_deposit_treatment).toBe('deducted')
      expect(call?.args.p_reference).toBe('PO-12345')
      expect(call?.args.p_booking_id).toBe(BOOKING_ID)
      expect((call?.args.p_totals as Record<string, unknown>).total_amount).toBe(1140)
      expect((call?.args.p_totals as Record<string, unknown>).vendor_id).toBe(VENDOR_ID)
      expect((call?.args.p_line_items as unknown[]).length).toBe(2)
    })

    it('never sets a due date in the past', async () => {
      // 15 of 19 live priced bookings already have a balance_due_date behind
      // them. Using it directly would issue invoices that are overdue on
      // arrival and trigger a chase email the same day.
      const admin = makeAdminClient({
        booking: buildBooking({ balance_due_date: '2020-01-01' }),
        invoice: buildInvoice(),
      })
      mockedCreateAdminClient.mockReturnValue(admin)

      await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })

      const call = admin.__rpcCalls.find(c => c.fn === 'create_private_booking_invoice_atomic')
      expect(call?.args.p_due_date).toBe(call?.args.p_invoice_date)
    })

    it('falls back to a generated reference when none is given', async () => {
      const admin = makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() })
      mockedCreateAdminClient.mockReturnValue(admin)

      await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
        reference: '   ',
      })

      const call = admin.__rpcCalls.find(c => c.fn === 'create_private_booking_invoice_atomic')
      expect(call?.args.p_reference).toContain('Test Customer')
      expect(call?.args.p_reference).toContain('Birthday')
    })

    it('turns a database error code into something a person can act on', async () => {
      mockedCreateAdminClient.mockReturnValue(
        makeAdminClient({
          booking: buildBooking(),
          rpcError: { message: 'booking_payments_exceed_invoice_total: paid 300 exceeds total 200' },
        }),
      )

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'deducted',
      })
      expect(result.error).toContain('owed a refund')
      expect(result.error).not.toContain('booking_payments_exceed_invoice_total')
    })
  })

  describe('delivery', () => {
    it('records sent_at rather than overwriting status', async () => {
      // status carries payment state too, so an invoice born partially_paid
      // would lose that if delivery were recorded there.
      const admin = makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() })
      mockedCreateAdminClient.mockReturnValue(admin)

      await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })

      const deliveryStamp = admin.__updates.find(
        u => u.table === 'invoices' && 'sent_at' in u.values,
      )
      expect(deliveryStamp).toBeDefined()
      expect(deliveryStamp?.values.sent_to).toBe('test@example.com')
      expect(deliveryStamp?.values.status).toBeUndefined()
    })

    it('mirrors the booking timestamp so the booking screen can show it', async () => {
      const admin = makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() })
      mockedCreateAdminClient.mockReturnValue(admin)

      await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })

      expect(
        admin.__updates.some(u => u.table === 'private_bookings' && 'invoice_sent_at' in u.values),
      ).toBe(true)
    })

    it('reports the invoice as created but unsent when the email fails', async () => {
      mockedSendInvoiceEmail.mockResolvedValue({ success: false, error: 'Graph refused' })
      const admin = makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() })
      mockedCreateAdminClient.mockReturnValue(admin)

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })

      expect(result.error).toBeUndefined()
      expect(result.sent).toBe(false)
      expect(result.warning).toContain('Graph refused')
      // Nothing reached the customer, so no delivery may be recorded.
      expect(admin.__updates.some(u => 'sent_at' in u.values)).toBe(false)
    })

    it('does not send when email is not configured', async () => {
      mockedIsGraphConfigured.mockReturnValue(false)
      mockedCreateAdminClient.mockReturnValue(
        makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() }),
      )

      const result = await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })
      expect(result.sent).toBe(false)
      expect(mockedSendInvoiceEmail).not.toHaveBeenCalled()
    })

    it('passes the deposit statement to the PDF when it is held separately', async () => {
      mockedCreateAdminClient.mockReturnValue(
        makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() }),
      )

      await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })

      const options = mockedSendInvoiceEmail.mock.calls[0][6]
      expect(options.deposit).toMatchObject({ amount: 250, treatment: 'held_separately' })
    })

    it('sends no deposit statement when the deposit was waived', async () => {
      mockedCreateAdminClient.mockReturnValue(
        makeAdminClient({
          booking: buildBooking({ deposit_waived: true }),
          invoice: buildInvoice(),
        }),
      )

      await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })

      expect(mockedSendInvoiceEmail.mock.calls[0][6].deposit).toBeUndefined()
    })
  })

  describe('auditing', () => {
    it('records a failed send as a failure, not a success', async () => {
      mockedSendInvoiceEmail.mockResolvedValue({ success: false, error: 'nope' })
      mockedCreateAdminClient.mockReturnValue(
        makeAdminClient({ booking: buildBooking(), invoice: buildInvoice() }),
      )

      await generatePrivateBookingInvoice({
        bookingId: BOOKING_ID,
        depositTreatment: 'held_separately',
      })

      const entry = mockedLogAuditEvent.mock.calls[0][0]
      expect(entry.operation_status).toBe('failure')
      expect(entry.resource_type).toBe('private_booking_invoice')
      expect(entry.new_values.email_error).toBe('nope')
    })
  })
})

describe('previewPrivateBookingInvoice', () => {
  it('prices both deposit outcomes so the choice can be made on screen', async () => {
    mockedCreateAdminClient.mockReturnValue(makeAdminClient({ booking: buildBooking() }))

    const result = await previewPrivateBookingInvoice(BOOKING_ID)
    expect(result.error).toBeUndefined()
    expect(result.preview?.invoiceTotal).toBe(1140)
    expect(result.preview?.balanceHoldingDeposit).toBe(1140)
    expect(result.preview?.balanceDeductingDeposit).toBe(890)
    expect(result.preview?.deposit).toMatchObject({ amount: 250, method: 'cash' })
  })

  it('flags when applying the deposit would overpay the invoice', async () => {
    // Three live bookings have a deposit larger than the event total. Netting
    // it off there would demand a negative amount.
    mockedCreateAdminClient.mockReturnValue(
      makeAdminClient({
        booking: buildBooking({
          deposit_amount: 2000,
          items: [
            {
              id: 'item-1',
              item_type: 'catering',
              description: 'Small buffet',
              quantity: 1,
              unit_price: 100,
              discount_type: null,
              discount_value: 0,
              vat_rate: 20,
              line_total: 100,
              display_order: 0,
              created_at: '2026-08-01T00:00:00Z',
            },
          ],
        }),
      }),
    )

    const result = await previewPrivateBookingInvoice(BOOKING_ID)
    expect(result.preview?.depositWouldOverpay).toBe(true)
    expect(result.preview?.balanceDeductingDeposit).toBe(0)
  })

  it('subtracts payments already received', async () => {
    mockedCreateAdminClient.mockReturnValue(
      makeAdminClient({
        booking: buildBooking({ payments: [{ id: 'p1', amount: 400, method: 'cash' }] }),
      }),
    )

    const result = await previewPrivateBookingInvoice(BOOKING_ID)
    expect(result.preview?.paymentsReceived).toBe(400)
    expect(result.preview?.balanceHoldingDeposit).toBe(740)
  })

  it('refuses a manager', async () => {
    mockedCreateAdminClient.mockReturnValue(
      makeAdminClient({ roles: [{ role_name: 'staff' }], booking: buildBooking() }),
    )
    const result = await previewPrivateBookingInvoice(BOOKING_ID)
    expect(result.error).toContain('super admins')
  })
})

describe('retryPrivateBookingInvoiceEmail', () => {
  it('sends without creating anything', async () => {
    const admin = makeAdminClient({
      booking: buildBooking({ invoice_id: INVOICE_ID, invoice_deposit_treatment: 'deducted' }),
      invoice: buildInvoice(),
    })
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await retryPrivateBookingInvoiceEmail(BOOKING_ID)

    expect(result.error).toBeUndefined()
    expect(
      admin.__rpcCalls.some(c => c.fn === 'create_private_booking_invoice_atomic'),
    ).toBe(false)
    expect(mockedSendInvoiceEmail).toHaveBeenCalledTimes(1)
  })

  it('refuses when the booking has no invoice', async () => {
    mockedCreateAdminClient.mockReturnValue(makeAdminClient({ booking: buildBooking() }))
    const result = await retryPrivateBookingInvoiceEmail(BOOKING_ID)
    expect(result.error).toContain('no invoice')
  })

  it('reuses the treatment recorded when the invoice was raised', async () => {
    mockedCreateAdminClient.mockReturnValue(
      makeAdminClient({
        booking: buildBooking({ invoice_id: INVOICE_ID, invoice_deposit_treatment: 'deducted' }),
        invoice: buildInvoice(),
      }),
    )

    await retryPrivateBookingInvoiceEmail(BOOKING_ID)
    expect(mockedSendInvoiceEmail.mock.calls[0][6].deposit.treatment).toBe('deducted')
  })
})
