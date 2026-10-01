import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PaymentHistoryTable from './PaymentHistoryTable'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/actions/privateBookingActions', () => ({ editPrivateBookingPayment: vi.fn(), deletePrivateBookingPayment: vi.fn() }))
vi.mock('@/ds', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  IconButton: ({ label, icon, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string; icon?: React.ReactNode; size?: string }) => (
    <button aria-label={label} {...props}>{icon}</button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
  ConfirmDialog: () => null,
  Icon: () => null,
  Alert: ({ children }: { children?: React.ReactNode }) => <div role="alert">{children}</div>,
  Empty: ({ title }: { title: string }) => <p>{title}</p>,
  SubHeading: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
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

describe('deposit refunds in the booking payment history', () => {
  const payments = [
    { id: 'deposit', type: 'deposit', amount: 250, method: 'paypal', date: '2026-09-14', readonly: true, invoice_id: 'invoice' },
    { id: 'capture', type: 'balance', amount: 30, method: 'paypal', date: '2026-10-01', readonly: true, invoice_id: 'invoice' },
  ] as const

  it('lists a refund as money returned, after the payments of the same day, and leaves the bill totals alone', () => {
    const { container } = render(<PaymentHistoryTable bookingId="booking" canEditPayments totalAmount={30} payments={[...payments]} refunds={[
      { id: 'refund-1', type: 'refund', amount: 250, method: 'paypal', date: '2026-10-01', status: 'completed' },
    ]} />)

    const refundRow = screen.getByText(/Deposit refund/).parentElement
    expect(refundRow).toHaveTextContent('1 Oct 2026 - Deposit refund · PayPal')
    expect(refundRow).toHaveTextContent('-£250.00')
    expect(refundRow).not.toHaveTextContent('pending')

    // Deposit in, bill payment in, deposit back out: the order the money moved.
    const rows = [...container.querySelectorAll('.space-y-2 > div')].map((row) => row.textContent ?? '')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('14 Sept 2026')
    expect(rows[1]).toContain('1 Oct 2026 - balance')
    expect(rows[2]).toContain('Deposit refund')

    // A held deposit was never part of the bill, so handing it back changes nothing there.
    expect(screen.getByText('Paid to date').parentElement).toHaveTextContent('£30.00')
    expect(screen.getByText('Outstanding').parentElement).toHaveTextContent('£0.00')
    // A refund is made through Process Refund, never edited or deleted in this list.
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument()
  })

  it('marks a refund PayPal has not settled yet as pending', () => {
    render(<PaymentHistoryTable bookingId="booking" canEditPayments={false} totalAmount={30} payments={[...payments]} refunds={[
      { id: 'refund-1', type: 'refund', amount: 100, method: 'bank_transfer', date: '2026-10-02', status: 'pending' },
    ]} />)
    const refundRow = screen.getByText(/Deposit refund/).parentElement
    expect(refundRow).toHaveTextContent('2 Oct 2026 - Deposit refund (pending) · Bank transfer')
    expect(refundRow).toHaveTextContent('-£100.00')
  })

  it('still lists a refund when the payment it belongs to is no longer on the booking', () => {
    render(<PaymentHistoryTable bookingId="booking" canEditPayments={false} totalAmount={30} payments={[]} refunds={[
      { id: 'refund-1', type: 'refund', amount: 250, method: 'cash', date: '2026-10-01', status: 'completed' },
    ]} />)
    expect(screen.queryByText('No payments yet')).not.toBeInTheDocument()
    expect(screen.getByText(/Deposit refund/).parentElement).toHaveTextContent('-£250.00')
  })
})
