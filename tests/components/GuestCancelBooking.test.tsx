import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GuestCancelBooking } from '@/components/features/shared/GuestCancelBooking'
import { CANCELLATION_REASONS } from '@/lib/table-bookings/cancellation-reasons'

const baseProps = {
  actionUrl: '/g/raw-token/table-manage/action',
  manageUrl: '/g/raw-token/table-manage',
}

describe('GuestCancelBooking', () => {
  it('uses a normal link for the first cancel step', () => {
    render(<GuestCancelBooking {...baseProps} confirmCancel={false} />)

    expect(screen.getByRole('link', { name: 'Cancel booking' })).toHaveAttribute(
      'href',
      '/g/raw-token/table-manage?confirmCancel=1'
    )
  })

  it('asks why, without ever making it a condition of cancelling', () => {
    render(<GuestCancelBooking {...baseProps} confirmCancel />)

    expect(screen.getByText('Are you sure you want to cancel?')).toBeInTheDocument()

    // All seven reasons are offered...
    for (const reason of CANCELLATION_REASONS) {
      expect(screen.getByRole('radio', { name: reason.label })).toBeInTheDocument()
    }

    // ...and none of them is required. A guest who will not say why must still be able
    // to cancel, so nothing here carries `required`.
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeRequired()
    }
    expect(screen.getByLabelText(/Anything else/i)).not.toBeRequired()
  })

  it('cancels without a reason by POST, never by a link (BK-109)', () => {
    // Opening an address must never cancel a booking: a link scanner or browser extension that
    // fetched the old GET link cancelled the table and refunded the deposit. The no-reason path is
    // now its own small form.
    const { container } = render(<GuestCancelBooking {...baseProps} confirmCancel />)

    expect(screen.queryByRole('link', { name: 'Cancel without giving a reason' })).toBeNull()
    for (const link of container.querySelectorAll('a')) {
      expect(link.getAttribute('href') ?? '').not.toContain('action=cancel')
    }

    const button = screen.getByRole('button', { name: 'Cancel without giving a reason' })
    expect(button).toHaveAttribute('type', 'submit')
    const form = button.closest('form')
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/g/raw-token/table-manage/action')
    expect(form).toHaveAttribute('target', '_top')
    expect(form?.querySelector('input[name="action"]')).toHaveValue('cancel')
    expect(form?.querySelector('input[name="confirm"]')).toHaveValue('1')
    expect(form?.querySelector('input[name="cancellation_reason"]')).toBeNull()

    expect(screen.getByRole('link', { name: 'No, keep my booking' })).toHaveAttribute(
      'href',
      '/g/raw-token/table-manage'
    )
  })

  it('submits the reason by POST, carrying the action and confirmation', () => {
    const { container } = render(<GuestCancelBooking {...baseProps} confirmCancel />)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('target', '_top')
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/g/raw-token/table-manage/action')

    expect(container.querySelector('input[name="action"]')).toHaveValue('cancel')
    expect(container.querySelector('input[name="confirm"]')).toHaveValue('1')
    expect(screen.getByRole('button', { name: 'Yes, cancel my booking' })).toHaveAttribute(
      'type',
      'submit'
    )
  })
})
