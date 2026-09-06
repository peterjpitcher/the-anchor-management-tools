import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MaintenanceDetailClient } from '@/app/(authenticated)/maintenance/_components/MaintenanceDetailClient'
import type { MaintenanceArea, MaintenanceItem } from '@/types/maintenance'

const updateMaintenanceItemMock = vi.hoisted(() => vi.fn())
const getMaintenanceItemMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/maintenance/22222222-2222-4222-8222-222222222222',
}))

vi.mock('@/app/actions/maintenance', () => ({
  updateMaintenanceItem: updateMaintenanceItemMock,
  getMaintenanceItem: getMaintenanceItemMock,
}))

// The photo gallery and the timeline own their own loading and error states and
// are covered by their own tests. They are stubbed here so this file is only about
// the edit form.
vi.mock('@/app/(authenticated)/maintenance/_components/MaintenancePhotos', () => ({
  MaintenancePhotos: () => <div data-testid="photos" />,
}))
vi.mock('@/app/(authenticated)/maintenance/_components/MaintenanceTimeline', () => ({
  MaintenanceTimeline: () => <div data-testid="timeline" />,
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
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Car park',
    sortOrder: 2,
    active: true,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
]

function buildItem(overrides: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    reference: 'MNT-0001',
    kind: 'issue',
    title: 'Cellar cooler tripping out',
    description: 'Trips every other morning.',
    areaId: areas[0].id,
    areaName: 'Cellar',
    status: 'reported',
    priority: 'high',
    responsibility: 'us',
    reportedOn: '2026-09-01',
    targetDate: '2026-09-10',
    completedOn: null,
    estimatedCost: null,
    actualCost: null,
    contractorName: null,
    contractorContact: null,
    createdBy: null,
    createdByEmail: 'peter@example.com',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

function renderDetail(item: MaintenanceItem = buildItem()) {
  return render(
    <MaintenanceDetailClient item={item} areas={areas} todayIsoDate="2026-09-06" />
  )
}

describe('MaintenanceDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the updated_at the form was built from as expectedUpdatedAt', async () => {
    updateMaintenanceItemMock.mockResolvedValue({
      success: true,
      data: buildItem({ title: 'Cooler tripping out', updatedAt: '2026-09-06T10:00:00.000Z' }),
    })

    renderDetail()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Cooler tripping out' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateMaintenanceItemMock).toHaveBeenCalledTimes(1))
    expect(updateMaintenanceItemMock).toHaveBeenCalledWith({
      id: '22222222-2222-4222-8222-222222222222',
      expectedUpdatedAt: '2026-09-01T09:00:00.000Z',
      title: 'Cooler tripping out',
    })
  })

  it('keeps every typed value and offers reload and reapply when the write is stale', async () => {
    updateMaintenanceItemMock.mockResolvedValue({
      success: false,
      code: 'stale_write',
      error: 'This item was changed by someone else while you were editing.',
    })

    renderDetail()

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Cooler keeps tripping' } })
    fireEvent.change(screen.getByLabelText('Estimated cost'), { target: { value: '480.25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(
        screen.getByText('Someone else changed this while you were editing')
      ).toBeInTheDocument()
    })

    // Nothing typed is discarded on a refused write.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Cooler keeps tripping')
    expect((screen.getByLabelText('Estimated cost') as HTMLInputElement).value).toBe('480.25')
    expect(screen.getByRole('button', { name: 'Load the newer version' })).toBeInTheDocument()
  })

  it('reapplies on to the newer version without losing the typing', async () => {
    updateMaintenanceItemMock.mockResolvedValueOnce({
      success: false,
      code: 'stale_write',
      error: 'This item was changed by someone else while you were editing.',
    })
    getMaintenanceItemMock.mockResolvedValue({
      success: true,
      data: buildItem({
        title: 'Somebody else retitled this',
        updatedAt: '2026-09-06T11:30:00.000Z',
      }),
    })
    updateMaintenanceItemMock.mockResolvedValueOnce({
      success: true,
      data: buildItem({ title: 'Cooler keeps tripping', updatedAt: '2026-09-06T11:45:00.000Z' }),
    })

    renderDetail()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Cooler keeps tripping' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Load the newer version' })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load the newer version' }))

    await waitFor(() => expect(screen.getByText('Loaded the newer version')).toBeInTheDocument())
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Cooler keeps tripping')

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateMaintenanceItemMock).toHaveBeenCalledTimes(2))
    expect(updateMaintenanceItemMock).toHaveBeenLastCalledWith({
      id: '22222222-2222-4222-8222-222222222222',
      expectedUpdatedAt: '2026-09-06T11:30:00.000Z',
      title: 'Cooler keeps tripping',
    })
  })

  it('never sends completedOn when the status changes', async () => {
    updateMaintenanceItemMock.mockResolvedValue({
      success: true,
      data: buildItem({
        status: 'done',
        completedOn: '2026-09-06',
        updatedAt: '2026-09-06T12:00:00.000Z',
      }),
    })

    renderDetail()
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateMaintenanceItemMock).toHaveBeenCalledTimes(1))
    const payload = updateMaintenanceItemMock.mock.calls[0][0]
    expect(payload.status).toBe('done')
    expect(payload).not.toHaveProperty('completedOn')
  })

  it('keeps the typing when the save fails for any other reason', async () => {
    updateMaintenanceItemMock.mockResolvedValue({
      success: false,
      code: 'db_error',
      error: 'Could not save your changes.',
    })

    renderDetail()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Still typing this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(screen.getByText('Could not save your changes')).toBeInTheDocument()
    )
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Still typing this')
  })

  it('puts an inactive area message on the area field', async () => {
    updateMaintenanceItemMock.mockResolvedValue({
      success: false,
      code: 'area_inactive',
      error: 'That area is no longer available. Pick another one.',
    })

    renderDetail()
    fireEvent.change(screen.getByLabelText('Area'), { target: { value: areas[1].id } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(
        screen.getByText('That area is no longer available. Pick another one.')
      ).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Area')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Area')).toHaveFocus()
  })

  it('restores the saved values on cancel and leaves save disabled until something changes', () => {
    renderDetail()

    const saveButton = screen.getByRole('button', { name: 'Save changes' })
    expect(saveButton).toBeDisabled()

    const title = screen.getByLabelText('Title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Changed my mind' } })
    expect(saveButton).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(title.value).toBe('Cellar cooler tripping out')
    expect(saveButton).toBeDisabled()
    expect(updateMaintenanceItemMock).not.toHaveBeenCalled()
  })

  it('refuses to save a target date that is before the reported date, and focuses the field', async () => {
    renderDetail()

    fireEvent.change(screen.getByLabelText('Target date'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(
        screen.getByText('The target date cannot be before the date this was reported')
      ).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Target date')).toHaveFocus()
    expect(updateMaintenanceItemMock).not.toHaveBeenCalled()
  })
})
