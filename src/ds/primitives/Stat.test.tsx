import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stat } from './Stat'

// Text a screen reader announces: everything except aria-hidden subtrees. jsdom applies no CSS,
// so sr-only text is included, as it is for assistive technology.
function spokenText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return ''
  return Array.from(node.childNodes).map(spokenText).join('')
}

// Text a sighted user sees: everything except the sr-only helper.
function visibleText(element: Element): string {
  const clone = element.cloneNode(true) as Element
  clone.querySelectorAll('.sr-only').forEach((hidden) => hidden.remove())
  return clone.textContent ?? ''
}

describe('Stat delta', () => {
  it('announces a rise as up, with the same visible percentage', () => {
    render(<Stat label="New Customers" value="45" delta={12.5} />)
    const delta = screen.getByText('12.5%')

    expect(delta).toHaveClass('text-success-fg')
    expect(spokenText(delta)).toBe('up 12.5%')
    expect(visibleText(delta)).toBe('12.5%')
  })

  it('announces a fall as down, not as an unsigned percentage', () => {
    render(<Stat label="New Customers" value="44" delta={-12.5} />)
    const delta = screen.getByText('12.5%')

    expect(delta).toHaveClass('text-danger-fg')
    expect(spokenText(delta)).toBe('down 12.5%')
    expect(visibleText(delta)).toBe('12.5%')
  })

  it('announces no change and hides the flat hyphen from screen readers', () => {
    render(<Stat label="New Customers" value="40" delta={0} />)
    const delta = screen.getByText('0%')

    expect(delta).toHaveClass('text-text-muted')
    expect(spokenText(delta)).toBe('no change 0%')
    expect(visibleText(delta)).toBe('-0%')
    expect(screen.getByText('-')).toHaveAttribute('aria-hidden', 'true')
  })

  it('adds no direction text when there is no delta', () => {
    const { container } = render(<Stat label="Active Customers" value="300" />)

    expect(container.querySelector('.sr-only')).toBeNull()
  })
})
