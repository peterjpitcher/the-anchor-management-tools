import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card, CardBody, CardHeader } from './Card'

describe('CardHeader on a narrow card', () => {
  it('lets the action wrap below the title instead of clipping it', () => {
    render(
      <Card>
        <CardHeader title="Upcoming Bookings" subtitle="Next seven days" action={<button type="button">Refresh</button>} />
      </Card>,
    )

    const heading = screen.getByRole('heading', { level: 3, name: 'Upcoming Bookings' })
    const titleBlock = heading.parentElement as HTMLElement
    const row = titleBlock.parentElement as HTMLElement
    const actionArea = screen.getByRole('button', { name: 'Refresh' }).parentElement as HTMLElement

    expect(row).toHaveClass('flex', 'flex-wrap', 'items-center', 'justify-between', 'gap-x-3', 'gap-y-2')
    // The title block asks for its text's natural width, capped at 12rem, before the action
    // is pushed onto its own line. A fixed 12rem basis would wrap a short title and a
    // medium action that fit side by side on a phone.
    expect(titleBlock).toHaveClass('min-w-0', 'flex-auto')
    expect(titleBlock.className).not.toMatch(/flex-\[/)
    for (const text of [heading, screen.getByText('Next seven days')]) {
      expect(text).toHaveClass('min-w-full', 'max-w-[12rem]')
    }
    // The action area never refuses to shrink, and wraps its own buttons.
    expect(actionArea).toHaveClass('flex', 'flex-wrap', 'gap-2', 'min-w-0', 'max-w-full')
    expect(actionArea).not.toHaveClass('flex-shrink-0')
  })

  it('wraps a long title and subtitle rather than cutting them off', () => {
    render(<CardHeader title="Bookings Awaiting a Deposit" subtitle="Parties of 15 or more who have not paid yet" />)

    const heading = screen.getByRole('heading', { level: 3, name: 'Bookings Awaiting a Deposit' })
    const subtitle = screen.getByText('Parties of 15 or more who have not paid yet')

    expect(heading).not.toHaveClass('truncate')
    expect(heading).toHaveClass('break-words')
    expect(subtitle).not.toHaveClass('truncate')
    expect(subtitle).toHaveClass('break-words')
  })

  it('renders no action area when there is no action', () => {
    const { container } = render(<CardHeader title="Notes" />)

    const row = container.firstElementChild as HTMLElement
    expect(row.children).toHaveLength(1)
  })

  it('keeps the title element mounted when the action appears and disappears', () => {
    function Header({ withAction }: { withAction: boolean }) {
      return (
        <Card>
          <CardHeader title="Guests" action={withAction ? <button type="button">Add Guest</button> : undefined} />
          <CardBody>Body</CardBody>
        </Card>
      )
    }

    const { rerender } = render(<Header withAction={false} />)
    const before = screen.getByRole('heading', { name: 'Guests' })

    rerender(<Header withAction />)
    expect(screen.getByRole('button', { name: 'Add Guest' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Guests' })).toBe(before)

    rerender(<Header withAction={false} />)
    expect(screen.getByRole('heading', { name: 'Guests' })).toBe(before)
  })

  it('still lets a caller add classes to the header row', () => {
    const { container } = render(<CardHeader title="Summary" className="border-b-0" />)

    const row = container.firstElementChild as HTMLElement
    expect(row).toHaveClass('border-b-0', 'flex-wrap')
    expect(row).not.toHaveClass('border-b')
  })
})
