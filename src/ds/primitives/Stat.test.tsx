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

describe('Stat deltaGood', () => {
  it('shows a rise in the danger colour when down is good, and still says up', () => {
    render(<Stat label="No-shows" value="9" delta={20} deltaGood="down" />)
    const delta = screen.getByText('20%')

    expect(delta).toHaveClass('text-danger-fg')
    expect(delta).not.toHaveClass('text-success-fg')
    expect(spokenText(delta)).toBe('up 20%')
  })

  it('shows a fall in the success colour when down is good, and still says down', () => {
    render(<Stat label="Costs" value="£400" delta={-8} deltaGood="down" />)
    const delta = screen.getByText('8%')

    expect(delta).toHaveClass('text-success-fg')
    expect(spokenText(delta)).toBe('down 8%')
  })

  it('keeps no change muted whichever way is good', () => {
    render(<Stat label="Costs" value="£400" delta={0} deltaGood="down" />)

    expect(screen.getByText('0%')).toHaveClass('text-text-muted')
  })

  it('draws the arrow in the colour of the delta text', () => {
    render(<Stat label="Costs" value="£400" delta={-8} deltaGood="down" />)
    const arrow = screen.getByText('8%').querySelector('svg')

    expect(arrow).not.toBeNull()
    expect(arrow?.getAttribute('class')).not.toMatch(/text-/)
  })
})

describe('Stat deltaLabel', () => {
  it('shows the label instead of the percentage and keeps the direction colour and words', () => {
    render(<Stat label="No-shows" value="2" delta={2} deltaLabel="+2" deltaGood="down" />)
    const delta = screen.getByText('+2')

    expect(delta).toHaveClass('text-danger-fg')
    expect(delta.querySelector('svg')).not.toBeNull()
    expect(spokenText(delta)).toBe('up +2')
    expect(visibleText(delta)).toBe('+2')
    expect(screen.queryByText('2%', { exact: false })).not.toBeInTheDocument()
  })

  it('shows percentage points for a fall, in the colour of a fall', () => {
    render(<Stat label="Automation coverage" value="70%" delta={-5} deltaLabel="-5 pts" />)
    const delta = screen.getByText('-5 pts')

    expect(delta).toHaveClass('text-danger-fg')
    expect(spokenText(delta)).toBe('down -5 pts')
  })

  it('takes its direction from deltaDirection when there is no delta number', () => {
    render(<Stat label="Covers" value="12" deltaDirection="up" deltaLabel="+12" />)
    const delta = screen.getByText('+12')

    expect(delta).toHaveClass('text-success-fg')
    expect(spokenText(delta)).toBe('up +12')
  })
})

describe('Stat tone', () => {
  it.each([
    ['default', 'text-text'],
    ['success', 'text-success-fg'],
    ['warning', 'text-warning-fg'],
    ['danger', 'text-danger-fg'],
  ] as const)('colours the value for the %s tone', (tone, colour) => {
    render(<Stat label="Overdue" value="£1,200" tone={tone} />)

    expect(screen.getByText('£1,200')).toHaveClass(colour)
  })

  it('uses the plain text colour when no tone is given', () => {
    render(<Stat label="Covers" value="48" />)

    expect(screen.getByText('48')).toHaveClass('text-text')
  })
})
