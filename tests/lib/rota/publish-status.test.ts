import { describe, expect, it } from 'vitest'
import {
  shiftIsUnpublished,
  getRemovedPublishedShifts,
  type PublishedShiftSnapshot,
  type RotaPublishShift,
} from '@/lib/rota/publish-status'

const week = {
  status: 'published' as const,
  published_at: '2026-06-01T14:55:10.928Z',
}

const publishedShift: PublishedShiftSnapshot = {
  id: 'shift-1',
  employee_id: 'employee-1',
  shift_date: '2026-06-22',
  start_time: '16:00:00',
  end_time: '22:00:00',
  unpaid_break_minutes: 0,
  department: 'bar',
  status: 'scheduled',
  notes: null,
  is_overnight: false,
  is_open_shift: false,
  name: 'Monday',
}

const liveShift: RotaPublishShift = {
  ...publishedShift,
  created_at: '2026-05-07T13:29:03.228Z',
  updated_at: '2026-06-06T15:20:58.878Z',
}

describe('shiftIsUnpublished', () => {
  it('does not treat acceptance-only updated_at changes as unpublished', () => {
    const publishedShiftById = new Map([[publishedShift.id, publishedShift]])

    expect(shiftIsUnpublished(liveShift, week, publishedShiftById)).toBe(false)
  })

  it('treats new shifts missing from the published snapshot as unpublished', () => {
    expect(shiftIsUnpublished(liveShift, week, new Map())).toBe(true)
  })

  it('treats rota field changes as unpublished', () => {
    const publishedShiftById = new Map([[publishedShift.id, publishedShift]])

    expect(shiftIsUnpublished({ ...liveShift, start_time: '17:00:00' }, week, publishedShiftById)).toBe(true)
  })
})

describe('getRemovedPublishedShifts', () => {
  const secondPublishedShift: PublishedShiftSnapshot = {
    ...publishedShift,
    id: 'shift-2',
    employee_id: 'employee-2',
    name: 'Tuesday',
  }

  it('returns snapshot shifts that no longer have a live row', () => {
    // Only shift-1 survives; shift-2 was deleted since publish.
    const removed = getRemovedPublishedShifts([liveShift], week, [publishedShift, secondPublishedShift])

    expect(removed).toHaveLength(1)
    expect(removed[0].id).toBe('shift-2')
  })

  it('returns nothing when every published shift still has a live row', () => {
    const secondLive: RotaPublishShift = { ...secondPublishedShift }

    expect(getRemovedPublishedShifts([liveShift, secondLive], week, [publishedShift, secondPublishedShift])).toEqual([])
  })

  it('does not count a still-present (e.g. cancelled) live shift as removed', () => {
    const cancelledLive: RotaPublishShift = { ...liveShift, status: 'cancelled' }

    expect(getRemovedPublishedShifts([cancelledLive], week, [publishedShift])).toEqual([])
  })

  it('returns nothing for a draft week (no published snapshot to diff against)', () => {
    const draftWeek = { status: 'draft' as const, published_at: null }

    expect(getRemovedPublishedShifts([], draftWeek, [publishedShift])).toEqual([])
  })

  it('returns nothing when the week has never been published', () => {
    const unpublishedWeek = { status: 'published' as const, published_at: null }

    expect(getRemovedPublishedShifts([], unpublishedWeek, [publishedShift])).toEqual([])
  })
})
