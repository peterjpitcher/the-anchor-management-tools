import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DataTable } from './DataTable'
import type { Column, DataTableSortDirection } from './DataTable'

type Row = { id: string; name: string; total: number }

// The server's order, which is not alphabetical: a controlled table must keep it.
const rows: Row[] = [
  { id: '1', name: 'Carol', total: 30 },
  { id: '2', name: 'Alice', total: 10 },
  { id: '3', name: 'Bob', total: 20 },
]

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, cell: (row) => row.name },
  { key: 'total', header: 'Total', sortable: true, cell: (row) => String(row.total) },
]

function names(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent ?? '')
}

function renderControlled(sortKey: string | null, sortDirection?: DataTableSortDirection) {
  const onSortChange = vi.fn()
  render(
    <DataTable
      data={rows}
      columns={columns}
      getRowKey={(row) => row.id}
      sortKey={sortKey}
      sortDirection={sortDirection}
      onSortChange={onSortChange}
    />,
  )
  return onSortChange
}

describe('DataTable controlled sorting', () => {
  it('shows the rows in the order given instead of sorting them itself', () => {
    const onSortChange = renderControlled('name', 'asc')

    expect(names()).toEqual(['Carol', 'Alice', 'Bob'])

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(onSortChange).toHaveBeenCalledWith('name', 'desc')
    // Nothing moves until the caller sends new rows.
    expect(names()).toEqual(['Carol', 'Alice', 'Bob'])
  })

  it('marks the controlled column with aria-sort', () => {
    renderControlled('total', 'desc')

    expect(screen.getByRole('columnheader', { name: 'Total' })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none')
  })

  it('asks for ascending on a new column and flips the current one', () => {
    const onSortChange = renderControlled('total', 'desc')

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'asc')

    fireEvent.click(screen.getByRole('button', { name: 'Total' }))
    expect(onSortChange).toHaveBeenLastCalledWith('total', 'asc')
  })

  it('treats a null sortKey as controlled with no sort', () => {
    const onSortChange = renderControlled(null)

    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none')
    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(onSortChange).toHaveBeenCalledWith('name', 'asc')
    expect(names()).toEqual(['Carol', 'Alice', 'Bob'])
  })

  it('defaults a controlled direction to ascending', () => {
    renderControlled('name')

    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending')
  })
})

describe('DataTable uncontrolled sorting', () => {
  it('still sorts the rows itself and reports each change', () => {
    const onSortChange = vi.fn()
    render(<DataTable data={rows} columns={columns} getRowKey={(row) => row.id} onSortChange={onSortChange} />)

    expect(names()).toEqual(['Carol', 'Alice', 'Bob'])

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(names()).toEqual(['Alice', 'Bob', 'Carol'])
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'asc')

    fireEvent.click(screen.getByRole('button', { name: 'Name' }))
    expect(names()).toEqual(['Carol', 'Bob', 'Alice'])
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'desc')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'descending')
  })
})
