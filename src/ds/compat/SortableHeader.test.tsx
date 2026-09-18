import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SortableHeader } from './SortableHeader'

function renderHeaderRow(onSort = vi.fn(), currentDirection: 'asc' | 'desc' = 'desc') {
  render(
    <table>
      <thead>
        <tr>
          <SortableHeader
            label="Company"
            column="company"
            currentColumn="total"
            currentDirection={currentDirection}
            onSort={onSort}
            className="text-left py-2 pr-4"
          />
          <SortableHeader
            label="Total"
            column="total"
            currentColumn="total"
            currentDirection={currentDirection}
            onSort={onSort}
            className="hidden text-right py-2 px-4 sm:table-cell"
          />
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Booker</td>
          <td>£520.00</td>
        </tr>
      </tbody>
    </table>,
  )
  return onSort
}

describe('SortableHeader', () => {
  it('is a real column header, so the row holds only cells', () => {
    renderHeaderRow()

    const company = screen.getByRole('columnheader', { name: 'Company' })
    expect(company.tagName).toBe('TH')
    expect(company).toHaveAttribute('scope', 'col')
    const row = company.closest('tr')
    expect(Array.from(row?.children ?? []).map((cell) => cell.tagName)).toEqual(['TH', 'TH'])
  })

  it('announces which column is sorted and in which direction', () => {
    renderHeaderRow(vi.fn(), 'desc')

    expect(screen.getByRole('columnheader', { name: 'Company' })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: 'Total' })).toHaveAttribute('aria-sort', 'descending')
  })

  it('reports an ascending sort', () => {
    renderHeaderRow(vi.fn(), 'asc')

    expect(screen.getByRole('columnheader', { name: 'Total' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts from a button inside the header', () => {
    const onSort = renderHeaderRow()

    const company = screen.getByRole('columnheader', { name: 'Company' })
    fireEvent.click(within(company).getByRole('button', { name: 'Company' }))

    expect(onSort).toHaveBeenCalledWith('company')
  })

  it('puts the layout classes on the cell, so a hidden column hides its header too', () => {
    renderHeaderRow()

    const total = screen.getByRole('columnheader', { name: 'Total' })
    expect(total).toHaveClass('hidden', 'sm:table-cell', 'text-right', 'px-4')
    expect(within(total).getByRole('button', { name: 'Total' })).not.toHaveClass('hidden')
  })
})
