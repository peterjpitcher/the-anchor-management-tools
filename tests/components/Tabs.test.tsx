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

describe('Tabs accessibility', () => {
  const stripTabs = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ]

  it('claims no aria-controls when used as a plain tab strip with no panels', () => {
    render(<Tabs tabs={stripTabs} activeTab="upcoming" onTabChange={() => {}} />)

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).not.toHaveAttribute('aria-controls')
    }
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  })

  it('points the active tab at the panel it renders, and only that tab', () => {
    render(<Tabs items={tabItems} />)

    const active = screen.getByRole('tab', { name: 'Details' })
    const inactive = screen.getByRole('tab', { name: 'Financial' })
    const panel = screen.getByRole('tabpanel')

    expect(active).toHaveAttribute('aria-controls', panel.id)
    expect(inactive).not.toHaveAttribute('aria-controls')
    expect(panel).toHaveAttribute('aria-labelledby', active.id)

    fireEvent.click(inactive)

    const nextPanel = screen.getByRole('tabpanel')
    expect(inactive).toHaveAttribute('aria-controls', nextPanel.id)
    expect(active).not.toHaveAttribute('aria-controls')
    // Every aria-controls points at an element that exists.
    for (const tab of screen.getAllByRole('tab')) {
      const controls = tab.getAttribute('aria-controls')
      if (controls) expect(document.getElementById(controls)).not.toBeNull()
    }
  })

  it('names the tab list from aria-label', () => {
    render(<Tabs tabs={stripTabs} aria-label="Booking lists" />)

    expect(screen.getByRole('tablist', { name: 'Booking lists' })).toBeInTheDocument()
  })

  it('names the tab list from a visible heading through aria-labelledby', () => {
    render(
      <>
        <h2 id="lists-heading">Bookings</h2>
        <Tabs tabs={stripTabs} aria-labelledby="lists-heading" />
      </>,
    )

    expect(screen.getByRole('tablist', { name: 'Bookings' })).toBeInTheDocument()
  })
})
