import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MileageTripCard } from '@/app/(authenticated)/mileage/_components/MileageTripCard'
import { MileageTripTable, type MileageTripTableProps } from '@/app/(authenticated)/mileage/_components/MileageTripTable'
import { parseMileageReportDataset } from '@/lib/mileage/report/dataset'
import { buildDatasetJson } from '../../fixtures/mileage/reportDataset'

const [LOGGED, , OJ] = parseMileageReportDataset(buildDatasetJson()).trips

function renderTable(overrides: Partial<MileageTripTableProps> = {}) {
  const props: MileageTripTableProps = {
    trips: [LOGGED, OJ],
    sort: 'date',
    dir: 'desc',
    onSort: vi.fn(),
    canManage: true,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<MileageTripTable {...props} />)
  return props
}

describe('MileageTripTable', () => {
  it('shows each trip with its date, route, driver, miles, rate, amount and source', () => {
    renderTable()
    const row = screen.getByText('The Anchor → Shop One → The Anchor').closest('tr') as HTMLElement
    expect(within(row).getByText('4 April 2026')).toBeInTheDocument()
    expect(within(row).getByText('Driver A')).toBeInTheDocument()
    expect(within(row).getByText('3.4')).toBeInTheDocument()
    expect(within(row).getByText('45p')).toBeInTheDocument()
    expect(within(row).getByText('£1.53')).toBeInTheDocument()
    expect(within(row).getByText('Logged')).toBeInTheDocument()

    const ojRow = screen.getByText('Not recorded (OJ Projects: Vision workshop, Client Ltd)').closest('tr') as HTMLElement
    expect(within(ojRow).getByText('1 May 2026')).toBeInTheDocument()
    expect(within(ojRow).getByText('£22.00')).toBeInTheDocument()
    expect(within(ojRow).getByText('OJ Projects')).toBeInTheDocument()
  })

  it('asks for a new order when a sortable header is clicked', () => {
    const props = renderTable()
    fireEvent.click(screen.getByText('Miles'))
    expect(props.onSort).toHaveBeenCalledWith('miles')
  })

  it('lets keyboard users sort, asking once per press', () => {
    const props = renderTable()
    const amount = screen.getByRole('button', { name: 'Amount' })
    amount.focus()
    expect(amount).toHaveFocus()
    fireEvent.click(amount)
    expect(props.onSort).toHaveBeenCalledTimes(1)
    expect(props.onSort).toHaveBeenCalledWith('amount')
    expect(screen.queryByRole('button', { name: 'Route' })).not.toBeInTheDocument()
  })

  it('announces the sort order', () => {
    renderTable({ sort: 'amount', dir: 'asc' })
    const announcement = screen.getByText('Sorted by amount, lowest first')
    expect(announcement).toHaveAttribute('aria-live', 'polite')
  })

  it('offers edit and delete on logged trips only', () => {
    const props = renderTable()
    fireEvent.click(screen.getByRole('button', { name: 'Edit trip on 4 April 2026' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete trip on 4 April 2026' }))
    expect(props.onEdit).toHaveBeenCalledWith(LOGGED)
    expect(props.onDelete).toHaveBeenCalledWith(LOGGED)
    expect(screen.queryByRole('button', { name: 'Edit trip on 1 May 2026' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete trip on 1 May 2026' })).not.toBeInTheDocument()
  })

  it('hides the actions from people who cannot manage mileage', () => {
    renderTable({ canManage: false })
    expect(screen.queryByRole('button', { name: /Edit trip/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete trip/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Actions')).not.toBeInTheDocument()
  })
})

describe('MileageTripCard', () => {
  it('shows a trip as a card that wraps long routes and has no actions for OJ Projects trips', () => {
    render(<MileageTripCard trip={OJ} canManage onEdit={vi.fn()} onDelete={vi.fn()} />)
    const card = screen.getByRole('article', { name: 'Trip on 1 May 2026' })
    expect(within(card).getByText('Not recorded (OJ Projects: Vision workshop, Client Ltd)')).toHaveClass('break-words')
    expect(within(card).getByText('Driver A')).toBeInTheDocument()
    expect(within(card).getByText('40.0')).toBeInTheDocument()
    expect(within(card).getByText('£22.00')).toBeInTheDocument()
    expect(within(card).getByText('OJ Projects')).toBeInTheDocument()
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers edit and delete on a logged trip to managers only', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const { unmount } = render(<MileageTripCard trip={LOGGED} canManage onEdit={onEdit} onDelete={onDelete} />)
    const card = screen.getByRole('article', { name: 'Trip on 4 April 2026' })
    expect(within(card).getByText('The Anchor → Shop One → The Anchor')).toBeInTheDocument()
    expect(within(card).getByText('Logged')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Edit trip on 4 April 2026' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Delete trip on 4 April 2026' }))
    expect(onEdit).toHaveBeenCalledWith(LOGGED)
    expect(onDelete).toHaveBeenCalledWith(LOGGED)
    unmount()

    render(<MileageTripCard trip={LOGGED} canManage={false} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
