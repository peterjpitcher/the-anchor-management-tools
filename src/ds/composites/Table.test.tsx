import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table'
import type { TableSortDirection } from './Table'

function renderHeader(sortDirection: TableSortDirection, onSort = vi.fn(), className?: string) {
  render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead sortable sortDirection={sortDirection} onSort={onSort} className={className}>
            Date
          </TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>1 Sep</TableCell>
          <TableCell>Quiet</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  )
  return onSort
}

describe('TableHead', () => {
  it('renders a sortable header as a real button inside the <th>', async () => {
    const user = userEvent.setup()
    const onSort = renderHeader(null)

    const header = screen.getByRole('columnheader', { name: 'Date' })
    const button = within(header).getByRole('button', { name: 'Date' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('focus-visible:outline-hidden', 'focus-visible:shadow-ring-inset')

    // Reachable and usable from the keyboard.
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onSort).toHaveBeenCalledTimes(1)

    await user.click(button)
    expect(onSort).toHaveBeenCalledTimes(2)
  })

  it.each([
    [null, 'none'],
    ['asc', 'ascending'],
    ['desc', 'descending'],
  ] as const)('sets aria-sort for direction %s', (direction, expected) => {
    renderHeader(direction)

    expect(screen.getByRole('columnheader', { name: 'Date' })).toHaveAttribute('aria-sort', expected)
  })

  it('shows the direction icon only for the sorted column', () => {
    renderHeader('asc')
    const sorted = screen.getByRole('button', { name: 'Date' })
    expect(sorted.querySelector('svg')).not.toBeNull()
  })

  it('keeps a placeholder instead of an icon while unsorted, so the header does not shift', () => {
    renderHeader(null)
    const button = screen.getByRole('button', { name: 'Date' })
    expect(button.querySelector('svg')).toBeNull()
    expect(button.querySelector('span.w-3')).not.toBeNull()
  })

  it('lets a caller class on the <th> colour the button, as the receipts list does', () => {
    renderHeader('desc', vi.fn(), 'text-primary')

    const header = screen.getByRole('columnheader', { name: 'Date' })
    expect(header).toHaveClass('text-primary')
    expect(within(header).getByRole('button')).not.toHaveClass('text-text-muted')
  })

  it('keeps the old markup when a caller still passes its own button, so buttons never nest', () => {
    const onSort = vi.fn()
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortable sortDirection="asc" onSort={onSort}>
              <button type="button" aria-label="Sort by Amount">
                Amount
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    )

    const header = screen.getByRole('columnheader')
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    const buttons = within(header).getAllByRole('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].querySelector('button')).toBeNull()

    // The click bubbles from the caller's button to the cell: one press, one sort.
    buttons[0].click()
    expect(onSort).toHaveBeenCalledTimes(1)
  })

  it('leaves a plain header without a button or aria-sort', () => {
    renderHeader(null)

    const header = screen.getByRole('columnheader', { name: 'Notes' })
    expect(header).not.toHaveAttribute('aria-sort')
    expect(within(header).queryByRole('button')).toBeNull()
  })
})
