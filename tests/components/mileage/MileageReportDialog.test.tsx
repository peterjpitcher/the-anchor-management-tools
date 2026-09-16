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
