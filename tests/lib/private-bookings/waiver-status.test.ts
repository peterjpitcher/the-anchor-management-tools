import { describe, expect, it } from 'vitest'
import {
  effectiveWaiverStatus,
  waiverIsOutstanding,
  type BookingWaiverStatus,
} from '@/lib/private-bookings/waiver-status'

const STORED_STATUSES: readonly BookingWaiverStatus[] = ['not_required', 'required', 'sent', 'signed', 'overdue']

describe('the waiver status a booking shows and acts on', () => {
  it('reads as required when outside food is ticked and the stored status still says not required', () => {
    expect(effectiveWaiverStatus({ outside_food: true, waiver_status: 'not_required' })).toBe('required')
  })

  it('reads as required when outside food is ticked and nothing has been stored yet', () => {
    expect(effectiveWaiverStatus({ outside_food: true, waiver_status: null })).toBe('required')
    expect(effectiveWaiverStatus({ outside_food: true, waiver_status: undefined })).toBe('required')
    expect(effectiveWaiverStatus({ outside_food: true })).toBe('required')
  })

  it('lets the stored status win once it says anything other than not required', () => {
    for (const stored of ['required', 'sent', 'signed', 'overdue'] as const) {
      expect(effectiveWaiverStatus({ outside_food: true, waiver_status: stored }), `ticked, stored ${stored}`).toBe(stored)
      expect(effectiveWaiverStatus({ outside_food: false, waiver_status: stored }), `unticked, stored ${stored}`).toBe(stored)
      expect(effectiveWaiverStatus({ outside_food: null, waiver_status: stored }), `no tick, stored ${stored}`).toBe(stored)
    }
  })

  it('never turns a signed waiver back into one that is owed, even with outside food ticked', () => {
    expect(effectiveWaiverStatus({ outside_food: true, waiver_status: 'signed' })).toBe('signed')
    expect(waiverIsOutstanding({ outside_food: true, waiver_status: 'signed' })).toBe(false)
  })

  it('stays not required when outside food is not ticked', () => {
    expect(effectiveWaiverStatus({ outside_food: false, waiver_status: 'not_required' })).toBe('not_required')
    expect(effectiveWaiverStatus({ outside_food: null, waiver_status: 'not_required' })).toBe('not_required')
    expect(effectiveWaiverStatus({ waiver_status: 'not_required' })).toBe('not_required')
  })

  it('treats a booking with nothing recorded at all as not required', () => {
    expect(effectiveWaiverStatus({})).toBe('not_required')
    expect(effectiveWaiverStatus({ outside_food: null, waiver_status: null })).toBe('not_required')
    expect(effectiveWaiverStatus({ outside_food: undefined, waiver_status: undefined })).toBe('not_required')
  })

  it('treats a stored value it does not know as not required, and as required when outside food is ticked', () => {
    for (const unknown of ['waived', 'SIGNED', 'Required', ' sent', '']) {
      expect(effectiveWaiverStatus({ outside_food: false, waiver_status: unknown }), `unticked, stored "${unknown}"`).toBe('not_required')
      expect(effectiveWaiverStatus({ outside_food: true, waiver_status: unknown }), `ticked, stored "${unknown}"`).toBe('required')
    }
  })

  it('only ever returns one of the five known statuses', () => {
    for (const outsideFood of [true, false, null, undefined]) {
      for (const stored of [...STORED_STATUSES, 'something else', null, undefined]) {
        expect(STORED_STATUSES).toContain(effectiveWaiverStatus({ outside_food: outsideFood, waiver_status: stored }))
      }
    }
  })
})

describe('whether the waiver is still owed', () => {
  it('is owed while it is required, sent or overdue', () => {
    for (const stored of ['required', 'sent', 'overdue'] as const) {
      expect(waiverIsOutstanding({ outside_food: false, waiver_status: stored }), `unticked, stored ${stored}`).toBe(true)
      expect(waiverIsOutstanding({ outside_food: true, waiver_status: stored }), `ticked, stored ${stored}`).toBe(true)
    }
  })

  it('is not owed once it is signed, or when it was never required', () => {
    expect(waiverIsOutstanding({ outside_food: false, waiver_status: 'signed' })).toBe(false)
    expect(waiverIsOutstanding({ outside_food: false, waiver_status: 'not_required' })).toBe(false)
  })

  it('is owed when outside food is ticked and the stored status is out of date', () => {
    expect(waiverIsOutstanding({ outside_food: true, waiver_status: 'not_required' })).toBe(true)
    expect(waiverIsOutstanding({ outside_food: true, waiver_status: null })).toBe(true)
    expect(waiverIsOutstanding({ outside_food: true })).toBe(true)
  })

  it('is not owed when nothing is recorded, or the stored value is not one it knows', () => {
    expect(waiverIsOutstanding({})).toBe(false)
    expect(waiverIsOutstanding({ outside_food: null, waiver_status: null })).toBe(false)
    expect(waiverIsOutstanding({ outside_food: false, waiver_status: 'waived' })).toBe(false)
  })
})
