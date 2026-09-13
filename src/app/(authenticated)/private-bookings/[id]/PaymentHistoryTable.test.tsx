import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PaymentHistoryTable from './PaymentHistoryTable'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/actions/privateBookingActions', () => ({ editPrivateBookingPayment: vi.fn(), deletePrivateBookingPayment: vi.fn() }))
vi.mock('@/ds', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
  ConfirmDialog: () => null,
}))

describe('booking payment history from a linked invoice', () => {
  it('shows settlement including an applied deposit and keeps invoice money read-only', () => {
    render(<PaymentHistoryTable bookingId="booking" canEditPayments totalAmount={994.8} payments={[
      { id: 'deposit', type: 'deposit', amount: 250, appliedAmount: 250, method: 'paypal', date: '2026-08-28', readonly: true, invoice_id: 'invoice' },
      { id: 'capture', type: 'balance', amount: 744.8, method: 'paypal', date: '2026-09-05', readonly: true, invoice_id: 'invoice' },
    ]} />)
    expect(screen.getByText('Paid to date').parentElement).toHaveTextContent('£994.80')
    expect(screen.getByText('Outstanding').parentElement).toHaveTextContent('£0.00')
    expect(screen.getAllByRole('link', { name: 'View invoice' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Edit balance payment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete deposit payment' })).not.toBeInTheDocument()
  })

  it('does not count a separately held deposit against the event balance', () => {
    render(<PaymentHistoryTable bookingId="booking" canEditPayments totalAmount={994.8} payments={[
      { id: 'deposit', type: 'deposit', amount: 250, method: 'cash', date: '2026-08-28' },
      { id: 'cash', type: 'balance', amount: 100, method: 'cash', date: '2026-09-05' },
    ]} />)
    expect(screen.getByText('Paid to date').parentElement).toHaveTextContent('£100.00')
    expect(screen.getByText('Outstanding').parentElement).toHaveTextContent('£894.80')
    expect(screen.getByRole('button', { name: 'Edit balance payment' })).toBeInTheDocument()
  })
})
