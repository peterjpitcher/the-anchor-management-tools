import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TrainingMatrixView } from '@/components/features/training/manager/TrainingMatrixView'
import { ESSENTIALS, KEGS, matrixFixture } from './fixtures'

/**
 * The training matrix on Employees, Training. Every cell is worded from the shared training
 * labels, flags show beside the person, completion is shown per course, phones get a list per
 * person, and a failed load is an error rather than an empty matrix.
 */

function desktopGrid(): HTMLElement {
  return screen.getByRole('table')
}

function phoneList(): HTMLElement {
  return screen.getByRole('list', { name: 'Training by person' })
}

describe('TrainingMatrixView', () => {
  it('puts staff down the side and live courses across', () => {
    render(<TrainingMatrixView matrix={matrixFixture()} error={null} />)

    const grid = desktopGrid()
    const headers = within(grid).getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual(['Staff', ESSENTIALS.title, KEGS.title])
    const rows = within(grid).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('link')[0].textContent)).toEqual([
      'Avery Test',
      'Blake Sample',
      'Casey Example',
    ])
  })

  it('words each cell from its display state, with its dates', () => {
    render(<TrainingMatrixView matrix={matrixFixture()} error={null} />)
    const rows = within(desktopGrid()).getAllByRole('row').slice(1)

    const [avery, blake, casey] = rows
    expect(within(avery).getByText('Done')).toBeInTheDocument()
    expect(within(avery).getByText('refresher due by 2 Nov 2027')).toBeInTheDocument()
    expect(within(avery).getByText('Awaiting confirmation')).toBeInTheDocument()
    expect(within(avery).getByText('Supervised only')).toBeInTheDocument()

    expect(within(blake).getByText('Overdue')).toBeInTheDocument()
    expect(within(blake).getByText('3 days')).toBeInTheDocument()
    expect(within(blake).getByText('Not required')).toBeInTheDocument()

    expect(within(casey).getByText('Locked')).toBeInTheDocument()
    // A course with no cell for the person reads as not required, never as a blank.
    expect(within(casey).getByText('Not required')).toBeInTheDocument()
  })

  it('shows the flags and pauses that need a manager beside the person', () => {
    render(<TrainingMatrixView matrix={matrixFixture()} error={null} />)
    const rows = within(desktopGrid()).getAllByRole('row').slice(1)

    expect(within(rows[1]).getByText('Groups not confirmed')).toBeInTheDocument()
    expect(within(rows[1]).getByText('No login')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Date of birth missing')).toBeInTheDocument()
    expect(within(rows[0]).queryByText('No login')).not.toBeInTheDocument()

    expect(within(rows[2]).getByText('Paused')).toBeInTheDocument()
    expect(within(rows[2]).getByText(/Leaving/)).toBeInTheDocument()
  })

  it('links each person to the Training tab of their record', () => {
    render(<TrainingMatrixView matrix={matrixFixture()} error={null} />)
    const link = within(desktopGrid()).getByRole('link', { name: 'Blake Sample' })
    expect(link).toHaveAttribute('href', '/employees/emp-2?tab=training')
  })

  it('shows completion per course, and says when nobody needs a course yet', () => {
    render(<TrainingMatrixView matrix={matrixFixture()} error={null} />)

    expect(screen.getByText('1 of 3 done (33%)')).toBeInTheDocument()
    expect(screen.getByText('Nobody needs this yet')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Essentials: 1 of 3 done (33%)' })).toBeInTheDocument()
  })

  it('gives phones one entry per person listing only the courses that apply', () => {
    render(<TrainingMatrixView matrix={matrixFixture()} error={null} />)
    const entries = within(phoneList()).getAllByRole('listitem')
    expect(entries).toHaveLength(3)

    expect(within(entries[0]).getByText(KEGS.title)).toBeInTheDocument()
    expect(within(entries[0]).getByText('Awaiting confirmation')).toBeInTheDocument()
    // Blake does not need the keg course, so it is not listed for them on a phone.
    expect(within(entries[1]).getByText(ESSENTIALS.title)).toBeInTheDocument()
    expect(within(entries[1]).queryByText(KEGS.title)).not.toBeInTheDocument()
    expect(within(entries[1]).getByText('Overdue')).toBeInTheDocument()
  })

  it('shows a failed load as an error, never as an empty matrix', () => {
    render(<TrainingMatrixView matrix={null} error="The database did not answer." />)

    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('The training matrix could not be loaded')).toBeInTheDocument()
    expect(within(alert).getByText('The database did not answer.')).toBeInTheDocument()
    expect(screen.queryByText('No live courses yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('says so when no course is live yet', () => {
    const matrix = { ...matrixFixture(), courses: [] }
    render(<TrainingMatrixView matrix={matrix} error={null} />)

    expect(screen.getByText('No live courses yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('says so when there are no active staff', () => {
    const matrix = { ...matrixFixture(), people: [] }
    render(<TrainingMatrixView matrix={matrix} error={null} />)

    expect(screen.getByText('No active staff')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
