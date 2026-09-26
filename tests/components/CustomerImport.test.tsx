import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomerImport } from '@/components/features/customers/CustomerImport'

// The CSV input was display:none inside a label, so only a mouse could open it
// (accessibility review, 18 Sep 2026). The picker is now a DS FileButton: a real button the
// keyboard reaches, which opens the hidden file input.
describe('CustomerImport upload', () => {
  it('can be reached with the Tab key and opens the file picker from the keyboard', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <CustomerImport onImportComplete={vi.fn()} onCancel={vi.fn()} existingCustomers={[]} />
    )

    const upload = screen.getByRole('button', { name: 'Upload CSV' })
    for (let i = 0; i < 5 && document.activeElement !== upload; i++) {
      await user.tab()
    }
    expect(upload).toHaveFocus()

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toHaveAttribute('accept', '.csv')
    const openPicker = vi.spyOn(fileInput, 'click')
    await user.keyboard('{Enter}')
    expect(openPicker).toHaveBeenCalledTimes(1)
  })

  it('keeps Download Template next to the upload button, with the upload as the primary action', () => {
    render(<CustomerImport onImportComplete={vi.fn()} onCancel={vi.fn()} existingCustomers={[]} />)

    expect(screen.getByRole('button', { name: 'Download Template' })).toBeInTheDocument()
    // The hand-built label it replaced was styled as a primary button; keep that look.
    expect(screen.getByRole('button', { name: 'Upload CSV' })).toHaveClass('bg-primary')
  })
})
