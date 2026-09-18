import { describe, it, expect } from 'vitest'
import { formatRecruitmentAppointmentTime } from '@/services/recruitment'

// Regression cover for the 16 Jul 2026 booking bug: an appointment time printed the raw UTC
// clock (14:00) while the candidate's own confirmation said 15:00. Candidate emails and
// reminders use this formatter, so the time must match what the candidate was told.

const appointment = {
  type: 'interview',
  location: 'The Anchor',
  // 14:00 UTC == 15:00 Europe/London during BST. This gap is the whole bug.
  scheduled_start: '2026-07-21T14:00:00+00:00',
  timezone: 'Europe/London',
}

describe('formatRecruitmentAppointmentTime', () => {
  // The original defect was `new Date(scheduled_start).toLocaleString('en-GB')`, which
  // renders in the *server's* zone: correct on a London laptop, an hour early on Vercel
  // (UTC). Asserting the BST conversion explicitly is what catches a regression to that.
  it('renders London time for a UTC-stored start, not the raw UTC clock', () => {
    expect(formatRecruitmentAppointmentTime(appointment)).toBe('21 Jul 2026, 15:00')
  })

  it('renders GMT correctly outside British Summer Time', () => {
    expect(formatRecruitmentAppointmentTime({
      scheduled_start: '2026-01-21T14:00:00+00:00',
      timezone: 'Europe/London',
    })).toBe('21 Jan 2026, 14:00')
  })

  it('defaults to Europe/London when the appointment has no timezone', () => {
    expect(formatRecruitmentAppointmentTime({
      scheduled_start: '2026-07-21T14:00:00+00:00',
      timezone: null,
    })).toBe('21 Jul 2026, 15:00')
  })
})
