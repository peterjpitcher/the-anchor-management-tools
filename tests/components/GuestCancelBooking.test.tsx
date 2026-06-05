import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GuestCancelBooking } from '@/components/features/shared/GuestCancelBooking'

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

  it('renders a link-based cancel action in the confirmation state', () => {
    const { container } = render(<GuestCancelBooking {...baseProps} confirmCancel />)

    expect(screen.getByText('Are you sure you want to cancel?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Yes, cancel my booking' })).toHaveAttribute(
      'href',
      '/g/raw-token/table-manage/action?action=cancel&confirm=1'
    )
    expect(screen.getByRole('link', { name: 'No, keep my booking' })).toHaveAttribute(
      'href',
      '/g/raw-token/table-manage'
    )

    expect(container.querySelector('form')).toBeNull()
  })
})
