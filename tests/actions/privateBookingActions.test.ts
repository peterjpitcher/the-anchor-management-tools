import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// env.ts reads the app URL once, when it is first imported, so it is set before any import.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://management.example.com'
})

// ---------------------------------------------------------------------------
// Module mocks — hoisted above all imports
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
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

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((e: unknown) =>
    e instanceof Error ? e.message : String(e)
  ),
}))

vi.mock('@/lib/paypal', () => ({
  PAYPAL_DEFAULT_CURRENCY: 'GBP',
  createSimplePayPalOrder: vi.fn(),
  capturePayPalPayment: vi.fn(),
  getPayPalOrder: vi.fn(),
}))

// The short booking page link (BK-172) is tested in tests/lib/private-bookings/portal-link.test.ts.
vi.mock('@/lib/private-bookings/portal-link', () => ({
  privateBookingPortalLink: vi.fn(async (booking: { id: string }) => `https://l.the-anchor.pub/short-${booking.id}`),
}))

vi.mock('@/lib/private-bookings/booking-token', () => ({
  generateBookingToken: vi.fn(() => 'mock-token'),
}))

vi.mock('@/lib/dateUtils', () => ({
  toLocalIsoDate: vi.fn((d: string) => d),
}))

vi.mock('@/lib/utils', () => ({
  sanitizeMoneyString: vi.fn((v: unknown) => v),
}))

vi.mock('@/lib/email/private-booking-emails', () => ({
  sendBookingCalendarInvite: vi.fn(),
  sendDepositPaymentLinkEmail: vi.fn(),
}))

vi.mock('@/services/sms-queue', () => ({
  SmsQueueService: {
    getQueue: vi.fn(),
    approveSms: vi.fn(),
    rejectSms: vi.fn(),
    sendApprovedSms: vi.fn(),
  },
}))

// What else is in the rooms that night (BK-070, D24): tested in privateHireNightClashes.test.ts.
vi.mock('@/services/private-bookings/night-clashes', () => ({
  hireNightWarning: vi.fn(async () => null),
}))

vi.mock('@/services/private-bookings', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/services/private-bookings')
  return {
    PrivateBookingService: {
      getBookings: vi.fn(),
      getBookingById: vi.fn(),
      getBookingByIdForEdit: vi.fn(),
      getBookingByIdForItems: vi.fn(),
      getBookingByIdForMessages: vi.fn(),
      createBooking: vi.fn(),
      updateBooking: vi.fn(),
      updateBookingStatus: vi.fn(),
      addNote: vi.fn(),
      deletePrivateBooking: vi.fn(),
      getVenueSpaces: vi.fn(),
      getVenueSpacesForManagement: vi.fn(),
      getCateringPackages: vi.fn(),
      getCateringPackagesForManagement: vi.fn(),
      getVendors: vi.fn(),
      getVendorsForManagement: vi.fn(),
      getVendorRate: vi.fn(),
      recordDeposit: vi.fn(),
      recordBalancePayment: vi.fn(),
      cancelBooking: vi.fn(),
      extendHold: vi.fn(),
      applyBookingDiscount: vi.fn(),
      addBookingItem: vi.fn(),
      updateBookingItem: vi.fn(),
      deleteBookingItem: vi.fn(),
      reorderBookingItems: vi.fn(),
      createVenueSpace: vi.fn(),
      updateVenueSpace: vi.fn(),
      deleteVenueSpace: vi.fn(),
      createCateringPackage: vi.fn(),
      updateCateringPackage: vi.fn(),
      deleteCateringPackage: vi.fn(),
      createVendor: vi.fn(),
      updateVendor: vi.fn(),
      deleteVendor: vi.fn(),
    },
    privateBookingSchema: actual.privateBookingSchema,
    bookingNoteSchema: actual.bookingNoteSchema,
    formatTimeToHHMM: vi.fn((t: string) => t?.slice(0, 5)),
    ALLOWED_VENDOR_TYPES: [
      'dj', 'band', 'photographer', 'florist', 'decorator', 'cake', 'entertainment',
      'transport', 'equipment', 'other',
    ],
    updateBalancePayment: vi.fn(),
    deleteBalancePayment: vi.fn(),
    updateDeposit: vi.fn(),
    updateDepositAmount: vi.fn(),
    finalizeDepositPayment: vi.fn(),
    deleteDeposit: vi.fn(),
    describeBlockedDeposit: actual.describeBlockedDeposit,
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { hireNightWarning } from '@/services/private-bookings/night-clashes'
import { PrivateBookingService, updateBalancePayment, deleteBalancePayment, updateDeposit, updateDepositAmount, deleteDeposit } from '@/services/private-bookings'

import {
  createPrivateBooking,
  updatePrivateBooking,
  updateBookingStatus,
  deletePrivateBooking,
  cancelPrivateBooking,
  recordDepositPayment,
  recordFinalPayment,
  addPrivateBookingNote,
  getPrivateBookings,
  getPrivateBooking,
  extendBookingHold,
  applyBookingDiscount,
  addBookingItem,
  updateBookingItem,
  deleteBookingItem,
  getBookingPortalLink,
  revokeBookingPortalLinks,
  editPrivateBookingPayment,
  deletePrivateBookingPayment,
} from '@/app/actions/privateBookingActions'

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock
const mockedHireNightWarning = hireNightWarning as unknown as Mock
const mockedCreateBooking = PrivateBookingService.createBooking as unknown as Mock
const mockedUpdateBooking = PrivateBookingService.updateBooking as unknown as Mock
const mockedUpdateBookingStatus = PrivateBookingService.updateBookingStatus as unknown as Mock
const mockedDeletePrivateBooking = PrivateBookingService.deletePrivateBooking as unknown as Mock
const mockedCancelBooking = PrivateBookingService.cancelBooking as unknown as Mock
const mockedRecordDeposit = PrivateBookingService.recordDeposit as unknown as Mock
const mockedRecordBalancePayment = PrivateBookingService.recordBalancePayment as unknown as Mock
const mockedAddNote = PrivateBookingService.addNote as unknown as Mock
const mockedGetBookings = PrivateBookingService.getBookings as unknown as Mock
const mockedGetBookingById = PrivateBookingService.getBookingById as unknown as Mock
const mockedExtendHold = PrivateBookingService.extendHold as unknown as Mock
const mockedApplyDiscount = PrivateBookingService.applyBookingDiscount as unknown as Mock
const mockedAddItem = PrivateBookingService.addBookingItem as unknown as Mock
const mockedUpdateItem = PrivateBookingService.updateBookingItem as unknown as Mock
const mockedDeleteItem = PrivateBookingService.deleteBookingItem as unknown as Mock
const mockedUpdateBalancePayment = updateBalancePayment as unknown as Mock
const mockedDeleteBalancePayment = deleteBalancePayment as unknown as Mock
const mockedUpdateDeposit = updateDeposit as unknown as Mock
const mockedUpdateDepositAmount = updateDepositAmount as unknown as Mock
const mockedDeleteDeposit = deleteDeposit as unknown as Mock

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USER = { id: 'user-1', email: 'staff@example.com' }

function mockAuthenticatedClient() {
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: MOCK_USER },
        error: null,
      }),
    },
  })
}

