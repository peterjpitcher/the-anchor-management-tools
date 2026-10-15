import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * A discount or an item change has already moved the booking total by the time
 * apply_balance_payment_status re-derives the paid-in-full stamp. supabase-js never throws
 * on a refused RPC, it returns { error }, so the old code dropped every failure silently.
 * The change itself must still report success (it saved), but with a warning staff can see,
 * and the failure must be reported at error level.
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/services/sms-queue', () => ({
  SmsQueueService: {
    queueAndSend: vi.fn(),
  },
}))

vi.mock('@/lib/sms/customers', () => ({
  ensureCustomerForPhone: vi.fn(),
}))

vi.mock('@/lib/google-calendar', () => ({
  syncCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  isCalendarConfigured: vi.fn(() => false),
}))

vi.mock('@/lib/analytics/events', () => ({
  recordAnalyticsEvent: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/lib/email/private-booking-emails', () => ({
  sendBookingConfirmationEmail: vi.fn(() => Promise.resolve()),
  sendBookingCalendarInvite: vi.fn(() => Promise.resolve()),
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PrivateBookingService } from '@/services/private-bookings'

const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

const RPC_ERROR = { message: 'canceling statement due to statement timeout', code: '57014' }

const warningFor = (lead: string): string =>
  `${lead}, but the booking's balance status did not update, so it may show the wrong amount still owed or the wrong paid-in-full status. Do not make the change again: tell the developer.`

let rpc: Mock
let consoleError: ReturnType<typeof vi.spyOn>

function rpcFails(): void {
  rpc.mockResolvedValue({ data: null, error: RPC_ERROR })
}

function rpcSucceeds(): void {
  rpc.mockResolvedValue({ data: null, error: null })
}

function expectReported(context: string): void {
  expect(consoleError).toHaveBeenCalledWith(
    `[private_bookings] Updating the balance paid status ${context} failed`,
    expect.objectContaining({ bookingId: 'booking-1', code: '57014', message: RPC_ERROR.message }),
  )
}

// A session client whose private_bookings update for the discount finds the row.
function discountClient(): void {
  mockedCreateClient.mockResolvedValue({
    from: vi.fn((table: string) => {
      if (table !== 'private_bookings') throw new Error(`Unexpected table: ${table}`)
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'booking-1' }, error: null }),
            }),
          }),
        }),
      }
    }),
  })
}

// A session client for item add: reads the last display order, then inserts the item.
function addItemClient(): void {
  mockedCreateClient.mockResolvedValue({
    from: vi.fn((table: string) => {
      if (table !== 'private_booking_items') throw new Error(`Unexpected table: ${table}`)
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [{ display_order: 2 }], error: null }),
            }),
          }),
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    }),
  })
}

// A session client for item update or delete: reads the item, then changes it.
function itemClient(write: 'update' | 'delete'): void {
  mockedCreateClient.mockResolvedValue({
    from: vi.fn((table: string) => {
      if (table !== 'private_booking_items') throw new Error(`Unexpected table: ${table}`)
      const changed = {
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'item-1' }, error: null }),
          }),
        }),
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                booking_id: 'booking-1',
                item_type: 'other',
                quantity: 2,
                unit_price: 50,
                discount_type: null,
                discount_value: null,
              },
              error: null,
            }),
          }),
        }),
        [write]: vi.fn().mockReturnValue(changed),
      }
    }),
  })
}

const discount = () =>
  PrivateBookingService.applyBookingDiscount('booking-1', {
    discount_type: 'percent',
    discount_amount: 10,
    discount_reason: 'Loyalty',
  })

const addItem = () =>
  PrivateBookingService.addBookingItem({
    booking_id: 'booking-1',
    item_type: 'other',
    description: 'Cake table',
    quantity: 1,
    unit_price: 40,
    vat_rate: 20,
  })

describe('balance paid status after a private booking total changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc = vi.fn()
    mockedCreateAdminClient.mockReturnValue({ rpc })
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  describe('applyBookingDiscount', () => {
    it('saves with a warning and reports the error when the balance status RPC fails', async () => {
      discountClient()
      rpcFails()

      const result = await discount()

      expect(result).toEqual({ success: true, warning: warningFor('The discount was saved') })
      expect(rpc).toHaveBeenCalledWith('apply_balance_payment_status', { p_booking_id: 'booking-1' })
      expectReported('after discount change')
    })

    it('returns plain success when the balance status RPC succeeds', async () => {
      discountClient()
      rpcSucceeds()

      await expect(discount()).resolves.toEqual({ success: true })
      expect(consoleError).not.toHaveBeenCalled()
    })
  })

  describe('addBookingItem', () => {
    it('saves with a warning and reports the error when the balance status RPC fails', async () => {
      addItemClient()
      rpcFails()

      const result = await addItem()

      expect(result).toEqual({ success: true, warning: warningFor('The item was saved') })
      expect(rpc).toHaveBeenCalledWith('apply_balance_payment_status', { p_booking_id: 'booking-1' })
      expectReported('after item add')
    })

    it('returns plain success when the balance status RPC succeeds', async () => {
      addItemClient()
      rpcSucceeds()

      await expect(addItem()).resolves.toEqual({ success: true })
      expect(consoleError).not.toHaveBeenCalled()
    })
  })

  describe('updateBookingItem', () => {
    it('saves with a warning and reports the error when the balance status RPC fails', async () => {
      itemClient('update')
      rpcFails()

      const result = await PrivateBookingService.updateBookingItem('item-1', { quantity: 3 })

      expect(result).toEqual({
        success: true,
        bookingId: 'booking-1',
        warning: warningFor('The item was saved'),
      })
      expect(rpc).toHaveBeenCalledWith('apply_balance_payment_status', { p_booking_id: 'booking-1' })
      expectReported('after item update')
    })

    it('returns plain success when the balance status RPC succeeds', async () => {
      itemClient('update')
      rpcSucceeds()

      await expect(PrivateBookingService.updateBookingItem('item-1', { quantity: 3 })).resolves.toEqual({
        success: true,
        bookingId: 'booking-1',
      })
      expect(consoleError).not.toHaveBeenCalled()
    })
  })

  describe('deleteBookingItem', () => {
    it('removes with a warning and reports the error when the balance status RPC fails', async () => {
      itemClient('delete')
      rpcFails()

      const result = await PrivateBookingService.deleteBookingItem('item-1')

      expect(result).toEqual({
        success: true,
        bookingId: 'booking-1',
        warning: warningFor('The item was removed'),
      })
      expect(rpc).toHaveBeenCalledWith('apply_balance_payment_status', { p_booking_id: 'booking-1' })
      expectReported('after item delete')
    })

    it('returns plain success when the balance status RPC succeeds', async () => {
      itemClient('delete')
      rpcSucceeds()

      await expect(PrivateBookingService.deleteBookingItem('item-1')).resolves.toEqual({
        success: true,
        bookingId: 'booking-1',
      })
      expect(consoleError).not.toHaveBeenCalled()
    })
  })
})
