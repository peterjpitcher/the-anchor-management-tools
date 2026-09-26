import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VendorDeleteButton } from '@/components/features/invoices/VendorDeleteButton'

/**
 * The delete button used to ask with the browser confirm() and submit its form on yes. It now asks
 * with a ConfirmDialog; the form is submitted only after the Delete in the dialog.
 */

describe('VendorDeleteButton', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks first and submits the form only when confirmed', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {})
    render(<VendorDeleteButton vendorName="Acme Ltd" vendorId="vendor-1" deleteAction={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Acme Ltd' }))
    expect(await screen.findByText('Are you sure you want to delete "Acme Ltd"? This action cannot be undone.')).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
  })

  it('does not submit when cancelled', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {})
    render(<VendorDeleteButton vendorName="Acme Ltd" vendorId="vendor-1" deleteAction={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Acme Ltd' }))
    await screen.findByText('Are you sure you want to delete "Acme Ltd"? This action cannot be undone.')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByText('Are you sure you want to delete "Acme Ltd"? This action cannot be undone.')).not.toBeInTheDocument(),
    )
    expect(submit).not.toHaveBeenCalled()
  })
})