function mockUnauthenticatedClient() {
  mockedCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: null,
      }),
    },
  })
}

/**
 * Builds a minimal FormData for booking creation.
 *
 * `contact_phone` is part of the minimum since 2026-08-20, when createPrivateBooking began
 * requiring either an existing customer_id or a phone number. A private booking with no way
 * to reach the organiser is not a booking anyone can run, so the guard is right and the
 * fixture was simply older than it.
 */
function buildCreateFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('customer_first_name', 'Jane')
  fd.set('contact_phone', '07700900000')
  fd.set('event_date', '2026-06-15')
  fd.set('start_time', '18:00')
  fd.set('guest_count', '12')
  fd.set('event_type', 'Birthday Party')
  for (const [k, v] of Object.entries(overrides)) {
    fd.set(k, v)
  }
  return fd
}

/** Builds a FormData for deposit recording */
function buildDepositFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('payment_method', 'card')
  fd.set('amount', '100')
  for (const [k, v] of Object.entries(overrides)) {
    fd.set(k, v)
  }
  return fd
}

/** Builds a FormData for balance payment recording */
function buildBalanceFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('payment_method', 'card')
  fd.set('amount', '250')
  for (const [k, v] of Object.entries(overrides)) {
    fd.set(k, v)
  }
  return fd
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('privateBookingActions', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedLogAuditEvent.mockResolvedValue(undefined)
    mockAuthenticatedClient()
  })

  // BK-204: a leaked link can be switched off on its own.
  describe('revokeBookingPortalLinks', () => {
    const BOOKING_UUID = '7f3a2c10-4b5d-4e6f-8a9b-0c1d2e3f4a5b'

    function adminWith(updated: Record<string, unknown> | null) {
      const writes: Array<{ table: string; op: string; payload: unknown }> = []
      mockedCreateAdminClient.mockReturnValue({
        from: (table: string) => ({
          update: (payload: unknown) => {
            writes.push({ table, op: 'update', payload })
            return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: updated, error: null }) }) }) }
          },
          insert: async (payload: unknown) => {
            writes.push({ table, op: 'insert', payload })
            return { error: null }
          },
        }),
      } as never)
      return writes
    }

    it('switches the old links off, audits it, and hands back a new short link', async () => {
      const writes = adminWith({ id: BOOKING_UUID, customer_id: 'customer-1', event_date: '2026-12-05', date_tbd: false })

      const result = await revokeBookingPortalLinks(BOOKING_UUID)

      expect(result).toEqual({ success: true, url: `https://l.the-anchor.pub/short-${BOOKING_UUID}` })
      expect(writes[0]).toMatchObject({ table: 'private_bookings', op: 'update', payload: { portal_links_revoked_at: expect.any(String) } })
      expect(writes[1]).toMatchObject({
        table: 'private_booking_audit',
        op: 'insert',
        payload: { booking_id: BOOKING_UUID, action: 'portal_links_revoked' },
      })
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        additional_info: expect.objectContaining({ action: 'portal_links_revoked' }),
      }))
    })

    it('needs edit or manage permission', async () => {
      mockedPermission.mockResolvedValue(false)
      const writes = adminWith({ id: BOOKING_UUID })
      expect(await revokeBookingPortalLinks(BOOKING_UUID)).toEqual({ error: 'Insufficient permissions' })
      expect(writes).toHaveLength(0)
    })

    it('says so for a booking that does not exist', async () => {
      adminWith(null)
      expect(await revokeBookingPortalLinks(BOOKING_UUID)).toEqual({ error: 'Booking not found' })
    })
  })

  describe('getBookingPortalLink', () => {
    it('returns the stable customer portal link for staff who manage deposits', async () => {
      mockedPermission.mockImplementation((_module: string, action: string) =>
        Promise.resolve(action === 'manage_deposits')
      )

      mockedCreateAdminClient.mockReturnValue({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'booking-1', customer_id: 'customer-1', event_date: '2026-12-05', date_tbd: false },
                error: null,
              }),
            }),
          }),
        }),
      } as never)

      const result = await getBookingPortalLink('booking-1')

      // Short (BK-172).
      expect(result).toEqual({
        success: true,
        url: 'https://l.the-anchor.pub/short-booking-1',
      })
      expect(mockedPermission).toHaveBeenCalledWith('private_bookings', 'manage_deposits')
    })
  })

  // -------------------------------------------------------------------------
  // createPrivateBooking
  // -------------------------------------------------------------------------
  describe('createPrivateBooking', () => {
    it('should create a booking and audit-log on success', async () => {
      const mockBooking = { id: 'booking-1', customer_first_name: 'Jane' }
      mockedCreateBooking.mockResolvedValue(mockBooking)

      const result = await createPrivateBooking(buildCreateFormData())

      expect(result).toEqual({ success: true, data: mockBooking })
      expect(mockedCreateBooking).toHaveBeenCalledTimes(1)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'create',
          resource_type: 'private_booking',
          resource_id: 'booking-1',
        })
      )
    })

    it('refuses a booking with neither a customer nor a phone number', async () => {
      // A private booking nobody can be reached about is not a booking anyone can run:
      // no deposit chase, no final numbers, no way to tell the organiser about a change.
      const fd = buildCreateFormData()
      fd.delete('contact_phone')

      const result = await createPrivateBooking(fd)

      expect(result).toEqual({ error: 'Select an existing customer or enter a phone number' })
      expect(mockedCreateBooking).not.toHaveBeenCalled()
    })

    it('accepts an existing customer with no phone number typed in', async () => {
      // The other half of the rule. Picking a known customer already supplies the contact
      // details, so demanding the phone again would block the commonest path through the form.
      const mockBooking = { id: 'booking-2', customer_first_name: 'Jane' }
      mockedCreateBooking.mockResolvedValue(mockBooking)

      const fd = buildCreateFormData()
      fd.delete('contact_phone')
      fd.set('customer_id', '11111111-2222-3333-4444-555555555555')

      const result = await createPrivateBooking(fd)

      expect(result).toEqual({ success: true, data: mockBooking })
      expect(mockedCreateBooking).toHaveBeenCalledTimes(1)
    })

    it('should return error when user lacks create permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await createPrivateBooking(buildCreateFormData())

      expect(result).toEqual({ error: 'You do not have permission to create private bookings' })
      expect(mockedCreateBooking).not.toHaveBeenCalled()
    })

    it('should return validation error when first name is missing', async () => {
      const fd = buildCreateFormData()
      fd.set('customer_first_name', '')

      const result = await createPrivateBooking(fd)

      expect(result).toHaveProperty('error')
      expect(mockedCreateBooking).not.toHaveBeenCalled()
    })

    it('should propagate service errors gracefully', async () => {
      mockedCreateBooking.mockRejectedValue(new Error('DB connection lost'))

      const result = await createPrivateBooking(buildCreateFormData())

      expect(result).toEqual({ error: 'DB connection lost' })
    })

    it('should pass date_tbd flag through to the service', async () => {
      const mockBooking = { id: 'booking-2' }
      mockedCreateBooking.mockResolvedValue(mockBooking)

      const fd = buildCreateFormData()
      fd.set('date_tbd', 'true')

      await createPrivateBooking(fd)

      expect(mockedCreateBooking).toHaveBeenCalledWith(
        expect.objectContaining({ date_tbd: true })
      )
    })

    it('should pass deposit_amount when guest count is 7+', async () => {
      const mockBooking = { id: 'booking-3' }
      mockedCreateBooking.mockResolvedValue(mockBooking)

      const fd = buildCreateFormData({ guest_count: '10', deposit_amount: '100' })

      await createPrivateBooking(fd)

      expect(mockedCreateBooking).toHaveBeenCalledWith(
        expect.objectContaining({ deposit_amount: 100, guest_count: 10 })
      )
    })
  })

  // -------------------------------------------------------------------------
  // updatePrivateBooking
  // -------------------------------------------------------------------------
  describe('updatePrivateBooking', () => {
    it('should update a booking and audit-log on success', async () => {
      const mockBooking = { id: 'booking-1' }
      mockedUpdateBooking.mockResolvedValue(mockBooking)

      const result = await updatePrivateBooking('booking-1', buildCreateFormData())

      expect(result).toEqual({ success: true, data: mockBooking })
      expect(mockedUpdateBooking).toHaveBeenCalledTimes(1)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'update',
          resource_type: 'private_booking',
          resource_id: 'booking-1',
        })
      )
    })

    // Owner decision D24: a clash with diners, event seats or events is warned about, not refused.
    it('saves and returns the warning when the hire clashes with diners that night', async () => {
      mockedUpdateBooking.mockResolvedValue({ id: 'booking-1' })
      mockedHireNightWarning.mockResolvedValueOnce("This hire's rooms already have 1 table booking (4 guests) that night.")

      const result = await updatePrivateBooking('booking-1', buildCreateFormData())

      expect(result).toEqual({
        success: true,
        data: { id: 'booking-1' },
        warning: "This hire's rooms already have 1 table booking (4 guests) that night.",
      })
      expect(mockedHireNightWarning).toHaveBeenCalledWith('booking-1')
    })

    it('passes editable financial fields and structured dispute flag', async () => {
      const mockBooking = { id: 'booking-1' }
      mockedUpdateBooking.mockResolvedValue(mockBooking)

      const formData = buildCreateFormData({
        deposit_amount: '175.50',
        balance_due_date: '2026-06-01',
        has_open_dispute: 'true',
      })

      await updatePrivateBooking('booking-1', formData)

      expect(mockedUpdateBooking).toHaveBeenCalledWith(
        'booking-1',
        expect.objectContaining({
          deposit_amount: 175.5,
          balance_due_date: '2026-06-01',
          has_open_dispute: true,
        }),
        'user-1',
      )
    })

    it('should return error when user lacks edit permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await updatePrivateBooking('booking-1', buildCreateFormData())

      expect(result).toEqual({ error: 'You do not have permission to update private bookings' })
      expect(mockedUpdateBooking).not.toHaveBeenCalled()
    })

    it('should return error when user is not authenticated', async () => {
      mockUnauthenticatedClient()

      const result = await updatePrivateBooking('booking-1', buildCreateFormData())

      expect(result).toEqual({ error: 'Not authenticated' })
      expect(mockedUpdateBooking).not.toHaveBeenCalled()
    })

    it('should propagate service errors gracefully', async () => {
      mockedUpdateBooking.mockRejectedValue(new Error('Conflict'))

      const result = await updatePrivateBooking('booking-1', buildCreateFormData())

      expect(result).toEqual({ error: 'Conflict' })
    })

    it('should succeed even if audit logging fails (non-blocking audit)', async () => {
      mockedUpdateBooking.mockResolvedValue({ id: 'booking-1' })
      mockedLogAuditEvent.mockRejectedValue(new Error('audit write failed'))

      const result = await updatePrivateBooking('booking-1', buildCreateFormData())

      expect(result).toEqual({ success: true, data: { id: 'booking-1' } })
    })
  })

  // -------------------------------------------------------------------------
  // updateBookingStatus
  // -------------------------------------------------------------------------
  describe('updateBookingStatus', () => {
    it('should update status and return success', async () => {
      mockedUpdateBookingStatus.mockResolvedValue(undefined)

      const result = await updateBookingStatus('booking-1', 'confirmed')

      expect(result).toEqual({ success: true })
      expect(mockedUpdateBookingStatus).toHaveBeenCalledWith('booking-1', 'confirmed', 'user-1')
    })

    it('warns about diners in the rooms when confirming or reinstating, and only then (BK-070)', async () => {
      mockedUpdateBookingStatus.mockResolvedValue(undefined)
      mockedHireNightWarning.mockResolvedValue('This hire takes the whole pub, so ticket sales have stopped for Quiz Night.')

      expect(await updateBookingStatus('booking-1', 'confirmed')).toEqual({
        success: true,
        warning: 'This hire takes the whole pub, so ticket sales have stopped for Quiz Night.',
      })
      expect(await updateBookingStatus('booking-1', 'draft')).toMatchObject({ success: true, warning: expect.any(String) })

      mockedHireNightWarning.mockClear()
      expect(await updateBookingStatus('booking-1', 'completed')).toEqual({ success: true })
      expect(mockedHireNightWarning).not.toHaveBeenCalled()
      mockedHireNightWarning.mockResolvedValue(null)
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await updateBookingStatus('booking-1', 'confirmed')

      expect(result).toEqual({ error: 'You do not have permission to update private bookings' })
    })

    it('should return error when not authenticated', async () => {
      mockUnauthenticatedClient()

      const result = await updateBookingStatus('booking-1', 'confirmed')

      expect(result).toEqual({ error: 'Not authenticated' })
    })

    it('should handle service error', async () => {
      mockedUpdateBookingStatus.mockRejectedValue(new Error('Invalid status transition'))

      const result = await updateBookingStatus('booking-1', 'completed')

      expect(result).toEqual({ error: 'Invalid status transition' })
    })
  })

  // -------------------------------------------------------------------------
  // deletePrivateBooking
  // -------------------------------------------------------------------------
  describe('deletePrivateBooking', () => {
    it('should delete a booking and audit-log on success', async () => {
      mockedDeletePrivateBooking.mockResolvedValue(undefined)

      const result = await deletePrivateBooking('booking-1')

      expect(result).toEqual({ success: true })
      expect(mockedDeletePrivateBooking).toHaveBeenCalledWith('booking-1')
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'delete',
          resource_type: 'private_booking',
          resource_id: 'booking-1',
        })
      )
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await deletePrivateBooking('booking-1')

      expect(result).toEqual({ error: 'You do not have permission to delete private bookings' })
      expect(mockedDeletePrivateBooking).not.toHaveBeenCalled()
    })

    it('should return error when audit logging fails (audit is inside try/catch)', async () => {
      mockedDeletePrivateBooking.mockResolvedValue(undefined)
      mockedLogAuditEvent.mockRejectedValueOnce(new Error('audit write failed'))

      const result = await deletePrivateBooking('booking-1')

      // Note: unlike updatePrivateBooking, deletePrivateBooking does NOT have
      // a separate inner try/catch for audit — audit failure propagates to the
      // outer catch block and returns an error.
      expect(result).toEqual({ error: 'audit write failed' })
    })

    it('should handle service error', async () => {
      mockedDeletePrivateBooking.mockRejectedValue(new Error('FK constraint'))

      const result = await deletePrivateBooking('booking-1')

      expect(result).toEqual({ error: 'FK constraint' })
    })
  })

  // -------------------------------------------------------------------------
  // cancelPrivateBooking
  // -------------------------------------------------------------------------
  describe('cancelPrivateBooking', () => {
    it('should cancel a booking with reason', async () => {
      const expectedResult = { success: true }
      mockedCancelBooking.mockResolvedValue(expectedResult)

      const result = await cancelPrivateBooking('booking-1', 'Customer changed plans')

      expect(result).toEqual(expectedResult)
      expect(mockedCancelBooking).toHaveBeenCalledWith('booking-1', 'Customer changed plans', 'user-1', undefined)
    })

    it('should pass empty string when no reason given', async () => {
      mockedCancelBooking.mockResolvedValue({ success: true })

      await cancelPrivateBooking('booking-1')

      expect(mockedCancelBooking).toHaveBeenCalledWith('booking-1', '', 'user-1', undefined)
    })

    it('should pass a retention decision through to the service (SOP §14)', async () => {
      mockedCancelBooking.mockResolvedValue({ success: true })

      const retention = { retainedAmount: 100, reason: 'Supplier costs already incurred' }
      const result = await cancelPrivateBooking('booking-1', 'Customer cancelled', retention)

      expect(result).toEqual({ success: true })
      expect(mockedCancelBooking).toHaveBeenCalledWith(
        'booking-1',
        'Customer cancelled',
        'user-1',
        { retentionDecision: retention, capture: null, costsKept: null }
      )
    })

    it('should require GM override permission to retain more than £0 (SOP §14)', async () => {
      mockedPermission.mockImplementation((_module: string, action: string) =>
        Promise.resolve(action === 'edit')
      )

      const result = await cancelPrivateBooking('booking-1', 'Customer cancelled', {
        retainedAmount: 100,
        reason: 'Supplier costs',
      })

      expect(result).toEqual({ error: 'Retaining a deposit requires General Manager override permission' })
      expect(mockedCancelBooking).not.toHaveBeenCalled()
    })

    it('should not require GM override permission for a £0 retention decision', async () => {
      mockedPermission.mockImplementation((_module: string, action: string) =>
        Promise.resolve(action === 'edit')
      )
      mockedCancelBooking.mockResolvedValue({ success: true })

      const retention = { retainedAmount: 0, reason: 'Nothing to retain' }
      const result = await cancelPrivateBooking('booking-1', 'Customer cancelled', retention)

      expect(result).toEqual({ success: true })
      expect(mockedCancelBooking).toHaveBeenCalledWith(
        'booking-1',
        'Customer cancelled',
        'user-1',
        { retentionDecision: retention, capture: null, costsKept: null }
      )
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await cancelPrivateBooking('booking-1')

      expect(result).toEqual({ error: 'You do not have permission to cancel private bookings' })
      expect(mockedCancelBooking).not.toHaveBeenCalled()
    })

    it('should handle service error', async () => {
      mockedCancelBooking.mockRejectedValue(new Error('Cannot cancel completed booking'))

      const result = await cancelPrivateBooking('booking-1')

      expect(result).toEqual({ success: false, error: 'Cannot cancel completed booking' })
    })
  })

  // -------------------------------------------------------------------------
  // recordDepositPayment
  // -------------------------------------------------------------------------
  describe('recordDepositPayment', () => {
    it('should record a deposit payment and audit-log', async () => {
      const serviceResult = { success: true }
      mockedRecordDeposit.mockResolvedValue(serviceResult)

      const result = await recordDepositPayment('booking-1', buildDepositFormData())

      expect(result).toEqual(serviceResult)
      expect(mockedRecordDeposit).toHaveBeenCalledWith('booking-1', 100, 'card', 'user-1')
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'update',
          resource_type: 'private_booking',
          additional_info: expect.objectContaining({
            action: 'record_deposit_payment',
            amount: 100,
            payment_method: 'card',
          }),
        })
      )
    })

    // Review BK-005: the modal used to close as if all was well when the deposit was recorded but
    // the booking stayed a draft. The person recording it is now told why.
    it('tells the person recording the deposit when it did not confirm the booking, and why', async () => {
      mockedRecordDeposit.mockResolvedValue({
        success: true,
        confirmationBlocked: true,
        confirmationBlockedReasons: [
          'Guest count 70 exceeds the maximum capacity of 50 for The Dining Room. Add The Main Area so the guests fit, or ask a manager to allow it.',
        ],
      })

      const result = await recordDepositPayment('booking-1', buildDepositFormData())

      expect(result).toMatchObject({
        success: true,
        warning:
          'The deposit is recorded, but the booking is still a draft. Guest count 70 exceeds the maximum capacity of 50 for The Dining Room. Add The Main Area so the guests fit, or ask a manager to allow it.',
      })
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await recordDepositPayment('booking-1', buildDepositFormData())

      expect(result).toEqual({ error: 'You do not have permission to record deposits' })
    })

    it('should reject invalid deposit amount (zero)', async () => {
      const fd = buildDepositFormData({ amount: '0' })

      const result = await recordDepositPayment('booking-1', fd)

      expect(result).toEqual({ success: false, error: 'Invalid deposit amount' })
      expect(mockedRecordDeposit).not.toHaveBeenCalled()
    })

    it('should reject negative deposit amount', async () => {
      const fd = buildDepositFormData({ amount: '-50' })

      const result = await recordDepositPayment('booking-1', fd)

      expect(result).toEqual({ success: false, error: 'Invalid deposit amount' })
    })

    it('should reject invalid payment method', async () => {
      const fd = buildDepositFormData({ payment_method: 'bitcoin' })

      const result = await recordDepositPayment('booking-1', fd)

      expect(result).toEqual({ success: false, error: 'Invalid payment method' })
    })

    it('should succeed even if audit logging fails (non-blocking audit)', async () => {
      mockedRecordDeposit.mockResolvedValue({ success: true })
      mockedLogAuditEvent.mockRejectedValueOnce(new Error('audit down'))

      const result = await recordDepositPayment('booking-1', buildDepositFormData())

      expect(result).toEqual({ success: true })
    })

    it('should handle service error', async () => {
      mockedRecordDeposit.mockRejectedValue(new Error('Deposit already paid'))

      const result = await recordDepositPayment('booking-1', buildDepositFormData())

      expect(result).toEqual({ success: false, error: 'Deposit already paid' })
    })
  })

  // -------------------------------------------------------------------------
  // recordFinalPayment (balance payment)
  // -------------------------------------------------------------------------
  describe('recordFinalPayment', () => {
    it('should record a balance payment and audit-log', async () => {
      const serviceResult = { success: true }
      mockedRecordBalancePayment.mockResolvedValue(serviceResult)

      const result = await recordFinalPayment('booking-1', buildBalanceFormData())

      expect(result).toEqual(serviceResult)
      expect(mockedRecordBalancePayment).toHaveBeenCalledWith('booking-1', 250, 'card', 'user-1')
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          additional_info: expect.objectContaining({
            action: 'record_final_payment',
            amount: 250,
          }),
        })
      )
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await recordFinalPayment('booking-1', buildBalanceFormData())

      expect(result).toEqual({ error: 'You do not have permission to record payments' })
    })

    it('should reject zero amount', async () => {
      const fd = buildBalanceFormData({ amount: '0' })

      const result = await recordFinalPayment('booking-1', fd)

      expect(result).toEqual({ success: false, error: 'Invalid payment amount' })
    })

    it('should reject invalid payment method', async () => {
      const fd = buildBalanceFormData({ payment_method: 'cheque' })

      const result = await recordFinalPayment('booking-1', fd)

      expect(result).toEqual({ success: false, error: 'Invalid payment method' })
    })

    it('should handle service error', async () => {
      mockedRecordBalancePayment.mockRejectedValue(new Error('Balance exceeds total'))

      const result = await recordFinalPayment('booking-1', buildBalanceFormData())

      expect(result).toEqual({ success: false, error: 'Balance exceeds total' })
    })
  })

  // -------------------------------------------------------------------------
  // addPrivateBookingNote
  // -------------------------------------------------------------------------
  describe('addPrivateBookingNote', () => {
    it('should add a note on success', async () => {
      mockedAddNote.mockResolvedValue(undefined)

      const result = await addPrivateBookingNote('booking-1', 'Customer called to confirm dietary needs')

      expect(result).toEqual({ success: true })
      expect(mockedAddNote).toHaveBeenCalledWith(
        'booking-1',
        'Customer called to confirm dietary needs',
        'user-1',
        'staff@example.com'
      )
    })

    it('should return error when not authenticated', async () => {
      mockUnauthenticatedClient()

      const result = await addPrivateBookingNote('booking-1', 'A note')

      expect(result).toEqual({ error: 'You must be signed in to add a note' })
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await addPrivateBookingNote('booking-1', 'A note')

      // The function checks auth first, then permission
      expect(result).toEqual({ error: 'You do not have permission to add notes to private bookings' })
    })

    it('should return validation error for empty note', async () => {
      const result = await addPrivateBookingNote('booking-1', '')

      expect(result).toHaveProperty('error')
      expect(mockedAddNote).not.toHaveBeenCalled()
    })

    it('should handle service error', async () => {
      mockedAddNote.mockRejectedValue(new Error('DB error'))

      const result = await addPrivateBookingNote('booking-1', 'Valid note text')

      expect(result).toEqual({ error: 'DB error' })
    })
  })

  // -------------------------------------------------------------------------
  // getPrivateBookings
  // -------------------------------------------------------------------------
  describe('getPrivateBookings', () => {
    it('should return bookings data on success', async () => {
      const mockData = [{ id: 'b1' }, { id: 'b2' }]
      mockedGetBookings.mockResolvedValue({ data: mockData })

      const result = await getPrivateBookings()

      expect(result).toEqual({ data: mockData })
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await getPrivateBookings()

      expect(result).toEqual({ error: 'You do not have permission to view private bookings' })
    })

    it('should pass filters through to service', async () => {
      mockedGetBookings.mockResolvedValue({ data: [] })

      await getPrivateBookings({ status: 'confirmed', fromDate: '2026-01-01' })

      expect(mockedGetBookings).toHaveBeenCalledWith({ status: 'confirmed', fromDate: '2026-01-01' })
    })

    it('should handle service error', async () => {
      mockedGetBookings.mockRejectedValue(new Error('Timeout'))

      const result = await getPrivateBookings()

      expect(result).toEqual({ error: 'Timeout' })
    })
  })

  // -------------------------------------------------------------------------
  // getPrivateBooking
  // -------------------------------------------------------------------------
  describe('getPrivateBooking', () => {
    it('should return single booking data on success', async () => {
      const mockData = { id: 'b1', customer_first_name: 'Jane' }
      mockedGetBookingById.mockResolvedValue(mockData)

      const result = await getPrivateBooking('b1')

      expect(result).toEqual({ data: mockData })
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await getPrivateBooking('b1')

      expect(result).toEqual({ error: 'You do not have permission to view private bookings' })
    })
  })

  // -------------------------------------------------------------------------
  // extendBookingHold
  // -------------------------------------------------------------------------
  describe('extendBookingHold', () => {
    it('should extend hold and audit-log on success', async () => {
      mockedExtendHold.mockResolvedValue({ success: true })

      const result = await extendBookingHold('booking-1', 14, 'Customer finalising numbers')

      expect(result).toEqual({ success: true })
      expect(mockedExtendHold).toHaveBeenCalledWith('booking-1', 14, 'user-1', 'Customer finalising numbers')
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          additional_info: expect.objectContaining({
            action: 'extend_booking_hold',
            days: 14,
            reason: 'Customer finalising numbers',
          }),
        })
      )
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await extendBookingHold('booking-1', 7, 'Customer finalising numbers')

      expect(result).toEqual({ error: 'You do not have permission to extend booking holds' })
    })

    it('should require a reason (SOP §10)', async () => {
      const result = await extendBookingHold('booking-1', 7)

      expect(result).toEqual({ error: 'Please record a reason for extending the hold' })
      expect(mockedExtendHold).not.toHaveBeenCalled()
    })

    it('should reject a whitespace-only reason', async () => {
      const result = await extendBookingHold('booking-1', 7, '   ')

      expect(result).toEqual({ error: 'Please record a reason for extending the hold' })
      expect(mockedExtendHold).not.toHaveBeenCalled()
    })

    it('should handle service error', async () => {
      mockedExtendHold.mockRejectedValue(new Error('Hold already expired'))

      const result = await extendBookingHold('booking-1', 30, 'Customer finalising numbers')

      expect(result).toEqual({ error: 'Hold already expired' })
    })
  })

  // -------------------------------------------------------------------------
  // applyBookingDiscount
  // -------------------------------------------------------------------------
  describe('applyBookingDiscount', () => {
    it('should apply discount and audit-log on success', async () => {
      mockedApplyDiscount.mockResolvedValue({ success: true })

      const discountData = {
        discount_type: 'percent' as const,
        discount_amount: 10,
        discount_reason: 'Loyalty discount',
      }

      const result = await applyBookingDiscount('booking-1', discountData)

      expect(result).toEqual({ success: true })
      expect(mockedApplyDiscount).toHaveBeenCalledWith('booking-1', discountData)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          additional_info: expect.objectContaining({
            action: 'apply_booking_discount',
            discount_type: 'percent',
            discount_amount: 10,
          }),
        })
      )
    })

    it('should return error when permission denied', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await applyBookingDiscount('booking-1', {
        discount_type: 'fixed',
        discount_amount: 50,
        discount_reason: 'Test',
      })

      expect(result).toEqual({ error: 'You do not have permission to update private bookings' })
    })

    it('should handle service error', async () => {
      mockedApplyDiscount.mockRejectedValue(new Error('Invalid discount'))

      const result = await applyBookingDiscount('booking-1', {
        discount_type: 'percent',
        discount_amount: 150,
        discount_reason: 'Too much',
      })

      expect(result).toEqual({ error: 'Invalid discount' })
    })
  })

  // -------------------------------------------------------------------------
  // editPrivateBookingPayment
  // -------------------------------------------------------------------------
  describe('editPrivateBookingPayment', () => {
    it('should edit a balance payment successfully', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { amount: 100, method: 'cash' }, error: null }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateBalancePayment.mockResolvedValue(undefined)

      const fd = new FormData()
      fd.set('paymentId', '550e8400-e29b-41d4-a716-446655440000')
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'balance')
      fd.set('amount', '150')
      fd.set('method', 'card')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedUpdateBalancePayment).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        '660e8400-e29b-41d4-a716-446655440000',
        { amount: 150, method: 'card', notes: undefined }
      )
    })

    it('should edit a deposit payment successfully', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { deposit_amount: 80, deposit_payment_method: 'cash', deposit_paid_date: '2026-03-15T00:00:00Z' }, error: null }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDeposit.mockResolvedValue(undefined)

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '120')
      fd.set('method', 'card')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedUpdateDeposit).toHaveBeenCalledWith(
        '660e8400-e29b-41d4-a716-446655440000',
        { amount: 120, method: 'card' }
      )
    })

    it('should return Unauthorized when not authenticated', async () => {
      mockUnauthenticatedClient()

      const fd = new FormData()
      fd.set('type', 'balance')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ error: 'Unauthorized' })
    })

    it('should return Forbidden when lacking manage permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const fd = new FormData()
      fd.set('type', 'balance')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ error: 'Forbidden' })
    })

    it('should return error for invalid payment type', async () => {
      const fd = new FormData()
      fd.set('type', 'refund')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ error: 'Invalid payment type' })
    })

    it('should return validation error for zero amount on balance edit', async () => {
      const fd = new FormData()
      fd.set('paymentId', '550e8400-e29b-41d4-a716-446655440000')
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'balance')
      fd.set('amount', '0')
      fd.set('method', 'card')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toHaveProperty('error')
      expect(mockedUpdateBalancePayment).not.toHaveBeenCalled()
    })

    it('should return service error when updateBalancePayment fails', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { amount: 100, method: 'cash' }, error: null }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateBalancePayment.mockRejectedValue(new Error('Row not found'))

      const fd = new FormData()
      fd.set('paymentId', '550e8400-e29b-41d4-a716-446655440000')
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'balance')
      fd.set('amount', '150')
      fd.set('method', 'card')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ error: 'Row not found' })
    })

    it('should use updateDepositAmount for unpaid deposit (no method pollution)', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 250, deposit_payment_method: null, deposit_paid_date: null },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDepositAmount.mockResolvedValue({})

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '150')
      fd.set('method', 'cash')
      fd.set('reduction_reason', 'GM agreed reduced deposit for repeat customer')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedUpdateDepositAmount).toHaveBeenCalledWith(
        '660e8400-e29b-41d4-a716-446655440000',
        150,
        'user-1',
        {
          reductionReason: 'GM agreed reduced deposit for repeat customer',
          waived: false,
          waivedReason: undefined,
        }
      )
      expect(mockedUpdateDeposit).not.toHaveBeenCalled()
    })

    it('should allow setting an unpaid deposit to zero', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 250, deposit_payment_method: null, deposit_paid_date: null },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDepositAmount.mockResolvedValue({})

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '0')
      fd.set('method', 'cash')
      fd.set('waived', 'true')
      fd.set('waived_reason', 'Venue-hosted charity event — GM waiver')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedUpdateDepositAmount).toHaveBeenCalledWith(
        '660e8400-e29b-41d4-a716-446655440000',
        0,
        'user-1',
        {
          reductionReason: undefined,
          waived: true,
          waivedReason: 'Venue-hosted charity event — GM waiver',
        }
      )
      expect(mockedUpdateDeposit).not.toHaveBeenCalled()
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          additional_info: expect.objectContaining({
            no_deposit_required: true,
            deposit_waived: true,
            waived_reason: 'Venue-hosted charity event — GM waiver',
          }),
        })
      )
    })

    it('should use updateDeposit for paid deposit (preserves existing behaviour)', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 250, deposit_payment_method: 'cash', deposit_paid_date: '2026-04-01T00:00:00Z' },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDeposit.mockResolvedValue(undefined)

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '300')
      fd.set('method', 'card')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedUpdateDeposit).toHaveBeenCalledWith(
        '660e8400-e29b-41d4-a716-446655440000',
        { amount: 300, method: 'card' }
      )
      expect(mockedUpdateDepositAmount).not.toHaveBeenCalled()
    })

    it('should allow manage_deposits permission for deposit edits', async () => {
      mockedPermission
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 250, deposit_payment_method: null, deposit_paid_date: null },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedUpdateDepositAmount.mockResolvedValue({})

      const fd = new FormData()
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'deposit')
      fd.set('amount', '200')
      fd.set('method', 'cash')

      const result = await editPrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedPermission).toHaveBeenCalledWith('private_bookings', 'manage', expect.any(String))
      expect(mockedPermission).toHaveBeenCalledWith('private_bookings', 'manage_deposits', expect.any(String))
    })
  })

  // -------------------------------------------------------------------------
  // deletePrivateBookingPayment
  // -------------------------------------------------------------------------
  describe('deletePrivateBookingPayment', () => {
    it('should delete a balance payment successfully', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { amount: 200, method: 'card' }, error: null }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedDeleteBalancePayment.mockResolvedValue(undefined)

      const fd = new FormData()
      fd.set('paymentId', '550e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'balance')
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')

      const result = await deletePrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedDeleteBalancePayment).toHaveBeenCalledWith(
        '550e8400-e29b-41d4-a716-446655440000',
        '660e8400-e29b-41d4-a716-446655440000'
      )
    })

    it('should delete a deposit and track status reversion', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { deposit_amount: 100, deposit_payment_method: 'card', status: 'confirmed' },
                error: null,
              }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedDeleteDeposit.mockResolvedValue({ statusReverted: true })

      const fd = new FormData()
      fd.set('paymentId', 'deposit')
      fd.set('type', 'deposit')
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')

      const result = await deletePrivateBookingPayment(fd)

      expect(result).toEqual({ success: true })
      expect(mockedDeleteDeposit).toHaveBeenCalledWith('660e8400-e29b-41d4-a716-446655440000')
    })

    it('should return Unauthorized when not authenticated', async () => {
      mockUnauthenticatedClient()

      const fd = new FormData()
      fd.set('paymentId', 'any')
      fd.set('type', 'balance')
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')

      const result = await deletePrivateBookingPayment(fd)

      expect(result).toEqual({ error: 'Unauthorized' })
    })

    it('should return Forbidden when lacking manage permission', async () => {
      mockedPermission.mockResolvedValue(false)

      const fd = new FormData()
      fd.set('paymentId', 'any')
      fd.set('type', 'balance')
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')

      const result = await deletePrivateBookingPayment(fd)

      expect(result).toEqual({ error: 'Forbidden' })
    })

    it('should return error when deleteBalancePayment service fails', async () => {
      const adminClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { amount: 200, method: 'card' }, error: null }),
            }),
          }),
        }),
      }
      mockedCreateAdminClient.mockReturnValue(adminClient)
      mockedDeleteBalancePayment.mockRejectedValue(new Error('Cannot delete captured payment'))

      const fd = new FormData()
      fd.set('paymentId', '550e8400-e29b-41d4-a716-446655440000')
      fd.set('type', 'balance')
      fd.set('bookingId', '660e8400-e29b-41d4-a716-446655440000')

      const result = await deletePrivateBookingPayment(fd)

      expect(result).toEqual({ error: 'Cannot delete captured payment' })
    })

    it('should return validation error for invalid bookingId format', async () => {
      const fd = new FormData()
      fd.set('paymentId', 'any')
      fd.set('type', 'balance')
      fd.set('bookingId', 'not-a-uuid')

      const result = await deletePrivateBookingPayment(fd)

      expect(result).toHaveProperty('error')
      expect(mockedDeleteBalancePayment).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Balance status warning: the change saved, but apply_balance_payment_status
  // failed, so the action passes the service's warning through as a success.
  // -------------------------------------------------------------------------
  describe('balance status warning after a total change', () => {
    const WARNING =
      "The item was saved, but the booking's balance status did not update, so it may show the wrong amount still owed or the wrong paid-in-full status. Do not make the change again: tell the developer."

    it('applyBookingDiscount passes the warning through with success', async () => {
      mockedApplyDiscount.mockResolvedValue({ success: true, warning: WARNING })

      const result = await applyBookingDiscount('booking-1', {
        discount_type: 'percent',
        discount_amount: 10,
        discount_reason: 'Loyalty',
      })

      expect(result).toEqual({ success: true, warning: WARNING })
    })

    it('addBookingItem passes the warning through with success, and plain success without one', async () => {
      const item = {
        booking_id: 'booking-1',
        item_type: 'other' as const,
        description: 'Cake table',
        quantity: 1,
        unit_price: 40,
      }
      mockedAddItem.mockResolvedValue({ success: true, warning: WARNING })
      await expect(addBookingItem(item)).resolves.toEqual({ success: true, warning: WARNING })

      mockedAddItem.mockResolvedValue({ success: true })
      await expect(addBookingItem(item)).resolves.toEqual({ success: true })
    })

    it('updateBookingItem passes the warning through with success, and plain success without one', async () => {
      mockedUpdateItem.mockResolvedValue({ success: true, bookingId: 'booking-1', warning: WARNING })
      await expect(updateBookingItem('item-1', { quantity: 3 })).resolves.toEqual({ success: true, warning: WARNING })

      mockedUpdateItem.mockResolvedValue({ success: true, bookingId: 'booking-1' })
      await expect(updateBookingItem('item-1', { quantity: 3 })).resolves.toEqual({ success: true })
    })

    it('deleteBookingItem passes the warning through with success, and plain success without one', async () => {
      mockedDeleteItem.mockResolvedValue({ success: true, bookingId: 'booking-1', warning: WARNING })
      await expect(deleteBookingItem('item-1')).resolves.toEqual({ success: true, warning: WARNING })

      mockedDeleteItem.mockResolvedValue({ success: true, bookingId: 'booking-1' })
      await expect(deleteBookingItem('item-1')).resolves.toEqual({ success: true })
    })
  })
})
