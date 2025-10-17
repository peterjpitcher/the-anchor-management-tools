import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CategoriesClient from '@/app/(authenticated)/settings/categories/CategoriesClient'
import BackgroundJobsClient from '@/app/(authenticated)/settings/background-jobs/BackgroundJobsClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

vi.mock('@/app/actions/attachmentCategories', () => ({
  listAttachmentCategories: vi.fn(),
  createAttachmentCategory: vi.fn(),
  updateAttachmentCategory: vi.fn(),
  deleteAttachmentCategory: vi.fn(),
}))

vi.mock('@/app/actions/backgroundJobs', () => ({
  listBackgroundJobs: vi.fn(),
  retryBackgroundJob: vi.fn(),
  deleteBackgroundJob: vi.fn(),
}))

vi.mock('@/app/actions/cronJobs', () => ({
  runCronJob: vi.fn(),
}))

describe('Settings client components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps categories management read-only without permission', () => {
    render(
      <CategoriesClient
        initialCategories={[
          { category_id: '1', category_name: 'Contracts', created_at: '', updated_at: '' },
        ]}
        canManage={false}
        initialError={null}
      />,
    )

    expect(
      screen.getByText('You have read-only access to attachment categories.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Category' })).toBeDisabled()
    expect(screen.getByPlaceholderText('New category name')).toBeDisabled()
  })

  it('disables background-job controls for read-only viewers', () => {
    render(
      <BackgroundJobsClient
        initialJobs={[
          {
            id: 'job-1',
            type: 'send_sms',
            payload: {},
            status: 'failed',
            priority: 2,
            attempts: 1,
            max_attempts: 3,
            scheduled_for: '',
            created_at: '',
            updated_at: '',
            result: null,
            started_at: '',
            completed_at: '',
            failed_at: '',
            error_message: 'Failed',
          },
        ]}
        initialSummary={{ total: 1, pending: 0, completed: 0, failed: 1 }}
        canManage={false}
        initialError={null}
      />,
    )

    const processButton = screen.getByRole('button', { name: 'Process Jobs' })
    expect(processButton).toBeDisabled()
    expect(screen.queryByTitle('Retry job')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Delete job')).not.toBeInTheDocument()
  })
})
