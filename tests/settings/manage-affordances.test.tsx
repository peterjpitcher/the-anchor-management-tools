import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BackgroundJobsClient from '@/app/(authenticated)/settings/background-jobs/BackgroundJobsClient'
import CategoriesClient from '@/app/(authenticated)/settings/categories/CategoriesClient'
import MessageTemplatesClient from '@/app/(authenticated)/settings/message-templates/MessageTemplatesClient'

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

vi.mock('@/app/actions/attachmentCategories', () => ({
  createAttachmentCategory: vi.fn(),
  updateAttachmentCategory: vi.fn(),
  deleteAttachmentCategory: vi.fn(),
  listAttachmentCategories: vi.fn().mockResolvedValue({ categories: [] }),
}))

vi.mock('@/app/actions/messageTemplates', () => ({
  listMessageTemplates: vi.fn().mockResolvedValue({ templates: [] }),
  createMessageTemplate: vi.fn(),
  updateMessageTemplate: vi.fn(),
  deleteMessageTemplate: vi.fn(),
  toggleMessageTemplate: vi.fn(),
}))

afterEach(() => {
  cleanup()
})

describe('settings manage affordances for read-only roles', () => {
  it('disables process jobs button and hides retry/delete actions when canManage is false', () => {
    render(
      <BackgroundJobsClient
        initialJobs={[]}
        initialSummary={{ total: 0, pending: 0, completed: 0, failed: 0 }}
        canManage={false}
        initialError={null}
      />,
    )

    expect(screen.queryByRole('button', { name: /process jobs/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry job/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete job/i })).not.toBeInTheDocument()
  })

  it('keeps category management controls disabled or hidden without manage rights', () => {
    render(
      <CategoriesClient
        initialCategories={[
          {
            category_id: 'cat-1',
            category_name: 'HR Docs',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]}
        canManage={false}
        initialError={null}
      />,
    )

    expect(screen.getByRole('button', { name: /add category/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('hides template creation affordances for read-only users', () => {
    render(
      <MessageTemplatesClient
        initialTemplates={[
          {
            id: 'template-1',
            name: 'Reminder',
            description: 'Reminder template',
            template_type: 'custom',
            content: 'Hello {{first_name}}',
            variables: ['first_name'],
            is_default: false,
            is_active: true,
            estimated_segments: 1,
            send_timing: 'immediate',
            custom_timing_hours: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]}
        canManage={false}
        initialError={null}
      />,
    )

    expect(screen.queryByRole('button', { name: /new template/i })).not.toBeInTheDocument()
  })

})
