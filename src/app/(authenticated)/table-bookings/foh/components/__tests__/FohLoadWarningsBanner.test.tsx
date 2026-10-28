import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FohLoadWarningsBanner } from '../FohLoadWarningsBanner'

describe('FohLoadWarningsBanner (BK-179)', () => {
  it('names what failed to load', () => {
    render(<FohLoadWarningsBanner warnings={['communal_event_seats', 'standing_event_guests']} />)
    expect(screen.getByRole('alert')).toHaveTextContent('event seats on shared tables, standing event guests')
    expect(screen.getByRole('alert')).toHaveTextContent('Check before seating')
  })

  it('renders nothing when everything loaded, or only private hires failed (they have their own banner)', () => {
    const { container, rerender } = render(<FohLoadWarningsBanner warnings={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<FohLoadWarningsBanner warnings={['private_hires']} />)
    expect(container).toBeEmptyDOMElement()
  })
})
