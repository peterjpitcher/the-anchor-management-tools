import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MileageReportDialog } from '@/app/(authenticated)/mileage/_components/MileageReportDialog'

const DRIVERS = [
  { id: '00000000-0000-4000-8000-0000000000a1', displayName: 'Driver A', drivesOjProjects: true },
  { id: '00000000-0000-4000-8000-0000000000b1', displayName: 'Driver B', drivesOjProjects: false },
]

const fetchMock = vi.fn()

function renderDialog(): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  render(<MileageReportDialog open onClose={onClose} drivers={DRIVERS} today="2026-09-15" />)
  return { onClose }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  URL.createObjectURL = vi.fn(() => 'blob:report')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MileageReportDialog', () => {
  it('defaults to the last completed quarter and all drivers', () => {
    renderDialog()
    expect(screen.getByLabelText('Period type')).toHaveValue('quarter')
    expect(screen.getByLabelText('Period')).toHaveValue('2026-Q2')
    expect(screen.getByLabelText('Driver')).toHaveValue('all')
  })

  it('downloads the chosen period and driver, then closes', async () => {
    fetchMock.mockResolvedValue(
      new Response('%PDF-1.7', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Mileage_Report_2026-Q2_Driver_B.pdf"' },
      })
    )
    const { onClose } = renderDialog()

    fireEvent.change(screen.getByLabelText('Driver'), { target: { value: DRIVERS[1].id } })
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(`/api/mileage/report?from=2026-04-01&to=2026-06-30&driver=${DRIVERS[1].id}`, { cache: 'no-store' })
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled()
  })

  it('shows the server error, keeps the choices and downloads nothing', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'MILEAGE_REPORT_TOO_LARGE', error: 'This period is too large for one report. Choose shorter dates.' }), { status: 413 })
    )
    const { onClose } = renderDialog()

    fireEvent.change(screen.getByLabelText('Period type'), { target: { value: 'financial_year' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This period is too large for one report. Choose shorter dates.')
    expect(screen.getByLabelText('Period type')).toHaveValue('financial_year')
    expect(screen.getByLabelText('Period')).toHaveValue('FY2026')
    expect(onClose).not.toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  })

  it('shows an error and downloads nothing when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't build the PDF. Nothing was downloaded. Try again.")
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  })

  it('checks custom dates before asking the server', () => {
    renderDialog()

    fireEvent.change(screen.getByLabelText('Period type'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-30' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-04-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    expect(screen.getByText('The start date must be on or before the end date.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables the button while the report builds', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))

    expect(await screen.findByRole('button', { name: /Building report/ })).toBeDisabled()
  })
})

describe('MileageReportDialog opened from the trips table', () => {
  it('opens on the table period and driver', () => {
    render(
      <MileageReportDialog
        open
        onClose={vi.fn()}
        drivers={DRIVERS}
        today="2026-09-15"
        initialRange={{ from: '2025-04-06', to: '2026-04-05' }}
        initialDriverId={DRIVERS[1].id}
      />
    )
    expect(screen.getByLabelText('Period type')).toHaveValue('tax_year')
    expect(screen.getByLabelText('Period')).toHaveValue('TY2025-26')
    expect(screen.getByLabelText('Driver')).toHaveValue(DRIVERS[1].id)
  })

  it('opens on a quarter and keeps the other lists on their own defaults', () => {
    render(
      <MileageReportDialog open onClose={vi.fn()} drivers={DRIVERS} today="2026-09-15" initialRange={{ from: '2025-10-01', to: '2025-12-31' }} />
    )
    expect(screen.getByLabelText('Period type')).toHaveValue('quarter')
    expect(screen.getByLabelText('Period')).toHaveValue('2025-Q4')
    fireEvent.change(screen.getByLabelText('Period type'), { target: { value: 'financial_year' } })
    expect(screen.getByLabelText('Period')).toHaveValue('FY2026')
  })

  it('opens custom dates when the table dates match no period', () => {
    render(<MileageReportDialog open onClose={vi.fn()} drivers={DRIVERS} today="2026-09-15" initialRange={{ from: '2026-04-03', to: '2026-04-20' }} />)
    expect(screen.getByLabelText('Period type')).toHaveValue('custom')
    expect(screen.getByLabelText('From')).toHaveValue('2026-04-03')
    expect(screen.getByLabelText('To')).toHaveValue('2026-04-20')
  })

  it('opens custom dates when the table has only one of the two dates', () => {
    render(<MileageReportDialog open onClose={vi.fn()} drivers={DRIVERS} today="2026-09-15" initialRange={{ from: '2026-04-03', to: null }} />)
    expect(screen.getByLabelText('Period type')).toHaveValue('custom')
    expect(screen.getByLabelText('From')).toHaveValue('2026-04-03')
    expect(screen.getByLabelText('To')).toHaveValue('')
  })

  it('names the table filters the PDF ignores', () => {
    render(<MileageReportDialog open onClose={vi.fn()} drivers={DRIVERS} today="2026-09-15" ignoredFilters={['search', 'place', 'source']} />)
    expect(
      screen.getByText(
        'The PDF uses the dates and driver only. It ignores the search, place and source filters on the trips table, so it lists every trip in these dates.'
      )
    ).toBeInTheDocument()
  })

  it('says nothing about ignored filters when there are none', () => {
    render(<MileageReportDialog open onClose={vi.fn()} drivers={DRIVERS} today="2026-09-15" ignoredFilters={[]} />)
    expect(screen.queryByText(/The PDF uses the dates and driver only/)).not.toBeInTheDocument()
  })

  it('falls back to the last completed quarter and all drivers', () => {
    render(
      <MileageReportDialog
        open
        onClose={vi.fn()}
        drivers={DRIVERS}
        today="2026-09-15"
        initialRange={{ from: null, to: null }}
        initialDriverId="00000000-0000-4000-8000-00000000ffff"
      />
    )
    expect(screen.getByLabelText('Period')).toHaveValue('2026-Q2')
    expect(screen.getByLabelText('Driver')).toHaveValue('all')
  })
})
