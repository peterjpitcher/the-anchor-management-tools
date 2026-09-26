// The public interview booking page, in both test zones.
//
// Candidates pick an interview slot on this page. It formatted slot and appointment times
// without a time zone, and the server that renders the first HTML runs in UTC, so during
// British Summer Time every time on the page read an hour early (and a late slot showed the
// previous day). Times must be the pub's London wall-clock times wherever the page renders.
//
// Instants are written in UTC so the file reads the same in both zones: 23:30 UTC on
// 1 October 2026 is 00:30 BST on Friday 2 October in London, but still Thursday in UTC.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RecruitmentBookingClient from '@/app/recruitment/book/[token]/RecruitmentBookingClient'

function makePreview() {
  return {
    valid: true,
    application: { role_title: 'Bar Team Member' },
    alreadyBooked: true,
    currentAppointment: {
      // 18:30 BST on Thursday 8 October in London; 17:30 in UTC.
      scheduled_start: '2026-10-08T17:30:00Z',
      location: 'The Anchor',
      reschedule_count: 0,
    },
    slots: [
      {
        id: 'slot-1',
        // 00:30 BST on Friday 2 October in London; 23:30 on Thursday 1 October in UTC.
        starts_at: '2026-10-01T23:30:00Z',
        location: 'The Anchor',
      },
    ],
  }
}

describe('RecruitmentBookingClient London times', () => {
  beforeEach(() => {
    // No Turnstile widget: the page then renders without the external script.
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '')
    // Before the appointment, so the page is not read-only and the slot list renders.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('shows an available slot on the London clock, including the London day', () => {
    render(<RecruitmentBookingClient token="token-1" initialPreview={makePreview()} />)

    expect(screen.getByText(/Friday.*2 October 2026.*00:30/)).toBeInTheDocument()
    expect(screen.queryByText(/Thursday.*1 October 2026.*23:30/)).not.toBeInTheDocument()
  })

  it('shows the current booking on the London clock', () => {
    render(<RecruitmentBookingClient token="token-1" initialPreview={makePreview()} />)

    expect(screen.getByText(/Thursday.*8 October 2026.*18:30/)).toBeInTheDocument()
    expect(screen.queryByText(/8 October 2026.*17:30/)).not.toBeInTheDocument()
  })
})
