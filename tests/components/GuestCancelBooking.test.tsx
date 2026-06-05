import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GuestCancelBooking } from '@/components/features/shared/GuestCancelBooking'

const baseProps = {
  actionUrl: '/g/raw-token/table-manage/action',
  manageUrl: '/g/raw-token/table-manage',
  specialRequirements: '',
}

describe('GuestCancelBooking', () => {
  it('uses a normal link for the first cancel step', () => {
    render(<GuestCancelBooking {...baseProps} confirmCancel={false} />)

    expect(screen.getByRole('link', { name: 'Cancel booking' })).toHaveAttribute(
      'href',
      '/g/raw-token/table-manage?confirmCancel=1'
    )
  })

  it('renders a native cancel form in the confirmation state', () => {
    const { container } = render(<GuestCancelBooking {...baseProps} confirmCancel />)

    expect(screen.getByText('Are you sure you want to cancel?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes, cancel my booking' })).toHaveAttribute('type', 'submit')
    expect(screen.getByRole('link', { name: 'No, keep my booking' })).toHaveAttribute(
      'href',
      '/g/raw-token/table-manage'
    )

    const form = container.querySelector('form')
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/g/raw-token/table-manage/action')
    expect(container.querySelector('input[name="action"]')).toHaveAttribute('value', 'cancel')
  })
})
