import { describe, expect, it } from 'vitest'
import { describePartySizeStaffNotice } from '@/lib/table-bookings/party-size-staff-notice'

/**
 * BK-043: the party-size route's warning and the seats whose food choices were dropped never
 * reached the FOH iPad, and flashed past as a toast on the back office. Both screens now keep
 * these lines up until dismissed.
 */
describe('the party-size notice staff keep on screen', () => {
  it('lists the deposit warning and each seat whose food was dropped, with name and dishes', () => {
    expect(
      describePartySizeStaffNotice({
        warning: 'Party size 16 to 12. The £160.00 deposit is paid. The booking is flagged for a manager to check.',
        preorderRemoved: [
          { id: 'c-16', ordinal: 16, guestName: 'Sam', courses: [{ course: 'main', itemName: 'Turkey' }, { course: 'dessert', itemName: 'Pudding' }] },
          { id: 'c-15', ordinal: 15, guestName: null, courses: [] },
        ],
      })
    ).toEqual([
      'Party size 16 to 12. The £160.00 deposit is paid. The booking is flagged for a manager to check.',
      'Seat 16 (Sam): food choices removed (Turkey, Pudding). Tell the booker in case the wrong guest was dropped.',
      'Seat 15: food choices removed. Tell the booker in case the wrong guest was dropped.',
    ])
  })

  it('has nothing to say when the change needs no follow-up', () => {
    expect(describePartySizeStaffNotice({ warning: null, preorderRemoved: [] })).toEqual([])
    expect(describePartySizeStaffNotice(null)).toEqual([])
  })
})
