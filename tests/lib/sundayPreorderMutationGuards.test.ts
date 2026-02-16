import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveSundayPreorderByBookingId } from '@/lib/table-bookings/sunday-preorder'

describe('sunday pre-order mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed when booking completion update affects no rows after item persistence', async () => {
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'booking-1',
        customer_id: 'customer-1',
        booking_reference: 'REF-1',
        booking_type: 'sunday_lunch',
        status: 'confirmed',
        party_size: 4,
        start_datetime: '2099-01-10T12:00:00.000Z',
        sunday_preorder_cutoff_at: null,
        sunday_preorder_completed_at: null,
      },
      error: null,
    })
    const bookingEq = vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
    const bookingSelect = vi.fn().mockReturnValue({ eq: bookingEq })

    const bookingUpdateMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const bookingUpdateSelect = vi.fn().mockReturnValue({ maybeSingle: bookingUpdateMaybeSingle })
    const bookingUpdateEq = vi.fn().mockReturnValue({ select: bookingUpdateSelect })
    const bookingUpdate = vi.fn().mockReturnValue({ eq: bookingUpdateEq })

    const menuMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    })
    const menuEqActive = vi.fn().mockReturnValue({ maybeSingle: menuMaybeSingle })
    const menuEqCode = vi.fn().mockReturnValue({ eq: menuEqActive })
    const menuSelect = vi.fn().mockReturnValue({ eq: menuEqCode })

    const sundayDishId = '11111111-1111-4111-8111-111111111111'
    const fallbackDishesEqSunday = vi.fn().mockResolvedValue({
      data: [
        {
          id: sundayDishId,
          name: 'Roast Beef',
          selling_price: 21.5,
        },
      ],
      error: null,
    })
    const fallbackDishesEqActive = vi.fn().mockReturnValue({ eq: fallbackDishesEqSunday })
    const fallbackDishesSelect = vi.fn().mockReturnValue({ eq: fallbackDishesEqActive })

    const legacyItemsEq = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const legacyItemsSelect = vi.fn().mockReturnValue({ eq: legacyItemsEq })

    const existingItemsNot = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const existingItemsEq = vi.fn().mockReturnValue({ not: existingItemsNot })
    const existingItemsSelect = vi.fn().mockReturnValue({ eq: existingItemsEq })

    const deleteItemsNot = vi.fn().mockResolvedValue({
      error: null,
    })
    const deleteItemsEq = vi.fn().mockReturnValue({ not: deleteItemsNot })
    const deleteItems = vi.fn().mockReturnValue({ eq: deleteItemsEq })

    const insertItems = vi.fn().mockResolvedValue({
      error: null,
    })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'table_bookings') {
          return {
            select: bookingSelect,
            update: bookingUpdate,
          }
        }
        if (table === 'menu_menus') {
          return {
            select: menuSelect,
          }
        }
        if (table === 'menu_dishes') {
          return {
            select: fallbackDishesSelect,
          }
        }
        if (table === 'sunday_lunch_menu_items') {
          return {
            select: legacyItemsSelect,
          }
        }
        if (table === 'table_booking_items') {
          return {
            select: existingItemsSelect,
            delete: deleteItems,
            insert: insertItems,
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await expect(
      saveSundayPreorderByBookingId(supabase as any, {
        bookingId: 'booking-1',
        items: [
          {
            menu_dish_id: sundayDishId,
            quantity: 2,
          },
        ],
      })
    ).rejects.toThrow('Sunday pre-order save affected no booking rows: booking-1')

    expect(deleteItems).toHaveBeenCalledTimes(1)
    expect(insertItems).toHaveBeenCalledTimes(1)
    expect(bookingUpdateEq).toHaveBeenCalledWith('id', 'booking-1')
  })
})

