import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CustomerForm } from '@/components/features/customers/CustomerForm'
import { CustomerImport } from '@/components/features/customers/CustomerImport'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/components/ui-v2/feedback/Toast', () => ({
  toast,
}))

describe('Customer phone handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits international numbers from CustomerForm without rewriting to +44', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()

    render(<CustomerForm onSubmit={onSubmit} onCancel={onCancel} />)

    fireEvent.change(screen.getByLabelText('First Name'), {
      target: { value: 'Jean' }
    })
    fireEvent.change(screen.getByLabelText('Mobile Number'), {
      target: { value: '+33 6 12 34 56 78' }
    })

    fireEvent.submit(screen.getByRole('button', { name: 'Create Customer' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          mobile_number: '+33612345678'
        })
      )
    })
  })

  it('accepts international numbers during customer CSV import', async () => {
    const onImportComplete = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()

    render(
      <CustomerImport
        onImportComplete={onImportComplete}
        onCancel={onCancel}
        existingCustomers={[]}
      />
    )

    const file = new File(
      ['first_name,last_name,email,mobile_number\nJean,Dupont,jean@example.com,+33 6 12 34 56 78\n'],
      'customers.csv',
      { type: 'text/csv' }
    )

    const uploadInput = screen.getByLabelText('Upload CSV') as HTMLInputElement
    fireEvent.change(uploadInput, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('Preview Import')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 Customers' }))

    await waitFor(() => {
      expect(onImportComplete).toHaveBeenCalledWith([
        expect.objectContaining({
          mobile_number: '+33612345678'
        })
      ])
    })
  })
})

