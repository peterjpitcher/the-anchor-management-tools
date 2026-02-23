import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

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

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SmsQueueService } from '@/services/sms-queue'
import { PrivateBookingService } from '@/services/private-bookings'
import { ensureCustomerForPhone } from '@/lib/sms/customers'

const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedEnsureCustomerForPhone = ensureCustomerForPhone as unknown as Mock

describe('PrivateBookingService mutation row-effect guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedEnsureCustomerForPhone.mockResolvedValue({
      customerId: 'customer-1',
      resolutionError: undefined,
    })
  })

  it('createBooking fails closed when customer cannot be resolved', async () => {
    const rpc = vi.fn()

    mockedCreateClient.mockResolvedValue({
      rpc,
    })

    await expect(
      PrivateBookingService.createBooking({
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        event_date: '2026-03-10',
        start_time: '18:00',
        guest_count: 40,
        event_type: 'party',
        source: 'manual',
      })
    ).rejects.toThrow('Private booking must include a linked customer (customer_id or contact_phone)')

    expect(rpc).not.toHaveBeenCalled()
  })

  it('createBooking accepts non-UK international numbers', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        customer_id: 'customer-1',
      },
      error: null,
    })

    mockedCreateClient.mockResolvedValue({
      rpc,
    })

    const result = await PrivateBookingService.createBooking({
      customer_first_name: 'Jean',
      customer_last_name: 'Dupont',
      contact_phone: '+33 6 12 34 56 78',
      default_country_code: '33',
      event_date: '2026-03-10',
      start_time: '18:00',
      guest_count: 40,
      event_type: 'party',
      source: 'manual',
    })

    expect(result).toMatchObject({
      id: 'booking-1',
    })
    expect(rpc).toHaveBeenCalledWith(
      'create_private_booking_transaction',
      expect.objectContaining({
        p_booking_data: expect.objectContaining({
          contact_phone: '+33612345678',
        }),
      }),
    )
  })

  it('updateBookingItem throws not-found when update affects no rows', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: { booking_id: 'booking-1' },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_items') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.updateBookingItem('item-1', { quantity: 4 })
    ).rejects.toThrow('Item not found')
  })

  it('deleteBookingItem throws not-found when delete affects no rows', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: { booking_id: 'booking-1' },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_items') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.deleteBookingItem('item-1')
    ).rejects.toThrow('Item not found')
  })

  it('applyBookingDiscount throws not-found when update affects no rows', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.applyBookingDiscount('booking-1', {
        discount_type: 'fixed',
        discount_amount: 50,
        discount_reason: 'Manager adjustment',
      })
    ).rejects.toThrow('Booking not found')
  })

  it('cancelBooking throws not-found when cancellation update affects no rows', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        status: 'confirmed',
        event_date: '2026-02-20',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        contact_phone: null,
        calendar_event_id: null,
        customer_id: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const cancelMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const cancelSelect = vi.fn().mockReturnValue({ maybeSingle: cancelMaybeSingle })
    const cancelEq = vi.fn().mockReturnValue({ select: cancelSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: cancelEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.cancelBooking('booking-1', 'Customer requested')
    ).rejects.toThrow('Booking not found')
  })

  it('expireBooking throws not-found when expiry update affects no rows', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        status: 'draft',
        event_date: '2026-02-20',
        customer_first_name: 'Alex',
        customer_name: 'Alex Smith',
        contact_phone: null,
        calendar_event_id: null,
        customer_id: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const expireMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const expireSelect = vi.fn().mockReturnValue({ maybeSingle: expireMaybeSingle })
    const expireEq = vi.fn().mockReturnValue({ select: expireSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: expireEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.expireBooking('booking-1', { sendNotification: false })
    ).rejects.toThrow('Booking not found')
  })

  it('updateBooking throws not-found when booking update affects no rows', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        status: 'draft',
        contact_phone: null,
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-03-10',
        start_time: '18:00',
        setup_date: null,
        setup_time: null,
        end_time: null,
        end_time_next_day: false,
        customer_id: null,
        internal_notes: null,
        balance_due_date: null,
        calendar_event_id: null,
        hold_expiry: null,
        deposit_paid_date: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.updateBooking('booking-1', {})
    ).rejects.toThrow('Booking not found')
  })

  it('recordDeposit throws not-found when booking update affects no rows', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-02-20',
        start_time: '18:00',
        end_time: '22:00',
        end_time_next_day: false,
        contact_phone: null,
        customer_id: null,
        calendar_event_id: null,
        status: 'draft',
        guest_count: 30,
        event_type: 'party',
        deposit_paid_date: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.recordDeposit('booking-1', 100, 'card')
    ).rejects.toThrow('Booking not found')
  })

  it('recordFinalPayment throws not-found when booking update affects no rows', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-02-20',
        start_time: '18:00',
        end_time: '22:00',
        end_time_next_day: false,
        contact_phone: null,
        customer_id: null,
        calendar_event_id: null,
        status: 'confirmed',
        guest_count: 30,
        event_type: 'party',
        deposit_paid_date: '2026-01-10T12:00:00.000Z',
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.recordFinalPayment('booking-1', 'bank_transfer')
    ).rejects.toThrow('Booking not found')
  })

  it('updateVenueSpace throws not-found when update affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'space-1',
        name: 'Main Hall',
        capacity_seated: 40,
        capacity_standing: 60,
        rate_per_hour: 100,
        description: null,
        active: true
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'venue_spaces') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.updateVenueSpace(
        'space-1',
        {
          name: 'Main Hall',
          capacity: 50,
          capacity_standing: 70,
          hire_cost: 120,
          description: 'Updated',
          is_active: true
        },
        'user-1',
        'ops@example.com'
      )
    ).rejects.toThrow('Venue space not found')
  })

  it('updateCateringPackage throws not-found when update affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'pkg-1',
        name: 'Buffet',
        package_type: 'food',
        cost_per_head: 25,
        pricing_model: 'per_head',
        minimum_guests: 10,
        description: null,
        dietary_notes: null,
        active: true
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'catering_packages') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.updateCateringPackage(
        'pkg-1',
        {
          name: 'Buffet',
          serving_style: 'buffet',
          category: 'food',
          per_head_cost: 30,
          pricing_model: 'per_head',
          minimum_order: 10,
          description: 'Updated',
          includes: 'Vegan options',
          is_active: true
        },
        'user-1',
        'ops@example.com'
      )
    ).rejects.toThrow('Catering package not found')
  })

  it('updateVendor throws not-found when update affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'vendor-1',
        name: 'DJ One',
        service_type: 'dj',
        contact_name: null,
        contact_phone: null,
        contact_email: null,
        website: null,
        typical_rate: null,
        preferred: false,
        active: true
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'vendors') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.updateVendor(
        'vendor-1',
        {
          name: 'DJ One',
          vendor_type: 'dj',
          is_preferred: false,
          is_active: true
        },
        'user-1',
        'ops@example.com'
      )
    ).rejects.toThrow('Vendor not found')
  })

  it('deleteVenueSpace throws not-found when delete affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'space-1', name: 'Main Hall', capacity_seated: 40, capacity_standing: 60, rate_per_hour: 100, description: null, active: true },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'venue_spaces') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.deleteVenueSpace('space-1', 'user-1', 'ops@example.com')
    ).rejects.toThrow('Venue space not found')
  })

  it('deleteCateringPackage throws not-found when delete affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'pkg-1', name: 'Buffet', package_type: 'food', cost_per_head: 25, pricing_model: 'per_head', minimum_guests: 10, description: null, dietary_notes: null, active: true },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'catering_packages') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.deleteCateringPackage('pkg-1', 'user-1', 'ops@example.com')
    ).rejects.toThrow('Catering package not found')
  })

  it('deleteVendor throws not-found when delete affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'vendor-1', name: 'DJ One', service_type: 'dj', contact_name: null, contact_phone: null, contact_email: null, website: null, typical_rate: null, preferred: false, active: true },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'vendors') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        }
      }),
    })

    await expect(
      PrivateBookingService.deleteVendor('vendor-1', 'user-1', 'ops@example.com')
    ).rejects.toThrow('Vendor not found')
  })

  it('updateBooking fails closed when completed SMS duplicate-check lookup errors', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        status: 'confirmed',
        contact_phone: '+447700900123',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-03-10',
        start_time: '18:00',
        setup_date: null,
        setup_time: null,
        end_time: null,
        end_time_next_day: false,
        customer_id: 'customer-1',
        internal_notes: null,
        balance_due_date: null,
        calendar_event_id: null,
        hold_expiry: null,
        deposit_paid_date: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        status: 'completed',
        contact_phone: '+447700900123',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-03-10',
        start_time: '18:00',
        setup_date: null,
        setup_time: null,
        end_time: null,
        end_time_next_day: false,
        customer_id: 'customer-1',
        internal_notes: null,
        balance_due_date: null,
        calendar_event_id: null,
        hold_expiry: null,
        deposit_paid_date: null,
      },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update,
        }
      }),
    })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  count: null,
                  error: { message: 'duplicate check unavailable' },
                }),
              }),
            }),
          }),
        }
      }),
    })

    await expect(
      PrivateBookingService.updateBooking('booking-1', { status: 'completed' })
    ).rejects.toThrow('Failed completed-booking SMS duplicate safety check')

    expect(update).not.toHaveBeenCalled()
    expect((SmsQueueService.queueAndSend as unknown as Mock).mock.calls.length).toBe(0)
  })

  it('updateBooking skips completed SMS when a completed duplicate already exists', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        status: 'confirmed',
        contact_phone: '+447700900123',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-03-10',
        start_time: '18:00',
        setup_date: null,
        setup_time: null,
        end_time: null,
        end_time_next_day: false,
        customer_id: 'customer-1',
        internal_notes: null,
        balance_due_date: null,
        calendar_event_id: null,
        hold_expiry: null,
        deposit_paid_date: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        status: 'completed',
        contact_phone: '+447700900123',
        customer_first_name: 'Alex',
        customer_last_name: 'Smith',
        customer_name: 'Alex Smith',
        event_date: '2026-03-10',
        start_time: '18:00',
        setup_date: null,
        setup_time: null,
        end_time: null,
        end_time_next_day: false,
        customer_id: 'customer-1',
        internal_notes: null,
        balance_due_date: null,
        calendar_event_id: null,
        hold_expiry: null,
        deposit_paid_date: null,
      },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
    const update = vi.fn().mockReturnValue({ eq: updateEq })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_bookings') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update,
        }
      }),
    })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'private_booking_sms_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  count: 1,
                  error: null,
                }),
              }),
            }),
          }),
        }
      }),
    })

    const result = await PrivateBookingService.updateBooking('booking-1', { status: 'completed' })

    expect(update).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('completed')
    expect((SmsQueueService.queueAndSend as unknown as Mock).mock.calls.length).toBe(0)
  })
})
