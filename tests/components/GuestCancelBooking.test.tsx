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

  it('keeps a link-only cancel path, for sandboxed frames and for anyone who would rather not say', () => {
    // The original implementation used a link rather than a form because sandboxed frames
    // without allow-forms block submission before it reaches the server. Adding the reason
    // form must not remove that route, or cancelling breaks in those frames.
    render(<GuestCancelBooking {...baseProps} confirmCancel />)

    expect(
      screen.getByRole('link', { name: 'Cancel without giving a reason' })
    ).toHaveAttribute('href', '/g/raw-token/table-manage/action?action=cancel&confirm=1')

    expect(screen.getByRole('link', { name: 'No, keep my booking' })).toHaveAttribute(
      'href',
      '/g/raw-token/table-manage'
    )
  })

  it('submits the reason by POST, carrying the action and confirmation', () => {
    const { container } = render(<GuestCancelBooking {...baseProps} confirmCancel />)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
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
