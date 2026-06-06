import { describe, expect, it } from 'vitest'
import { shiftIsUnpublished, type PublishedShiftSnapshot, type RotaPublishShift } from '@/lib/rota/publish-status'

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
