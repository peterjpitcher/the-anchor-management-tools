import { describe, it, expect } from 'vitest'
import { describeRecruitmentAppointmentCandidate } from '../communications'
import { formatRecruitmentAppointmentTime } from '@/services/recruitment'

// Regression cover for the 16 Jul 2026 booking-alert bug: a candidate self-booked an
// interview and the manager alert read "Interview booked for 21/07/2026, 14:00:00 at
// The Anchor." — it named nobody, and it printed the raw UTC time while the candidate's
// own confirmation said 15:00. The alert is read in an inbox, away from the ATS, so both
// halves matter: who it is about, and a time that matches what the candidate was told.

const appointment = {
  type: 'interview',
  location: 'The Anchor',
  // 14:00 UTC == 15:00 Europe/London during BST. This gap is the whole bug.
  scheduled_start: '2026-07-21T14:00:00+00:00',
  timezone: 'Europe/London',
  candidate: { first_name: 'Kayley', last_name: 'Wilcox', email: 'kayleyw189@example.com' },
  application: { job_posting: { title: 'Bar Staff' } },
}

describe('describeRecruitmentAppointmentCandidate', () => {
  it('names the candidate and the role they applied for', () => {
    expect(describeRecruitmentAppointmentCandidate(appointment)).toBe('Kayley Wilcox (Bar Staff)')
  })

  it('omits the role when the application has no posting (talent pool)', () => {
    expect(describeRecruitmentAppointmentCandidate({ ...appointment, application: null }))
      .toBe('Kayley Wilcox')
  })

  it('falls back to the email when no name is stored', () => {
    expect(describeRecruitmentAppointmentCandidate({
      ...appointment,
      candidate: { first_name: null, last_name: null, email: 'kayleyw189@example.com' },
    })).toBe('kayleyw189@example.com (Bar Staff)')
  })

  it('never renders an empty subject, even with no candidate at all', () => {
    expect(describeRecruitmentAppointmentCandidate({ ...appointment, candidate: null }))
      .toBe('A candidate (Bar Staff)')
  })
})

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
