import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RightToWorkTab from '@/components/features/employees/RightToWorkTab'

vi.mock('@/app/actions/employeeActions', () => ({
  createRightToWorkDocumentUploadUrl: vi.fn(),
  deleteRightToWorkPhoto: vi.fn(),
  getRightToWorkPhotoUrl: vi.fn(),
  upsertRightToWork: vi.fn(),
}))

vi.mock('@/components/providers/SupabaseProvider', () => ({
  useSupabase: () => ({}),
}))

// jsdom loads no Tailwind, so give it the two rules that decide whether the file input can
// take keyboard focus: `hidden` removes it from the tab order, `sr-only` keeps it there.
const TAILWIND_RULES =
  '.hidden{display:none}' +
  '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;' +
  'clip:rect(0,0,0,0);white-space:nowrap;border-width:0}'

let style: HTMLStyleElement

beforeEach(() => {
  style = document.createElement('style')
  style.textContent = TAILWIND_RULES
  document.head.appendChild(style)
})

afterEach(() => {
  style.remove()
})

// The document photo input was display:none inside its drop box, so only a mouse could
// attach a scan (accessibility review, 18 Sep 2026).
describe('RightToWorkTab document photo', () => {
  it('can be reached with the Tab key', async () => {
    const user = userEvent.setup()
    render(
      <RightToWorkTab
        employeeId="00000000-0000-4000-8000-000000000001"
        rightToWork={null}
        canEdit
        canViewDocuments
      />,
    )

    const upload = screen.getByLabelText(/Document Photo/)
    expect(upload).toHaveAttribute('type', 'file')
    for (let i = 0; i < 40 && document.activeElement !== upload; i++) {
      await user.tab()
    }

    expect(upload).toHaveFocus()
  })
})
