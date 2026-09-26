// Attachment category "Updated" time on the London clock, in both test zones.
//
// The line used toLocaleString('en-GB') with no zone, so the server render (UTC) showed the time
// an hour early during British Summer Time, and the day before just after midnight.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import CategoriesClient from '@/app/(authenticated)/settings/categories/CategoriesClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => '/',
}))

vi.mock('@/app/actions/attachmentCategories', () => ({
  createAttachmentCategory: vi.fn(),
  updateAttachmentCategory: vi.fn(),
  deleteAttachmentCategory: vi.fn(),
  listAttachmentCategories: vi.fn().mockResolvedValue({ categories: [] }),
}))

afterEach(() => {
  cleanup()
})

describe('attachment categories London times', () => {
  it('shows when a category was updated on the London clock', () => {
    render(
      <CategoriesClient
        initialCategories={[
          {
            category_id: 'cat-1',
            category_name: 'HR Docs',
            email_on_upload: false,
            created_at: '2026-10-01T23:30:00Z',
            updated_at: '2026-10-01T23:30:00Z',
          },
        ]}
        canManage={false}
        initialError={null}
      />,
    )

    expect(screen.getByText('Updated 02/10/2026, 00:30:00')).toBeInTheDocument()
  })
})
