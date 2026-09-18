import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders the icon, compact size and title that callers pass', () => {
    render(
      <Badge tone="success" size="sm" title="Seated at 19:00" icon={<svg data-testid="tick" />}>
        Seated
      </Badge>,
    )

    const badge = screen.getByText('Seated')
    expect(badge.getAttribute('title')).toBe('Seated at 19:00')
    expect(badge.className).toContain('text-meta')
    expect(screen.getByTestId('tick')).toBeTruthy()
  })

  it('keeps the default size and uses the status soft, fg and border tokens', () => {
    render(<Badge tone="danger">No-show</Badge>)

    const badge = screen.getByText('No-show')
    expect(badge.className).toContain('text-xs')
    expect(badge.className).not.toContain('text-meta')
    expect(badge.className).toContain('bg-danger-soft')
    expect(badge.className).toContain('text-danger-fg')
    expect(badge.className).toContain('border-danger-border')
  })
})
