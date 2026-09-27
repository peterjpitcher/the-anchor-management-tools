import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Empty } from './Empty'

describe('Empty', () => {
  it('supports the legacy named icons through the DS icon registry', () => {
    const { container } = render(
      <Empty title="No bookings" description="Try another date" icon="calendar" size="sm" />,
    )

    expect(screen.getByRole('heading', { name: 'No bookings' })).toBeTruthy()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
