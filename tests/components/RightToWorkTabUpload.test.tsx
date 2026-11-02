import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RightToWorkTab from '@/components/features/employees/RightToWorkTab'
import type { EmployeeRightToWork } from '@/types/database'

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
// attach a scan (accessibility review, 18 Sep 2026). It is now the DS FileButton: a real button,
// named by the field label, over a hidden input that stays out of the tab order.
describe('RightToWorkTab document photo', () => {
  function renderTab() {
    return render(
      <RightToWorkTab
        employeeId="00000000-0000-4000-8000-000000000001"
        rightToWork={null}
        canEdit
        canViewDocuments
      />,
    )
  }

  it('can be reached with the Tab key', async () => {
    const user = userEvent.setup()
    renderTab()

    const upload = screen.getByLabelText(/Document Photo/)
    expect(upload.tagName).toBe('BUTTON')
    for (let i = 0; i < 40 && document.activeElement !== upload; i++) {
      await user.tab()
    }

    expect(upload).toHaveFocus()
  })

  it('takes a picked file and names it under the button', () => {
    const { container } = renderTab()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveAttribute('tabindex', '-1')
    const scan = new File(['%PDF-1.4'], 'passport-scan.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [scan] } })

    expect(screen.getByText(/passport-scan\.pdf\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Document Photo/ })).toHaveTextContent('Choose Another File')
  })
})

// FF-05 and FF-42: someone who can view but not edit gets the record without its document number
// and notes. The empty fields used to read as nothing on file.
describe('RightToWorkTab for a viewer the document details are withheld from', () => {
  const rightToWork: EmployeeRightToWork = {
    employee_id: '00000000-0000-4000-8000-000000000001',
    document_type: 'Passport',
    check_method: 'manual',
    document_reference: null,
    document_details: null,
    document_expiry_date: null,
    follow_up_date: null,
    verification_date: '2026-10-01',
    verified_by_user_id: null,
    photo_storage_path: null,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
  }

  it('labels the document number and notes as withheld', () => {
    render(
      <RightToWorkTab
        employeeId="00000000-0000-4000-8000-000000000001"
        rightToWork={rightToWork}
        canEdit={false}
        canViewDocuments
        documentWithheld
      />,
    )

    expect(screen.getByLabelText(/Document Reference/)).toHaveAttribute('placeholder', 'Withheld')
    expect(screen.getByLabelText(/Additional Details/)).toHaveAttribute('placeholder', 'Withheld')
    expect(screen.getAllByText('Shown only to staff who can edit employee records.')).toHaveLength(2)
  })

  it('says nothing about withholding to someone who can edit', () => {
    render(
      <RightToWorkTab
        employeeId="00000000-0000-4000-8000-000000000001"
        rightToWork={rightToWork}
        canEdit
        canViewDocuments
      />,
    )

    expect(screen.getByLabelText(/Document Reference/)).not.toHaveAttribute('placeholder')
    expect(screen.queryByText('Shown only to staff who can edit employee records.')).not.toBeInTheDocument()
  })
})
