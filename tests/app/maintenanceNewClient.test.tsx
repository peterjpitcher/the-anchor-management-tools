import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MaintenanceNewClient } from '@/app/(authenticated)/maintenance/_components/MaintenanceNewClient'
import type { MaintenanceArea } from '@/types/maintenance'

const routerPushMock = vi.hoisted(() => vi.fn())
const createMaintenanceItemMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/maintenance/new',
}))

vi.mock('@/app/actions/maintenance', () => ({
  createMaintenanceItem: createMaintenanceItemMock,
}))

const areas: MaintenanceArea[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Cellar',
    sortOrder: 1,
    active: true,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
]

describe('MaintenanceNewClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers no photo control, because the item is saved before any photo is taken', () => {
    render(<MaintenanceNewClient areas={areas} />)

    // The page explains why photos come later, but offers no way to attach one.
    expect(document.querySelector('input[type="file"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull()
    expect(screen.queryByLabelText(/photo/i)).toBeNull()
  })

  it('will not submit without a title and moves focus to the field', async () => {
    render(<MaintenanceNewClient areas={areas} />)

    fireEvent.change(screen.getByLabelText('Area'), { target: { value: areas[0].id } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and open' }))

    await waitFor(() => {
      expect(screen.getByText('Give this a short title')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Title')).toHaveFocus()
    expect(createMaintenanceItemMock).not.toHaveBeenCalled()
  })

  it('saves the four required fields and opens the item', async () => {
    createMaintenanceItemMock.mockResolvedValue({
      success: true,
      data: { id: '22222222-2222-4222-8222-222222222222', reference: 'MNT-0007' },
    })

    render(<MaintenanceNewClient areas={areas} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Gents tap dripping' } })
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: areas[0].id } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'low' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and open' }))

    await waitFor(() => expect(createMaintenanceItemMock).toHaveBeenCalledTimes(1))
    expect(createMaintenanceItemMock).toHaveBeenCalledWith({
      kind: 'issue',
      title: 'Gents tap dripping',
      areaId: areas[0].id,
      priority: 'low',
      responsibility: 'to_confirm',
      description: null,
      targetDate: null,
      estimatedCost: null,
      contractorName: null,
      contractorContact: null,
    })
    await waitFor(() =>
      expect(routerPushMock).toHaveBeenCalledWith('/maintenance/22222222-2222-4222-8222-222222222222')
    )
  })

  it('keeps what was typed when the save fails', async () => {
    createMaintenanceItemMock.mockResolvedValue({
      success: false,
      error: 'Could not save that item.',
    })

    render(<MaintenanceNewClient areas={areas} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Gents tap dripping' } })
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: areas[0].id } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and open' }))

    await waitFor(() => expect(screen.getByText('Could not save that item.')).toBeInTheDocument())
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Gents tap dripping')
    expect(routerPushMock).not.toHaveBeenCalled()
  })

  it('re-enables the button and keeps every field when the save never comes back', async () => {
    // Logging something on a phone by the car park: the request rejects instead of
    // resolving, so nothing after the await would run without a catch.
    createMaintenanceItemMock.mockRejectedValue(new Error('Failed to fetch'))

    render(<MaintenanceNewClient areas={areas} />)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Gents tap dripping' } })
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: areas[0].id } })
    fireEvent.click(screen.getByRole('button', { name: 'Add more detail' }))
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Been dripping since the weekend.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and open' }))

    await waitFor(() =>
      expect(
        screen.getByText('Could not save. Check your connection and try again.')
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Save and open' })).not.toBeDisabled()
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Gents tap dripping')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
      'Been dripping since the weekend.'
    )
    expect(routerPushMock).not.toHaveBeenCalled()

    // The retry is not blocked by a saving flag that was never reset.
    createMaintenanceItemMock.mockResolvedValue({
      success: true,
      data: { id: '22222222-2222-4222-8222-222222222222', reference: 'MNT-0007' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and open' }))
    await waitFor(() => expect(createMaintenanceItemMock).toHaveBeenCalledTimes(2))
  })
})
