// Calendar note form defaults from the London date, in both test zones.
//
// The form's "today" came from shifting the host clock by the host offset, which on the UTC
// server is the UTC date: from 00:00 to 00:59 BST it defaulted every date box to yesterday, and
// the AI generator's end date to a year from yesterday.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import CalendarNotesManager from '@/app/(authenticated)/settings/calendar-notes/CalendarNotesManager'

vi.mock('@/app/actions/calendar-notes', () => ({
  createCalendarNote: vi.fn(),
  deleteCalendarNote: vi.fn(),
  generateCalendarNotesWithAI: vi.fn(),
  updateCalendarNote: vi.fn(),
}))

const JUST_AFTER_MIDNIGHT_BST = '2026-10-01T23:30:00Z'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(JUST_AFTER_MIDNIGHT_BST))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('calendar notes form defaults', () => {
  it('defaults the note and generator dates to London today, and a year on from it', () => {
    const { container } = render(<CalendarNotesManager initialNotes={[]} initialError={null} />)

    const dateValues = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]')).map(
      input => input.value,
    )

    // Note start and end, then generator start and end.
    expect(dateValues).toEqual(['2026-10-02', '2026-10-02', '2026-10-02', '2027-10-02'])
  })
})
