import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageLoading } from './PageLoading'

describe('PageLoading', () => {
  it('should render a status region with the default accessible label', () => {
    render(<PageLoading />)
    const status = screen.getByRole('status')
    expect(status).toBeTruthy()
    expect(status.textContent).toContain('Loading…')
  })

  it('should use a custom label when provided', () => {
    render(<PageLoading label="Loading customers…" />)
    expect(screen.getByRole('status').textContent).toContain('Loading customers…')
  })

  it('should allow sizing overrides via className', () => {
    render(<PageLoading className="min-h-0 py-12" />)
    const status = screen.getByRole('status')
    expect(status.className).toContain('py-12')
    expect(status.className).toContain('min-h-0')
    expect(status.className).not.toContain('min-h-[50vh]')
  })
})
