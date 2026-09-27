import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SubHeading } from './SubHeading'

describe('SubHeading', () => {
  it('is an h4 by default, in the card sub-heading style', () => {
    render(<SubHeading>Contact Details</SubHeading>)

    const heading = screen.getByRole('heading', { level: 4, name: 'Contact Details' })
    expect(heading).toHaveClass('text-sm', 'font-semibold', 'text-text-strong')
  })

  it('can be an h3 for a card with no CardHeader', () => {
    render(<SubHeading as="h3">Payments</SubHeading>)

    expect(screen.getByRole('heading', { level: 3, name: 'Payments' })).toBeInTheDocument()
  })

  it('adds caller classes', () => {
    render(<SubHeading className="mb-2">Notes</SubHeading>)

    expect(screen.getByRole('heading', { name: 'Notes' })).toHaveClass('mb-2', 'text-sm')
  })
})
