import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveSundayPreorderByBookingId } from '@/lib/table-bookings/sunday-preorder'

// Updated: saveSundayPreorderByBookingId now calls getSundayPreorderPageDataByBookingId
// internally, which loads the booking, menu items, and existing items before saving.
// The mock structure was updated to match the current multi-step flow.
describe('sunday pre-order mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when booking completion update affects no rows after item persistence', async () => {
    const sundayDishId = '11111111-1111-4111-8111-111111111111'
    const bookingId = 'booking-1'
    const futureDate = '2099-01-10T12:00:00.000Z'

    // Track calls for assertions
    const bookingUpdateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const bookingUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: bookingUpdateMaybeSingle })
    const bookingUpdateEq = vi.fn().mockReturnValue({ select: bookingUpdateSelect })

    // Build a supabase mock that supports the full flow:
    // 1. table_bookings: select (page data) + update (completion)
    // 2. menu_menus: select to look up sunday_lunch menu
    // 3. menu_dishes: fallback select for sunday lunch dishes
    // 4. sunday_lunch_menu_items: legacy category lookup
    // 5. table_booking_items: select (existing items in page data + save), insert/update/delete

    let tableBookingSelectCallCount = 0

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: bookingId,
                    customer_id: 'customer-1',
                    booking_reference: 'REF-1',
                    booking_type: 'sunday_lunch',
                    status: 'confirmed',
                    party_size: 4,
                    start_datetime: futureDate,
                    sunday_preorder_cutoff_at: null,
                    sunday_preorder_completed_at: null,
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({ eq: bookingUpdateEq }),
          }
        }

        if (table === 'menu_menus') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }

        if (table === 'menu_dishes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  data: [
                    {
                      id: sundayDishId,
                      name: 'Roast Beef',
                      selling_price: 21.5,
                    },
                  ],
                  error: null,
                  // The result itself is the resolved value (no additional chaining)
                  then: undefined,
                }),
              }),
            }),
          }
        }

        if (table === 'sunday_lunch_menu_items') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          }
        }

        if (table === 'table_booking_items') {
          tableBookingSelectCallCount++
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
            insert: vi.fn().mockResolvedValue({ error: null }),
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await expect(
      saveSundayPreorderByBookingId(supabase as any, {
        bookingId,
        items: [
          {
            menu_dish_id: sundayDishId,
            quantity: 2,
          },
        ],
        staffOverride: true,
      })
    ).rejects.toThrow('Sunday pre-order save affected no booking rows: booking-1')

    expect(bookingUpdateEq).toHaveBeenCalledWith('id', bookingId)
  })
})
