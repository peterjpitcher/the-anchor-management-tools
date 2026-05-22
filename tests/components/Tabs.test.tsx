import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Tabs } from '@/ds/composites/Tabs'

const tabItems = [
  { key: 'details', label: 'Details', content: <div>Details content</div> },
  { key: 'financial', label: 'Financial', content: <div>Financial content</div> },
]

describe('Tabs', () => {
  it('switches content when used without controlled props', () => {
    render(<Tabs items={tabItems} />)

    expect(screen.getByText('Details content')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Financial' }))

    expect(screen.getByRole('tab', { name: 'Financial' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Financial content')).toBeInTheDocument()
    expect(screen.queryByText('Details content')).not.toBeInTheDocument()
  })

  it('keeps controlled usage controlled', () => {
    const onChange = vi.fn()

    render(<Tabs items={tabItems} activeKey="details" onChange={onChange} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Financial' }))

    expect(onChange).toHaveBeenCalledWith('financial')
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Details content')).toBeInTheDocument()
  })
})
