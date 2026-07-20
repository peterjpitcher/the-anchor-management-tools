import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReviewCell, WeeklyReview } from '@/types/checklists-review'
import { WeeklyReviewClient } from '../WeeklyReviewClient'

// Override the global next/navigation mock so usePathname is available.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/checklists/manage/review',
}))

const weekDates = [
  '2026-07-20',
  '2026-07-21',
  '2026-07-22',
  '2026-07-23',
  '2026-07-24',
  '2026-07-25',
  '2026-07-26',
]

function buildData(): WeeklyReview {
  const openingCells: ReviewCell[] = weekDates.map((date, i) => {
    if (i === 0) {
      return {
        date,
        state: 'done',
        instanceId: 'i1',
        completedByName: 'Jacob Hambridge',
        completedAt: '2026-07-20T11:41:00.000Z',
        wasLate: false,
        valueRecorded: null,
        valueBreach: false,
      }
    }
    if (i === 1) return { date, state: 'missed', instanceId: 'i2' }
    if (i === 2) return { date, state: 'no_data' }
    return { date, state: 'not_due' }
  })

  const closingCells: ReviewCell[] = weekDates.map((date, i) => {
    if (i === 0) {
      return {
        date,
        state: 'done',
        instanceId: 'i3',
        completedByName: 'Billy Summers',
        completedAt: '2026-07-20T23:10:00.000Z',
        wasLate: true,
        valueRecorded: 4.5,
        valueUnit: 'C',
        valueBreach: true,
      }
    }
    return { date, state: 'not_due' }
  })

  return {
    weekStart: '2026-07-20',
    weekDates,
    dateHealth: {
      '2026-07-20': 'complete',
      '2026-07-21': 'complete',
      '2026-07-22': 'failed',
      '2026-07-23': 'complete',
      '2026-07-24': 'complete',
      '2026-07-25': 'complete',
      '2026-07-26': 'complete',
    },
    departments: ['bar'],
    rows: [
      {
        templateId: 't1',
        slot: 'open',
        dayPart: 'opening',
        title: 'Open the till',
        department: 'bar',
        cells: openingCells,
      },
      {
        templateId: 't2',
        slot: 'close',
        dayPart: 'closing',
        title: 'Cash up',
        department: 'bar',
        cells: closingCells,
      },
    ],
    updatedAt: '2026-07-20T12:00:00.000Z',
    warnings: [],
  }
}

describe('WeeklyReviewClient', () => {
  it('renders a semantic table with 7 date column headers and a row header per task', () => {
    render(<WeeklyReviewClient data={buildData()} />)

    expect(screen.getByRole('table')).toBeInTheDocument()

    // Task column header + 7 date headers.
    const columnHeaders = screen.getAllByRole('columnheader')
    expect(columnHeaders.length).toBeGreaterThanOrEqual(8)
    expect(screen.getByRole('columnheader', { name: /Mon/ })).toBeInTheDocument()

    // scope="row" cells become rowheaders.
    expect(screen.getByRole('rowheader', { name: /Open the till/ })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /Cash up/ })).toBeInTheDocument()
  })

  it('gives a done cell an accessible name including the completer, not colour alone', () => {
    render(<WeeklyReviewClient data={buildData()} />)

    const doneCell = screen.getByRole('button', { name: /Done by Jacob Hambridge/i })
    expect(doneCell).toBeInTheDocument()
    // Visible initials text is present (icon/text signal, not colour only).
    expect(doneCell).toHaveTextContent('JH')
  })

  it('renders a missed cell that is visible and labelled', () => {
    render(<WeeklyReviewClient data={buildData()} />)

    const missedCell = screen.getByRole('button', { name: /Missed/i })
    expect(missedCell).toBeInTheDocument()
    // Visible cross glyph, not colour alone.
    expect(missedCell).toHaveTextContent('×')
  })

  it('shows a banner for a day whose data did not finish generating', () => {
    render(<WeeklyReviewClient data={buildData()} />)

    expect(screen.getByText(/did not finish generating/i)).toBeInTheDocument()
  })

  it('opens a detail dialog on click (not hover) with the full name and reading', async () => {
    const user = userEvent.setup()
    render(<WeeklyReviewClient data={buildData()} />)

    await user.click(screen.getByRole('button', { name: /Done by Billy Summers/i }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Billy Summers')).toBeInTheDocument()
    // Reading with unit and out-of-range breach note.
    expect(within(dialog).getByText(/4\.5 C \(out of range\)/)).toBeInTheDocument()
  })

  it('renders department and day-part filters defaulting to All', () => {
    render(<WeeklyReviewClient data={buildData()} />)

    const department = screen.getByLabelText(/Department/i) as HTMLSelectElement
    const dayPart = screen.getByLabelText(/Day-part/i) as HTMLSelectElement
    expect(department.value).toBe('all')
    expect(dayPart.value).toBe('all')
  })

  it('surfaces the error prop with a retry control', () => {
    render(<WeeklyReviewClient error="Insufficient permissions" />)

    expect(screen.getByText('Insufficient permissions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })

  it('shows an empty state when the week generated no rows', () => {
    const empty: WeeklyReview = { ...buildData(), rows: [] }
    render(<WeeklyReviewClient data={empty} />)

    expect(
      screen.getByText(/No checklist data was generated for this week/i),
    ).toBeInTheDocument()
  })
})
