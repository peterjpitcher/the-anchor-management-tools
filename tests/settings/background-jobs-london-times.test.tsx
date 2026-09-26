// Background job start and finish times on the London clock, in both test zones.
//
// The job details panel used toLocaleString() with no locale and no zone, so outside a London
// en-GB browser it printed US format on the host clock, an hour behind London during British
// Summer Time on a UTC host.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import BackgroundJobsClient from '@/app/(authenticated)/settings/background-jobs/BackgroundJobsClient'
import type { BackgroundJob } from '@/app/actions/backgroundJobs'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => '/',
}))

vi.mock('@/app/actions/backgroundJobs', () => ({
  listBackgroundJobs: vi.fn().mockResolvedValue({
    jobs: [],
    summary: { total: 0, pending: 0, completed: 0, failed: 0 },
  }),
  retryBackgroundJob: vi.fn().mockResolvedValue({ success: true }),
  deleteBackgroundJob: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/app/actions/cronJobs', () => ({
  runCronJob: vi.fn().mockResolvedValue({ success: true, data: {} }),
}))

afterEach(() => {
  cleanup()
})

const completedJob: BackgroundJob = {
  id: 'job-1',
  type: 'send_sms',
  payload: {},
  status: 'completed',
  priority: 1,
  attempts: 1,
  max_attempts: 3,
  scheduled_for: '2026-10-01T23:30:00Z',
  created_at: '2026-10-01T23:29:00Z',
  started_at: '2026-10-01T23:30:00Z',
  completed_at: '2026-10-01T23:45:10Z',
  error_message: null,
  result: null,
  updated_at: '2026-10-01T23:45:10Z',
}

describe('background job details London times', () => {
  it('shows when the job started and finished on the London clock', () => {
    render(
      <BackgroundJobsClient
        initialJobs={[completedJob]}
        initialSummary={{ total: 1, pending: 0, completed: 1, failed: 0 }}
        canManage={false}
        initialError={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    expect(screen.getByText('02/10/2026, 00:30:00')).toBeInTheDocument()
    expect(screen.getByText('02/10/2026, 00:45:10')).toBeInTheDocument()
  })
})
